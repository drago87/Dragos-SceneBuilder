import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";


function isNodeActive(node) {
    if (!node) return false;
    if (node.mode === 2) return false;
    if (node.mode === 4) return false;
    return true;
}

function getWidgetValue(node, names) {
    if (!node.widgets) return null;
    for (const name of names) {
        const w = node.widgets.find(w => w.name === name);
        if (w) return w.value;
    }
    return null;
}

function deepMergeObjects(base, override) {
    const result = { ...base };
    for (const key in override) {
        if (
            key in result &&
            typeof result[key] === "object" &&
            result[key] !== null &&
            !Array.isArray(result[key]) &&
            typeof override[key] === "object" &&
            override[key] !== null &&
            !Array.isArray(override[key])
        ) {
            result[key] = deepMergeObjects(result[key], override[key]);
        } else {
            result[key] = override[key];
        }
    }
    return result;
}

function sanitizeKeyPart(str) {
    return String(str || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function generateKey(category, value, count, existingObj) {
    const sanitizedCategory = sanitizeKeyPart(category);
    const nameValue = typeof value === 'object' ? value?.name : null;

    if (nameValue && String(nameValue).trim()) {
        const sanitizedName = sanitizeKeyPart(nameValue);
        if (sanitizedName) {
            let key = `${sanitizedCategory}_${sanitizedName}`;
            
            if (existingObj && typeof existingObj === 'object' && key in existingObj) {
                let counter = 2;
                while (`${key}_${counter}` in existingObj) counter++;
                key = `${key}_${counter}`;
            }
            return key;
        }
    }

    return `${sanitizedCategory}_${count}`;
}

// Safely get a nested value using dot notation (e.g., "character.clothing")
function getNestedValue(obj, path) {
    if (!path) return obj;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (typeof current !== 'object' || current === null) return undefined;
        current = current[part];
    }
    return current;
}

// Safely set a nested value, creating intermediate objects if needed
function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}


