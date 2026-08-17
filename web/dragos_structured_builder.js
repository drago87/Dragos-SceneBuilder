import { app } from "../../scripts/app.js";

console.log("Dragos Structured Builder loaded");

const EXTENSION_NAME = "Dragos-SceneBuilder"; // Make sure this matches your folder name!

// Create a link element for the external CSS
const link = document.createElement("link");
link.rel = "stylesheet";
link.type = "text/css";
// ComfyUI serves files from your WEB_DIRECTORY under /extensions/<your_folder_name>/
link.href = `/extensions/${EXTENSION_NAME}/dragos_multiselect.css`;
document.head.appendChild(link);

// ===================================================================
// Schema loading
// ===================================================================
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

// ===================================================================
// Utility
// ===================================================================
function prettifyLabel(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ===================================================================
// Find multi_select config for a field
// ===================================================================
function findMultiSelectConfig(schemaRoot, fieldName) {
    const meta = schemaRoot?._meta;
    if (!meta?.multi_selects) return null;

    for (const config of meta.multi_selects) {
        if (config.applies_to?.includes(fieldName)) return config;
    }
    return null;
}

// ===================================================================
// Clear dynamic widgets (also clean up DOM elements)
// ===================================================================
function clearGeneratedWidgets(node) {
    for (const w of node.widgets) {
        if (w.name === "category") continue;
        // Remove DOM element if present
        if (w.element && w.element.parentNode) {
            w.element.parentNode.removeChild(w.element);
        }
    }
    node.widgets = node.widgets.filter(w => w.name === "category");
}

// ===================================================================
// Apply visibility & layout
// ===================================================================
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

// ===================================================================
// Show popup for "other" dropdown values (standard combo)
// ===================================================================
function attachOtherHandler(widget) {
    const origCallback = widget.callback;

    widget.callback = () => {
        if (origCallback) origCallback.call(widget);

        if (widget.value === "other" || widget.value === "Other") {
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

// ===================================================================
// Multi-Select: Build groups from values + dividers
// ===================================================================
function buildGroups(values, dividers) {
    const dividerSet = new Set(dividers || []);
    const groups = [];
    let currentGroup = null;

    for (const val of values) {
        if (dividerSet.has(val)) {
            if (currentGroup) groups.push(currentGroup);
            currentGroup = { name: val, items: [] };
        } else {
            if (!currentGroup) currentGroup = { name: "", items: [] };
            currentGroup.items.push(val);
        }
    }
    if (currentGroup) groups.push(currentGroup);
    return groups;
}

// ===================================================================
// Multi-Select: Serialize selected items
// ===================================================================
function serializeMultiSelectValue(selectedItems, config) {
    const tags = config?.tags;
    const allowWeight = config?.allow_weight === true;
    const hasTags = tags?.prefix && tags?.separator;

    if (hasTags && allowWeight) {
        // "artist:Rembrandt:1.20" format
        return selectedItems.map(item => {
            const val = item.otherText || item.value;
            if (item.weight !== undefined && item.weight !== 1.0) {
                return `${tags.prefix}${tags.separator}${val}${tags.separator}${item.weight.toFixed(2)}`;
            }
            return `${tags.prefix}${tags.separator}${val}`;
        });
    }

    if (hasTags && !allowWeight) {
        // "artist:Rembrandt" format
        return selectedItems.map(item => {
            const val = item.otherText || item.value;
            return `${tags.prefix}${tags.separator}${val}`;
        });
    }

    if (!hasTags && allowWeight) {
        // [{value: "Rembrandt", weight: 1.20}]
        return selectedItems.map(item => ({
            value: item.otherText || item.value,
            weight: item.weight
        }));
    }

    // ["Rembrandt", "Caravaggio"]
    return selectedItems.map(item => item.otherText || item.value);
}

// ===================================================================
// Multi-Select: Restore value from saved data
// ===================================================================
function restoreMultiSelectValue(widget, savedValue, config) {
    if (!Array.isArray(savedValue) || savedValue.length === 0) return;

    const tags = config?.tags;
    const allowWeight = config?.allow_weight === true;
    const hasTags = tags?.prefix && tags?.separator;
    const selectedItems = widget._selectedItems;

    if (hasTags && allowWeight) {
        // ["artist:Rembrandt:1.20", "artist:Caravaggio"]
        for (const entry of savedValue) {
            if (typeof entry !== "string") continue;
            const parts = entry.split(tags.separator);
            // prefix:value or prefix:value:weight
            if (parts.length >= 2) {
                const val = parts[1];
                const weight = parts.length >= 3 ? parseFloat(parts[2]) : 1.0;
                const isOther = !widget._allValues.includes(val);
                selectedItems.push({
                    value: isOther ? "Other" : val,
                    weight: weight,
                    otherText: isOther ? val : ""
                });
            }
        }
    } else if (hasTags && !allowWeight) {
        // ["artist:Rembrandt", "artist:Caravaggio"]
        for (const entry of savedValue) {
            if (typeof entry !== "string") continue;
            const parts = entry.split(tags.separator);
            if (parts.length >= 2) {
                const val = parts[1];
                const isOther = !widget._allValues.includes(val);
                selectedItems.push({
                    value: isOther ? "Other" : val,
                    weight: 1.0,
                    otherText: isOther ? val : ""
                });
            }
        }
    } else if (!hasTags && allowWeight) {
        // [{value: "Rembrandt", weight: 1.20}]
        for (const entry of savedValue) {
            if (typeof entry === "object" && entry.value) {
                const isOther = !widget._allValues.includes(entry.value);
                selectedItems.push({
                    value: isOther ? "Other" : entry.value,
                    weight: entry.weight ?? 1.0,
                    otherText: isOther ? entry.value : ""
                });
            }
        }
    } else {
        // ["Rembrandt", "Caravaggio"]
        for (const entry of savedValue) {
            if (typeof entry === "string") {
                const isOther = !widget._allValues.includes(entry);
                selectedItems.push({
                    value: isOther ? "Other" : entry,
                    weight: 1.0,
                    otherText: isOther ? entry : ""
                });
            }
        }
    }
}

// ===================================================================
// Multi-Select: Create DOM Widget
// ===================================================================
function createMultiSelectWidget(node, label, values, config, fullPath) {
	//node.setSize([
	//	Math.max(node.size[0], 500),
	//	Math.max(node.size[1], 350)
	//]);
    const allowWeight = config?.allow_weight === true;
    const dividers = config?.dividers || [];
    const hasOther = values.includes("Other");
    const selectableValues = values.filter(v => !new Set(dividers).has(v));

    // Container element
    const container = document.createElement("div");
    container.className = "dragos-ms";

    // Build groups
    const groups = buildGroups(values, dividers);

    // Widget state
    const selectedItems = []; // [{value, weight, otherText}]

    // Track expanded state
    const expandedGroups = {};
    for (const g of groups) {
        expandedGroups[g.name] = true;
    }

    // Create the widget object
    const widget = {
        type: "dragos_multiselect",
        name: label,
        dragosPath: fullPath,
        dragosConditions: {},
        value: [],
        hidden: false,
        element: container,
        _selectedItems: selectedItems,
        _groups: groups,
        _allValues: values,
        _config: config,
        _allowWeight: allowWeight,
        _hasOther: hasOther,
        _expandedGroups: expandedGroups,
        _searchTerm: "",
        _node: node,
        callback: null,

		computeSize(width) {
			if (this.hidden) return [0, -4];
		
			const nodeHeight = this._node?.size?.[1] || 400;
		
			return [
				width,
				Math.max(320, nodeHeight - 70)
			];
		},
	
		getValue() {
			return serializeMultiSelectValue(this._selectedItems, this._config);
		},

        setValue(savedValue) {
            this._selectedItems.length = 0;
            if (Array.isArray(savedValue)) {
                restoreMultiSelectValue(this, savedValue, this._config);
            }
        }
    };

    // Build the DOM
    buildMultiSelectDOM(widget, container, groups, selectedItems, allowWeight, hasOther, config);
	
	console.log("Creating multiselect:", label);
	
    // Register as DOM widget
    const domWidget = node.addDOMWidget(label, "dragos_multiselect", container, {
        getValue: () => widget.getValue(),
        setValue: (v) => widget.setValue(v),
    });
	
	const origResize = node.onResize;

	node.onResize = function(size) {
		size[0] = Math.max(size[0], 500);
	
		const widgetHeight = Math.max(250, size[1] - 70);
		container.style.height = `${widgetHeight}px`;
	
		if (origResize) {
			return origResize.call(this, size);
		}
	};
	
    // Copy our custom properties to the returned widget
    Object.assign(domWidget, {
        dragosPath: fullPath,
        dragosConditions: {},
        _selectedItems: selectedItems,
        _groups: groups,
        _allValues: values,
        _config: config,
        _allowWeight: allowWeight,
        _hasOther: hasOther,
        _expandedGroups: expandedGroups,
        _node: node,
        _innerWidget: widget,
    });

    // Override computeSize on the DOM widget
		domWidget.computeSize = function(width) {
		if (this.hidden) return [0, -4];
	
		const nodeHeight = this._node?.size?.[1] || 400;
	
		return [
			width,
			Math.max(320, nodeHeight - 70)
		];
	};

    // getValue/setValue on the dom widget
    domWidget.getValue = function() {
        return serializeMultiSelectValue(this._selectedItems, this._config);
    };
    domWidget.setValue = function(v) {
        this._selectedItems.length = 0;
        if (Array.isArray(v)) {
            restoreMultiSelectValue(this, v, this._config);
        }
    };

    return domWidget;
}

// ===================================================================
// Multi-Select: Build the full DOM structure
// ===================================================================
function buildMultiSelectDOM(widget, container, groups, selectedItems, allowWeight, hasOther, config) {

    container.innerHTML = "";

    // ---- Search ----
    const searchDiv = document.createElement("div");
    searchDiv.className = "dragos-ms-search";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search...";
    searchDiv.appendChild(searchInput);
    container.appendChild(searchDiv);

    // ---- Panels ----
    const panelsDiv = document.createElement("div");
    panelsDiv.className = "dragos-ms-panels";

    const leftPanel = document.createElement("div");
    leftPanel.className = "dragos-ms-left";

    const rightPanel = document.createElement("div");
    rightPanel.className = "dragos-ms-right";

    panelsDiv.appendChild(leftPanel);
    panelsDiv.appendChild(rightPanel);
    container.appendChild(panelsDiv);

    // ---- Tags preview ----
    const tagsConfig = config?.tags;
    if (tagsConfig) {
        const tagsPreview = document.createElement("div");
        tagsPreview.className = "dragos-ms-tags-preview";
        container.appendChild(tagsPreview);
    }

    // ---- Render functions ----

    function renderLeftPanel(searchTerm) {
        leftPanel.innerHTML = "";
        const term = (searchTerm || "").toLowerCase().trim();
        let hasAnyVisible = false;

        for (const group of groups) {
            const filteredItems = term
                ? group.items.filter(item => item.toLowerCase().includes(term))
                : group.items;

            if (term && filteredItems.length === 0) continue;
            hasAnyVisible = true;

            // Group header
            const groupHeader = document.createElement("div");
            groupHeader.className = "dragos-ms-group-header";

            const isExpanded = term
				? true
				: (widget._expandedGroups[group.name] ?? false);
            const selectedInGroup = group.items.filter(v =>
                selectedItems.some(s => s.value === v)
            ).length;
            const totalCount = group.items.length;

            const arrow = document.createElement("span");
            arrow.className = "dragos-ms-arrow";
            arrow.textContent = isExpanded ? "\u25BC" : "\u25B6";

            const nameSpan = document.createElement("span");
            nameSpan.textContent = group.name || "Ungrouped";

            const countSpan = document.createElement("span");
            countSpan.className = "dragos-ms-group-count";
            countSpan.textContent = `${selectedInGroup}/${totalCount}`;

            groupHeader.appendChild(arrow);
            groupHeader.appendChild(nameSpan);
            groupHeader.appendChild(countSpan);
            leftPanel.appendChild(groupHeader);

            // Group items
            const itemsDiv = document.createElement("div");
            itemsDiv.className = "dragos-ms-group-items" + (isExpanded ? "" : " collapsed");

            for (const item of filteredItems) {
                const itemDiv = document.createElement("div");
                itemDiv.className = "dragos-ms-item";

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = selectedItems.some(s => s.value === item);

                // Highlight search match
                const labelSpan = document.createElement("span");
                if (term) {
                    const idx = item.toLowerCase().indexOf(term);
                    if (idx >= 0) {
                        labelSpan.innerHTML =
                            escapeHtml(item.substring(0, idx)) +
                            "<mark>" + escapeHtml(item.substring(idx, idx + term.length)) + "</mark>" +
                            escapeHtml(item.substring(idx + term.length));
                    } else {
                        labelSpan.textContent = item;
                    }
                } else {
                    labelSpan.textContent = item;
                }

                itemDiv.appendChild(checkbox);
                itemDiv.appendChild(labelSpan);
                itemsDiv.appendChild(itemDiv);

                // Checkbox change handler
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) {
                        if (!selectedItems.some(s => s.value === item)) {
                            selectedItems.push({
                                value: item,
                                weight: 1.0,
                                otherText: ""
                            });
                        }
                    } else {
                        const idx = selectedItems.findIndex(s => s.value === item);
                        if (idx >= 0) selectedItems.splice(idx, 1);
                    }
                    updateGroupCount(countSpan, group);
                    renderRightPanel();
                    updateTagsPreview();
                    triggerUpdate();
                });
            }

            leftPanel.appendChild(itemsDiv);

            // Toggle collapse
            groupHeader.addEventListener("click", () => {
                if (term) return; // Don't toggle during search
                widget._expandedGroups[group.name] = !widget._expandedGroups[group.name];
                arrow.textContent = widget._expandedGroups[group.name] ? "\u25BC" : "\u25B6";
                itemsDiv.classList.toggle("collapsed");
            });
        }

        if (!hasAnyVisible) {
            leftPanel.innerHTML = '<div class="dragos-ms-no-results">No matches found</div>';
        }
    }

    function renderRightPanel() {
        rightPanel.innerHTML = "";

        // Header
        const rightHeader = document.createElement("div");
        rightHeader.className = "dragos-ms-right-header";

        const headerLabel = document.createElement("span");
        headerLabel.textContent = `Selected (${selectedItems.length})`;

        rightHeader.appendChild(headerLabel);

        if (selectedItems.length > 0) {
            const clearBtn = document.createElement("button");
            clearBtn.className = "dragos-ms-clear-btn";
            clearBtn.textContent = "Clear All";
            clearBtn.addEventListener("click", () => {
                selectedItems.length = 0;
                renderLeftPanel(searchInput.value);
                renderRightPanel();
                updateTagsPreview();
                triggerUpdate();
            });
            rightHeader.appendChild(clearBtn);
        }

        rightPanel.appendChild(rightHeader);

        if (selectedItems.length === 0) {
            const empty = document.createElement("div");
            empty.className = "dragos-ms-empty";
            empty.textContent = "Nothing selected";
            rightPanel.appendChild(empty);
            return;
        }

        // Selected items
        for (let i = 0; i < selectedItems.length; i++) {
            const item = selectedItems[i];

            // Item row
            const itemRow = document.createElement("div");
            itemRow.className = "dragos-ms-selected-item";

            const nameSpan = document.createElement("span");
            nameSpan.className = "dragos-ms-selected-name";
            nameSpan.textContent = item.otherText || item.value;

            const removeBtn = document.createElement("button");
            removeBtn.className = "dragos-ms-remove-btn";
            removeBtn.innerHTML = "&times;";
            removeBtn.addEventListener("click", () => {
                selectedItems.splice(i, 1);
                renderLeftPanel(searchInput.value);
                renderRightPanel();
                updateTagsPreview();
                triggerUpdate();
            });

            itemRow.appendChild(nameSpan);
            itemRow.appendChild(removeBtn);
            rightPanel.appendChild(itemRow);

            // "Other" custom text input
            if (item.value === "Other") {
                const otherDiv = document.createElement("div");
                otherDiv.className = "dragos-ms-other-input";

                const otherLabel = document.createElement("span");
                otherLabel.className = "dragos-ms-other-label";
                otherLabel.textContent = "Custom:";

                const otherInput = document.createElement("input");
                otherInput.type = "text";
                otherInput.value = item.otherText || "";
                otherInput.placeholder = "Type custom value...";

                otherInput.addEventListener("input", () => {
                    item.otherText = otherInput.value;
                    nameSpan.textContent = item.otherText || "Other";
                    updateTagsPreview();
                    triggerUpdate();
                });

                otherDiv.appendChild(otherLabel);
                otherDiv.appendChild(otherInput);
                rightPanel.appendChild(otherDiv);
            }

            // Weight slider (if allow_weight)
            if (allowWeight) {
                const weightDiv = document.createElement("div");
                weightDiv.className = "dragos-ms-weight";

                const weightSlider = document.createElement("input");
                weightSlider.type = "range";
                weightSlider.min = "-10.00";
                weightSlider.max = "10.00";
                weightSlider.step = "0.05";
                weightSlider.value = String(item.weight);

                const weightVal = document.createElement("span");
                weightVal.className = "dragos-ms-weight-val";
                weightVal.textContent = item.weight.toFixed(2);

                weightSlider.addEventListener("input", () => {
                    item.weight = parseFloat(weightSlider.value);
                    weightVal.textContent = item.weight.toFixed(2);
                    updateTagsPreview();
                    triggerUpdate();
                });

                weightDiv.appendChild(weightSlider);
                weightDiv.appendChild(weightVal);
                rightPanel.appendChild(weightDiv);
            }
        }
    }

    function updateGroupCount(countEl, group) {
        const selectedInGroup = group.items.filter(v =>
            selectedItems.some(s => s.value === v)
        ).length;
        countEl.textContent = `${selectedInGroup}/${group.items.length}`;
    }

    function updateTagsPreview() {
        const previewEl = container.querySelector(".dragos-ms-tags-preview");
        if (!previewEl) return;

        if (selectedItems.length === 0) {
            previewEl.innerHTML = '<span style="color:var(--ms-text-muted)">No selection</span>';
            return;
        }

        const serialized = serializeMultiSelectValue(selectedItems, config);
        if (Array.isArray(serialized)) {
            previewEl.innerHTML = serialized.map(s => {
                const display = typeof s === "string" ? s : JSON.stringify(s);
                return `<span>${escapeHtml(display)}</span>`;
            }).join(", ");
        }
    }

    function triggerUpdate() {
        // Update widget value for serialization
        widget.value = serializeMultiSelectValue(selectedItems, config);

        // Trigger node update
        const jsonWidget = widget._node?.widgets?.find(w => w.name === "json_data");
        if (jsonWidget) {
            const updatedData = buildNestedObjectFromWidgets(widget._node);
            const categoryWidget = widget._node.widgets.find(w => w.name === "category");
            const schemaRoot = widget._node.dragosSchemaRoot;
            const schemaMeta = schemaRoot?._meta || {};
            const displayName = schemaMeta.display_name || schemaMeta.displayName || categoryWidget?.value || "";

            const final = {
                _meta: {
                    category: String(displayName).toLowerCase(),
                    extension: String(schemaMeta.extension || "").toLowerCase(),
                    schema: String(categoryWidget?.value || "").toLowerCase(),
                    override: String(schemaMeta.override || "yes").toLowerCase()
                },
                data: updatedData
            };
            jsonWidget.value = JSON.stringify(final);
            widget._node.properties = widget._node.properties || {};
            widget._node.properties.json_data = jsonWidget.value;
        }

        evaluateConditions(widget._node);
        applyWidgetVisibility(widget._node);
        app.graph.setDirtyCanvas(true, true);
    }

    // Search handler
    searchInput.addEventListener("input", () => {
        renderLeftPanel(searchInput.value);
    });
	
	widget._expandedGroups = widget._expandedGroups || {};

	for (const group of groups) {
		if (!(group.name in widget._expandedGroups)) {
			widget._expandedGroups[group.name] = false;
		}
	}

    // Initial render
    renderLeftPanel("");
    renderRightPanel();
    updateTagsPreview();
}

// ===================================================================
// HTML escape utility
// ===================================================================
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ===================================================================
// Build widgets recursively (with multi_selects support)
// ===================================================================
function buildWidgetsFromSchema(node, schema, path = "", inheritedConditions = {}) {
    const mergedConditions = { ...inheritedConditions, ...(schema._conditions || {}) };

    // Static labels
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
            // Check if this field has a multi_select config
            const multiConfig = findMultiSelectConfig(node.dragosSchemaRoot, key);

            if (multiConfig) {
                // Create multi-select DOM widget
                const widget = createMultiSelectWidget(
                    node,
                    label,
                    value,
                    multiConfig,
                    fullPath
                );
                widget.dragosConditions = { ...mergedConditions };
                continue;
            }

            // Standard combo widget
            const widget = node.addWidget(
                "combo",
                label,
                value[0] || "",
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

// ===================================================================
// Evaluate conditions
// ===================================================================
function evaluateConditions(node) {
    const values = {};
    for (const w of node.widgets) {
        if (!w.dragosPath) continue;
        let val = w.value;
        // For multi-select widgets, use first value for condition matching
        if (w.type === "dragos_multiselect") {
            const items = w._selectedItems;
            val = items.length > 0 ? (items[0].otherText || items[0].value) : "";
        }
        values[w.dragosPath.split(".").pop()] = val;
    }
    for (const w of node.widgets) {
        if (!w.dragosConditions || !Object.keys(w.dragosConditions).length) continue;
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
        // Hide DOM element if present
        if (w.element) {
            w.element.style.display = w.hidden ? "none" : "";
        }
    }
}

// ===================================================================
// Deep merge objects
// ===================================================================
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

// ===================================================================
// Get value from connected nodes
// ===================================================================
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

// ===================================================================
// Update json_data with connected inputs
// ===================================================================
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

// ===================================================================
// Manage dynamic inputs for DragosStructuredBuilder
// ===================================================================
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

// ===================================================================
// Build nested object from widgets (handles multi-select arrays)
// ===================================================================
function buildNestedObjectFromWidgets(node) {
    const result = {};

    for (const w of node.widgets) {
        if (!w.dragosPath || w.hidden) continue;

        let value;
        if (w._otherPopupValue !== undefined) {
            value = w._otherPopupValue;
        } else if (w.type === "dragos_multiselect") {
            value = structuredClone(w.getValue());
        } else {
            value = w.value;
        }

        if (
            value === "" ||
            value === null ||
            value === undefined ||
            (Array.isArray(value) && value.length === 0)
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

// ===================================================================
// Rebuild UI safely
// ===================================================================
async function rebuild(node) {
    const categoryWidget = node.widgets.find(w => w.name === "category");
    if (!categoryWidget) return;

    const schema = await loadSchema(categoryWidget.value);
    if (!schema) return;

    // Store schema root for multi_select config lookup
    node.dragosSchemaRoot = schema;

    let savedData = {};
    if (node.properties?.json_data) {
        try {
            const parsed = JSON.parse(node.properties.json_data);
            savedData = parsed.data || {};
        } catch {}
    }

    // Clean up old widgets (remove DOM elements too)
    clearGeneratedWidgets(node);

    buildWidgetsFromSchema(node, schema);

    // Restore saved values
    for (const w of node.widgets) {
        if (!w.dragosPath) continue;
        if (w.isStatic) continue;

        const keys = w.dragosPath.split(".");
        let current = savedData;

        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (i === keys.length - 1 && current && k in current) {
                const savedVal = current[k];
                if (w.type === "dragos_multiselect") {
                    if (Array.isArray(savedVal)) {
                        w.setValue(savedVal);
                        // Re-render the right panel and checkboxes after restore
                        const container = w.element;
                        if (container) {
                            // Find and re-render
                            const rightPanel = container.querySelector(".dragos-ms-right");
                            const leftPanel = container.querySelector(".dragos-ms-left");
                            if (rightPanel) {
                                // Trigger a full re-render by re-building the DOM
                                rebuildMultiSelectDOM(w);
                            }
                        }
                    }
                } else {
                    w.value = savedVal;
                }
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

        if (w.type === "dragos_multiselect") {
            // Multi-select widgets handle their own callbacks internally
            continue;
        }

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

// ===================================================================
// Rebuild multi-select DOM after restoring values
// ===================================================================
function rebuildMultiSelectDOM(widget) {
    const container = widget.element;
    if (!container) return;

    const selectedItems = widget._selectedItems;
    const groups = widget._groups;
    const allowWeight = widget._allowWeight;
    const hasOther = widget._hasOther;
    const config = widget._config;
    const node = widget._node;

    // Clear and rebuild
    buildMultiSelectDOM(
        widget._innerWidget || widget,
        container,
        groups,
        selectedItems,
        allowWeight,
        hasOther,
        config
    );
}

// ===================================================================
// Extension registration
// ===================================================================
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
