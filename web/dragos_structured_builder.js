import { app } from "../../scripts/app.js";

const EXTENSION_NAME = "Dragos-SceneBuilder";

//
// Load schema
//
async function loadSchema(category) {
    try {
        const res = await fetch(`/extensions/${EXTENSION_NAME}/schema/${category}.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(res.status);
        return await res.json();
    } catch (err) {
        console.error("Schema load failed:", err);
        return null;
    }
}

//
// Utility
//
function prettifyLabel(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

//
// Clear dynamic widgets
//
function clearGeneratedWidgets(node) {
    node.widgets = node.widgets.filter(w => w.name === "category");
}

//
// Apply visibility & layout
//
function applyWidgetVisibility(node) {
    if (!node.size) node.size = [200, 100];

    let y = LiteGraph.NODE_WIDGET_HEIGHT || 20;

    for (const w of node.widgets) {
        if (!w) continue;

        if (w.hidden) {
            w.computeSize = () => [0, -4];
        }

        if (!w.computeSize) {
            w.computeSize = LiteGraph.WIDGET_DEFAULT?.computeSize || (() => [node.size[0], 20]);
        }

        const width = node.size[0] || 200;
        const size = w.computeSize(width);

        w.last_y = y;
        y += (size[1] || 20) + 4;
    }

    node.size[1] = y + 8;
}

//
// Show popup for "other" dropdown values
//
function attachOtherHandler(widget) {
    const origCallback = widget.callback;

    widget.callback = () => {
        if (origCallback) {
            origCallback.call(widget);
        }

        if (widget.value === "other") {
            const userInput = prompt(`Enter custom value for ${widget.name}:`, "");
            
            if (userInput !== null && userInput !== "") {
                widget.value = userInput;
            } else {
                widget.value = widget.options.values[0] || "";
            }
        }

        evaluateConditions(widget.node);
        applyWidgetVisibility(widget.node);
        app.graph.setDirtyCanvas(true, true);
    };
}

//
// Build widgets recursively
//
function buildWidgetsFromSchema(node, schema, path = "", inheritedConditions = {}) {
    const mergedConditions = { ...inheritedConditions, ...(schema._conditions || {}) };

    if (schema._static) {
        for (const key in schema._static) {
            const staticLabel = {
                type: "dragos_static_label",
                name: prettifyLabel(key),
                value: schema._static[key],
                dragosPath: key,
                isStatic: true,
                hidden: false,
                options: {},
                computeSize(width) { 
                    return this.hidden ? [0, -4] : [width, 20]; 
                },
                draw(ctx, node, width, y, height) {
                    if (this.hidden) return;
                    ctx.fillStyle = "#888";
                    ctx.font = "italic 13px Arial";
                    ctx.fillText(`${this.name}: ${this.value}`, 10, y + 14);
                }
            };
            node.widgets.push(staticLabel);
        }
    }

    for (const key in schema) {
        if (key.startsWith("_")) continue;

        const value = schema[key];
        const fullPath = path ? `${path}.${key}` : key;
        const meta = value?._meta || {};
        const label = meta.display_name || prettifyLabel(key);
        const depth = path ? path.split(".").length : 0;

        if (Array.isArray(value)) {
            const widget = node.addWidget(
                "combo",
                label,
                value[0],
                null, 
                { values: value }
            );
            
            attachOtherHandler(widget);

            widget.dragosPath = fullPath;
            widget.dragosConditions = { ...mergedConditions };
            continue;
        }

        if (typeof value === "object" && value !== null) {
            const header = {
                type: "dragos_header",
                name: label,
                value: null,
                options: {},
                size: [node.size[0], 20],
                dragosConditions: { ...mergedConditions },
                computeSize(width) { return this.hidden ? [0, -4] : [width, 20]; },
                draw(ctx, node, width, y, height) {
                    if (this.hidden) return;
                    ctx.fillStyle = "#aaa";
                    ctx.font = "bold 14px Arial";
                    const indent = 10 + depth * 18;
                    ctx.fillText(label, indent, y + 15);
                }
            };
            node.widgets.push(header);
            buildWidgetsFromSchema(node, value, fullPath, mergedConditions);
            continue;
        }

        if (typeof value === "string") {
            let defaultValue = "";
            if (value !== "") {
                defaultValue = value;
            }

            const widget = node.addWidget("text", label, defaultValue, () => {
                evaluateConditions(node);
                applyWidgetVisibility(node);
                app.graph.setDirtyCanvas(true, true);
            });
            widget.dragosPath = fullPath;
            widget.dragosConditions = { ...mergedConditions };
        }
    }
}

//
// Evaluate conditions
//
function evaluateConditions(node) {
    const values = {};
    for (const w of node.widgets) {
        if (!w.dragosPath) continue;
        values[w.dragosPath.split(".").pop()] = w.value;
    }
    for (const w of node.widgets) {
        if (!w.dragosConditions) continue;
        let visible = true;
        for (const condKey in w.dragosConditions) {
            const allowed = w.dragosConditions[condKey];
            const current = values[condKey];
            if (!current || !allowed.includes(current)) {
                visible = false;
                break;
            }
        }
        w.hidden = !visible;
    }
}

//
// Deep merge objects
//
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

//
// Get value from connected nodes
//
function getInputValue(node, graph) {
    if (!node) return undefined;
    if (node.mode === 2 || node.mode === 4) return undefined;

    const getWidgetValue = (n, names) => {
        if (!n.widgets) return null;
        for (const name of names) {
            const w = n.widgets.find(w => w.name === name);
            if (w) return w.value;
        }
        return null;
    };

    if (node.comfyClass === "DragosVariable") {
        return getWidgetValue(node, ["text"]) ?? "";
    }

    if (node.comfyClass === "DragosStructuredBuilder") {
        const jsonWidget = node.widgets?.find(w => w.name === "json_data");
        if (jsonWidget?.value) {
            try {
                const parsed = JSON.parse(jsonWidget.value);
                return parsed.data || {};
            } catch (e) {
                return {};
            }
        }
        return {};
    }

    if (node.comfyClass === "DragosObject") {
        const result = {};
        for (const input of node.inputs || []) {
            if (input.link == null) continue;
            const link = graph.links[input.link];
            if (!link) continue;
            const origin = graph.getNodeById(link.origin_id);
            if (!origin || origin.mode === 2 || origin.mode === 4) continue;

            const key = getWidgetValue(origin, ["var_name", "obj_name"]) ?? input.name;
            const value = getInputValue(origin, graph);
            if (value !== undefined) {
                result[key] = value;
            }
        }
        return result;
    }

    return undefined;
}

//
// Update json_data with connected inputs
//
function updateJsonWithInputs(node, graph) {
    const jsonWidget = node.widgets?.find(w => w.name === "json_data");
    if (!jsonWidget?.value) return;

    try {
        const parsed = JSON.parse(jsonWidget.value);
        const baseData = parsed.data || {};
        const meta = parsed._meta || {};

        const inputValues = {};
        const extensions = [];

        if (node.inputs) {
            for (const input of node.inputs) {
                if (!input || input.link == null) continue;
                if (!input.name || !input.name.startsWith("input_")) continue;

                const link = graph.links[input.link];
                if (!link) continue;

                const origin = graph.getNodeById(link.origin_id);
                if (!origin || origin.mode === 2 || origin.mode === 4) continue;

                const inputValue = getInputValue(origin, graph);
                if (inputValue === undefined) continue;

                const originJsonWidget = origin.widgets?.find(w => w.name === "json_data");
                let isExtension = false;
                let extensionTarget = "";

                if (originJsonWidget?.value) {
                    try {
                        const parsedOrigin = JSON.parse(originJsonWidget.value);
                        if (parsedOrigin._meta?.extension) {
                            isExtension = true;
                            extensionTarget = parsedOrigin._meta.extension;
                        }
                    } catch (e) {}
                }

                if (isExtension) {
                    if (extensionTarget === meta.category) {
                        if (typeof inputValue === "object" && inputValue !== null) {
                            extensions.push(inputValue);
                        }
                    }
                } else {
                    const inputName = 
                        origin.widgets?.find(w => w.name === "var_name")?.value ||
                        origin.widgets?.find(w => w.name === "obj_name")?.value;

                    if (inputName) {
                        if (typeof inputValue === "object" && inputValue !== null) {
                            inputValues[inputName] = deepMergeObjects(inputValues[inputName] || {}, inputValue);
                        } else {
                            inputValues[inputName] = inputValue;
                        }
                    }
                }
            }
        }

        let mergedData = deepMergeObjects(baseData, inputValues);

        for (const ext of extensions) {
            mergedData = deepMergeObjects(mergedData, ext);
        }

        const updated = {
            _meta: meta,
            data: mergedData
        };
        jsonWidget.value = JSON.stringify(updated);
        node.properties = node.properties || {};
        node.properties.json_data = jsonWidget.value;

    } catch (e) {
        console.error("Failed to update json_data with inputs:", e);
    }
}

//
// Manage dynamic inputs for DragosStructuredBuilder
//
function manageDynamicInputs(node, graph) {
    if (!node.inputs) return;

    const dynamicInputs = node.inputs
        .map((slot, realIndex) => ({
            slot,
            realIndex,
            index: (
                slot &&
                slot.name &&
                slot.name.startsWith("input_")
            )
                ? parseInt(slot.name.substring(6)) || 0
                : -1
        }))
        .filter(x => x.index >= 0)
        .sort((a, b) => a.index - b.index);

    if (dynamicInputs.length === 0) return;

    let changed = false;

    const last = dynamicInputs[dynamicInputs.length - 1];

    if (last.slot.link != null) {
        node.addInput(
            `input_${last.index + 1}`,
            "PROMPT_VAR"
        );
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

    if (changed) {
        node.setDirtyCanvas(true, true);
    }

    updateJsonWithInputs(node, graph);
}

function buildNestedObjectFromWidgets(node) {
    const result = {};

    for (const w of node.widgets) {
        if (!w.dragosPath || w.hidden) continue;

        const value =
            w._otherPopupValue !== undefined
                ? w._otherPopupValue
                : w.value;

        if (
            value === "" ||
            value === null ||
            value === undefined
        ) continue;

        const keys = w.dragosPath.split(".");
        let current = result;

        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];

            if (i === keys.length - 1) {
                current[k] = value;
            } else {
                if (!(k in current))
                    current[k] = {};

                current = current[k];
            }
        }
    }

    return result;
}

//
// Rebuild UI safely
//
async function rebuild(node) {
    const categoryWidget = node.widgets.find(w => w.name === "category");
    if (!categoryWidget) return;

    const schema = await loadSchema(categoryWidget.value);
    if (!schema) return;

    let savedData = {};
    if (node.properties?.json_data) {
        try {
            const parsed = JSON.parse(node.properties.json_data);
            savedData = parsed.data || {};
        } catch {}
    }

    node.widgets = node.widgets.filter(w => w.name === "category");

    buildWidgetsFromSchema(node, schema);

    for (const w of node.widgets) {
        if (!w.dragosPath) continue;
        if (w.isStatic) continue;
        
        const keys = w.dragosPath.split(".");
        let current = savedData;

        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (i === keys.length - 1 && current && k in current) {
                w.value = current[k];
            } else if (current && k in current) {
                current = current[k];
            } else {
                current = null;
            }
        }
    }

    evaluateConditions(node);
    applyWidgetVisibility(node);

    const data = buildNestedObjectFromWidgets(node);
    const schemaMeta = schema._meta || {};
    const displayName = schemaMeta.display_name || schemaMeta.displayName || categoryWidget.value || "";

    const final = {
        _meta: {
            category: String(displayName).toLowerCase(),
            extension: String(schemaMeta.extension || "").toLowerCase(),
            schema: String(categoryWidget.value || "").toLowerCase(),
            override: String(schemaMeta.override || "yes").toLowerCase()
        },
        data: data
    };

    let jsonWidget = node.widgets.find(w => w.name === "json_data");
    if (!jsonWidget) {
        jsonWidget = node.addWidget("text", "json_data", "", () => {});
        jsonWidget.hidden = true;
        jsonWidget.computeSize = () => [0, -8];
        jsonWidget.draw = () => {};
    }
    jsonWidget.value = JSON.stringify(final);

    node.properties = node.properties || {};
    node.properties.json_data = jsonWidget.value;

    for (const w of node.widgets) {
        if (!w.dragosPath) continue;

        const origCallback = w.callback;
        w.callback = function() {
            if (origCallback) origCallback.call(this);

            const updatedData = buildNestedObjectFromWidgets(node);
            const updatedFinal = {
                _meta: final._meta,
                data: updatedData
            };
            jsonWidget.value = JSON.stringify(updatedFinal);
            node.properties.json_data = jsonWidget.value;

            evaluateConditions(node);
            applyWidgetVisibility(node);
            app.graph.setDirtyCanvas(true, true);
        };
    }

    if (node.computeSize)
        node.setSize(node.computeSize());

    app.graph.setDirtyCanvas(true, true);
}

//
// Extension registration
//
app.registerExtension({
    name: "Dragos.StructuredBuilder",
    nodeCreated(node) {
        if (node.comfyClass !== "DragosStructuredBuilder") return;

        const categoryWidget = node.widgets.find(w => w.name === "category");
        if (!categoryWidget) return;

        const graph = app.graph;

        const originalCallback = categoryWidget.callback;
        categoryWidget.callback = async function(value) {
            if (originalCallback) originalCallback.call(this, value);
            await rebuild(node);
        };

        const origConnectionsChange = node.onConnectionsChange;
        node.onConnectionsChange = function() {
            if (origConnectionsChange) origConnectionsChange.apply(this, arguments);
            manageDynamicInputs(node, graph);
        };

        const timer = setInterval(() => {
            if (!graph._nodes.includes(node)) {
                clearInterval(timer);
                return;
            }
            updateJsonWithInputs(node, graph);
        }, 500);

        setTimeout(() => rebuild(node), 10);
    }
});