function getValueRecursive(node, graph, context) {
    if (!node) return undefined;
    if (!isNodeActive(node)) return undefined;

    if (!context) {
        context = { extensionCounts: {} };
    }

    if (node.comfyClass === "DragosVariable")
        return getWidgetValue(node, ["text"]) ?? "";

    if (node.comfyClass === "DragosStructuredBuilder") {
        const result = {};

        let myCategory = "";
        let myOverride = "yes";
        const myJsonWidget = node.widgets?.find(w => w.name === "json_data");
        if (myJsonWidget?.value) {
            try {
                const myParsed = JSON.parse(myJsonWidget.value);
                myCategory = myParsed._meta?.category || "";
                myOverride = myParsed._meta?.override || "yes";
            } catch(e) {}
        }

        for (const widget of node.widgets || []) {
            if (!widget.dragosPath) continue;
            if (widget.hidden) continue;
            if (widget.value === "" || widget.value == null) continue;

            const parts = widget.dragosPath.split(".");
            let current = result;

            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!(part in current))
                    current[part] = {};
                current = current[part];
            }

            current[parts[parts.length - 1]] = widget.value;
        }

        if (node.inputs) {
            for (const input of node.inputs) {
                if (!input || input.link == null) continue;
                if (!input.name || !input.name.startsWith("input_")) continue;

                const link = graph.links[input.link];
                if (!link) continue;

                const origin = graph.getNodeById(link.origin_id);
                if (!origin || !isNodeActive(origin)) continue;

                const inputValue = getValueRecursive(origin, graph, context);
                if (inputValue === undefined) continue;

                let isExtension = false;
                let extensionTarget = "";
                let originOverride = "yes";
                let originCategory = "";

                if (origin.comfyClass === "DragosStructuredBuilder") {
                    const originJsonWidget = origin.widgets?.find(w => w.name === "json_data");
                    if (originJsonWidget?.value) {
                        try {
                            const parsedOrigin = JSON.parse(originJsonWidget.value);
                            const originMeta = parsedOrigin._meta || {};
                            if (originMeta.extension) {
                                isExtension = true;
                                extensionTarget = originMeta.extension;
                                originOverride = originMeta.override || "yes";
                                originCategory = originMeta.category || "";
                            }
                        } catch (e) {}
                    }
                }

                if (isExtension) {
                    if (extensionTarget === myCategory) {
                        if (typeof inputValue === "object" && inputValue !== null) {
                            if (originOverride === "no") {
                                const countKey = `ext_${originCategory}`;
                                if (!(countKey in context.extensionCounts)) {
                                    context.extensionCounts[countKey] = 0;
                                }
                                context.extensionCounts[countKey]++;

                                const subKey = generateKey(
                                    originCategory,
                                    inputValue,
                                    context.extensionCounts[countKey],
                                    result
                                );
                                
                                // FIX: Nest inside the extension target path if it exists!
                                const targetObj = getNestedValue(result, extensionTarget);
                                if (targetObj !== undefined && typeof targetObj === 'object') {
                                    targetObj[subKey] = inputValue;
                                } else {
                                    result[subKey] = inputValue;
                                }
                            } else {
                                for (const key in inputValue) {
                                    if (
                                        key in result &&
                                        typeof result[key] === "object" &&
                                        result[key] !== null &&
                                        !Array.isArray(result[key]) &&
                                        typeof inputValue[key] === "object" &&
                                        inputValue[key] !== null &&
                                        !Array.isArray(inputValue[key])
                                    ) {
                                        result[key] = deepMergeObjects(result[key], inputValue[key]);
                                    } else {
                                        result[key] = inputValue[key];
                                    }
                                }
                            }
                        }
                    }
                } else {
                    const inputName = getWidgetValue(origin, ["var_name", "obj_name"]);
                    if (inputName) {
                        if (typeof inputValue === "object" && inputValue !== null) {
                            result[inputName] = deepMergeObjects(result[inputName] || {}, inputValue);
                        } else {
                            result[inputName] = inputValue;
                        }
                    }
                }
            }
        }

        return result;
    }

    if (node.comfyClass === "DragosObject") {
        const result = {};

        for (const input of node.inputs || []) {
            if (input.link == null) continue;

            const link = graph.links[input.link];
            if (!link) continue;

            const origin = graph.getNodeById(link.origin_id);
            if (!isNodeActive(origin)) continue;

            const key =
                getWidgetValue(origin, ["var_name", "obj_name"])
                ?? input.name;

            const value = getValueRecursive(origin, graph, context);

            if (value !== undefined)
                result[key] = value;
        }

        return result;
    }

    return undefined;
}


function refreshNode(node, graph, previewWidget, syncPreviewHeight) {
    if (!node || !graph || !node.inputs)
        return;

    const orderedOrigins = [];

    for (let i = 0; i < node.inputs.length; i++) {
        const input = node.inputs[i];
        if (!input || input.link == null) continue;
        const link = graph.links[input.link];
        if (!link) continue;
        const origin = graph.getNodeById(link.origin_id);
        if (!origin) continue;
        if (!isNodeActive(origin)) continue;
        orderedOrigins.push(origin);
    }

    const built = [];

    for (let i = 0; i < orderedOrigins.length; i++) {
        const origin = orderedOrigins[i];
        const value = getValueRecursive(origin, graph, { extensionCounts: {} });

        if (value == null || (typeof value === "object" && Object.keys(value).length === 0))
            continue;

        let category = "";
        let extension = "";
        let override = "yes";

        const jsonWidget = origin.widgets?.find(w => w.name === "json_data");

        if (jsonWidget?.value) {
            try {
                const parsed = JSON.parse(jsonWidget.value);
                const meta = parsed?._meta;
                if (meta) {
                    category = String(meta.display_name ?? meta.displayName ?? meta.category ?? "").toLowerCase();
                    extension = String(meta.extension ?? "").toLowerCase();
                    override = String(meta.override ?? "yes").toLowerCase();
                }
            } catch (e) {}
        }

        if (!category) {
            category = String(getWidgetValue(origin, ["category", "obj_name", "var_name"]) || "").toLowerCase();
        }

        built.push({
            category,
            extension,
            override,
            value,
            sceneKey: null
        });
    }

    const scene = {};
    const categoryCounts = {};

    for (let i = 0; i < built.length; i++) {
        const entry = built[i];

        if (!entry.extension) {
            if (entry.override === "no") {
                if (!(entry.category in categoryCounts)) categoryCounts[entry.category] = 0;
                categoryCounts[entry.category]++;
                const key = generateKey(entry.category, entry.value, categoryCounts[entry.category], scene);
                scene[key] = entry.value;
                entry.sceneKey = key;
            } else {
                const key = entry.category;
                if (scene[key] && typeof scene[key] === "object" && typeof entry.value === "object") {
                    scene[key] = deepMergeObjects(scene[key], entry.value);
                } else {
                    scene[key] = entry.value;
                }
                entry.sceneKey = key;
            }
            continue;
        }

        const targetCategory = entry.extension;
        let merged = false;

        // 1. Try to find target as a direct input
        for (let j = i - 1; j >= 0; j--) {
            const candidate = built[j];
            if (candidate.category !== targetCategory) continue;
            const targetKey = candidate.sceneKey;
            if (!targetKey) break;

            if (entry.override === "no") {
                const countKey = `${targetKey}::${entry.category}`;
                if (!(countKey in categoryCounts)) categoryCounts[countKey] = 0;
                categoryCounts[countKey]++;
                const subKey = generateKey(entry.category, entry.value, categoryCounts[countKey], scene[targetKey]);
                if (!scene[targetKey]) scene[targetKey] = {};
                scene[targetKey][subKey] = entry.value;
                entry.sceneKey = `${targetKey}.${subKey}`;
            } else {
                scene[targetKey] = deepMergeObjects(scene[targetKey], entry.value);
                entry.sceneKey = targetKey;
            }
            merged = true;
            break;
        }

        // 2. If not found directly, search INSIDE previous inputs' nested values
        if (!merged) {
            for (let j = 0; j < i; j++) {
                const candidate = built[j];
                if (!candidate.sceneKey || typeof candidate.value !== 'object') continue;

                const targetObj = getNestedValue(candidate.value, targetCategory);
                
                if (targetObj !== undefined && typeof targetObj === 'object') {
                    if (entry.override === "no") {
                        const countKey = `${candidate.sceneKey}::${targetCategory}::${entry.category}`;
                        if (!(countKey in categoryCounts)) categoryCounts[countKey] = 0;
                        categoryCounts[countKey]++;
                        
                        const currentSceneObj = getNestedValue(scene, `${candidate.sceneKey}.${targetCategory}`) || {};
                        const subKey = generateKey(entry.category, entry.value, categoryCounts[countKey], currentSceneObj);
                        
                        setNestedValue(scene, `${candidate.sceneKey}.${targetCategory}.${subKey}`, entry.value);
                        entry.sceneKey = `${candidate.sceneKey}.${targetCategory}.${subKey}`;
                    } else {
                        const currentSceneObj = getNestedValue(scene, `${candidate.sceneKey}.${targetCategory}`) || {};
                        const mergedObj = deepMergeObjects(currentSceneObj, entry.value);
                        setNestedValue(scene, `${candidate.sceneKey}.${targetCategory}`, mergedObj);
                        entry.sceneKey = `${candidate.sceneKey}.${targetCategory}`;
                    }
                    merged = true;
                    break;
                }
            }
        }
    }

    function removeEmpty(obj) {
        if (!obj || typeof obj !== "object") return obj;
        for (const key in obj) {
            const val = removeEmpty(obj[key]);
            if (val == null || (typeof val === "object" && Object.keys(val).length === 0)) {
                delete obj[key];
            }
        }
        return obj;
    }

    removeEmpty(scene);

    const json = JSON.stringify(scene, null, "\t");

    if (previewWidget && previewWidget.value !== json) {
        previewWidget.value = json;
        if (syncPreviewHeight) syncPreviewHeight();
    }

    let hiddenOutput = node.widgets.find(w => w.name === "output_json_string");
    if (!hiddenOutput) {
        hiddenOutput = node.addWidget("text", "output_json_string", "", () => {});
        hiddenOutput.hidden = true;
        hiddenOutput.computeSize = () => [0, -8];
        hiddenOutput.draw = () => {};
    }
    hiddenOutput.value = json;

    const dynamicInputs = node.inputs
        .map((slot, realIndex) => ({
            slot, realIndex,
            index: (slot && slot.name && slot.name.startsWith("input_"))
                ? parseInt(slot.name.substring(6)) || 0 : -1
        }))
        .filter(x => x.index >= 0)
        .sort((a, b) => a.index - b.index);

    if (dynamicInputs.length === 0) return;

    let changed = false;
    const last = dynamicInputs[dynamicInputs.length - 1];

    if (last.slot.link != null) {
        node.addInput(`input_${last.index + 1}`, "PROMPT_VAR");
        changed = true;
    }

    while (dynamicInputs.length > 1) {
        const lastEntry = dynamicInputs[dynamicInputs.length - 1];
        const prevEntry = dynamicInputs[dynamicInputs.length - 2];

        if (lastEntry.slot.link == null && prevEntry.slot.link == null) {
            const currentRealIndex = node.inputs.findIndex(s => s === lastEntry.slot);
            if (currentRealIndex !== -1) {
                node.removeInput(currentRealIndex);
                dynamicInputs.pop();
                changed = true;
                continue;
            }
        }
        break;
    }

    if (changed) node.setDirtyCanvas(true, true);
}


app.registerExtension({
    name: "Dragos.SceneBuilder.Dynamic",

    async nodeCreated(node) {
        if (
            node.comfyClass !== "DragosObject" &&
            node.comfyClass !== "DragosSceneCompiler" &&
            node.comfyClass !== "DragosStructuredBuilder"
        ) return;

        let previewWidget = null;
        let syncPreviewHeight = null;

        if (node.comfyClass === "DragosSceneCompiler") {
            previewWidget = ComfyWidgets.STRING(node, "preview", ["STRING", { multiline: true }], app).widget;
            previewWidget.inputEl.readOnly = true;
            previewWidget.inputEl.style.fontSize = "11px";
            previewWidget.inputEl.style.resize = "none";

            syncPreviewHeight = function() {
                if (!previewWidget?.inputEl || !node.size) return;
                const HEADER = LiteGraph.NODE_TITLE_HEIGHT || 30;
                const SLOT = LiteGraph.NODE_SLOT_HEIGHT || 20;
                const WIDGET_SPACING = 4;
                const BOTTOM_PADDING = 15;

                let widgetY = HEADER;
                for (const w of node.widgets) {
                    if (w === previewWidget) break;
                    const size = w.computeSize?.(node.size[0]);
                    widgetY += (size?.[1] || 20) + WIDGET_SPACING;
                }

                const inputCount = node.inputs?.length || 0;
                const inputsHeight = inputCount * SLOT - SLOT;
                const available = node.size[1] - widgetY - inputsHeight - BOTTOM_PADDING;
                previewWidget.inputEl.style.height = Math.max(available, 20) + "px";
            };

            const origOnResize = node.onResize;
            node.onResize = function() {
                if (origOnResize) origOnResize.apply(this, arguments);
                syncPreviewHeight();
            };

            requestAnimationFrame(() => {
                if (node.computeSize) node.setSize(node.computeSize());
                syncPreviewHeight();
                node.setDirtyCanvas(true, true);
            });

            setTimeout(() => {
                if (node.computeSize) node.setSize(node.computeSize());
                syncPreviewHeight();
                node.setDirtyCanvas(true, true);
            }, 100);
        }

        const graph = app.graph;
        const update = () => refreshNode(node, graph, previewWidget, syncPreviewHeight);

        const origConnectionsChange = node.onConnectionsChange;
        node.onConnectionsChange = function() {
            if (origConnectionsChange) origConnectionsChange.apply(this, arguments);
            update();
        };

        const origWidgetChanged = node.onWidgetChanged;
        node.onWidgetChanged = function() {
            if (origWidgetChanged) origWidgetChanged.apply(this, arguments);
            update();
        };

        const timer = setInterval(() => {
            if (!graph._nodes.includes(node)) {
                clearInterval(timer);
                return;
            }
            update();
        }, 500);

        update();
    }
});