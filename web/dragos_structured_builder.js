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
		if (!node.size) node.size = [200, 100]; // default fallback

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
	// Store the original callback if it exists
	const origCallback = widget.callback;

	widget.callback = () => {
		// Run the original callback first
		if (origCallback) {
			origCallback.call(widget);
		}

		// Check if the selected value is "other"
		if (widget.value === "other") {
			const userInput = prompt(`Enter custom value for ${widget.name}:`, "");
			
			if (userInput !== null && userInput !== "") {
				// Set the widget value to the custom input
				widget.value = userInput;
			} else {
				// If cancelled or empty, revert to the first option
				widget.value = widget.options.values[0] || "";
			}
		}

		// Trigger visibility update in case conditions depend on this value
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

	// Capture static values from _static (displayed as labels, included in output, never restored)
	if (schema._static) {
		for (const key in schema._static) {
			const staticLabel = {
				type: "dragos_static_label",
				name: prettifyLabel(key),
				value: schema._static[key],
				dragosPath: key, // Allows buildNestedObjectFromWidgets to pick it up automatically
				isStatic: true,
				hidden: false,
				options: {},
				computeSize(width) { 
					return this.hidden ? [0, -4] : [width, 20]; 
				},
				draw(ctx, node, width, y, height) {
					if (this.hidden) return;
					// Draw as a gray, italic label (e.g., "Gender: Male")
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

		// 1. Dropdown (Array)
		if (Array.isArray(value)) {
			const widget = node.addWidget(
				"combo",
				label,
				value[0],
				// We pass null here because we will attach the handler manually below
				null, 
				{ values: value }
			);
			
			// Attach the "other" popup handler
			attachOtherHandler(widget);

			widget.dragosPath = fullPath;
			widget.dragosConditions = { ...mergedConditions };
			continue;
		}

		// 2. Nested object -> Header
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

		// 3. Text field (String)
		if (typeof value === "string") {
			// Determine default value:
			// If value is "string" (type hint) or empty "", use empty string.
			// Otherwise, use the value itself (e.g., "Eiko").
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
				)
				{
						result[key] = deepMergeObjects(result[key], override[key]);
				}
				else
				{
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

	// Get widget value helper
	const getWidgetValue = (n, names) => {
		if (!n.widgets) return null;
		for (const name of names) {
			const w = n.widgets.find(w => w.name === name);
			if (w) return w.value;
		}
		return null;
	};

	// DragosVariable returns its text value
	if (node.comfyClass === "DragosVariable") {
		return getWidgetValue(node, ["text"]) ?? "";
	}

	// DragosStructuredBuilder returns its compiled data object
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

	// DragosObject returns merged object from all inputs
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

				// Collect input values
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

								// Check if origin is a StructuredBuilder with an extension meta
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
										// ONLY merge if the extension target matches THIS node's category
										if (extensionTarget === meta.category) {
												if (typeof inputValue === "object" && inputValue !== null) {
														extensions.push(inputValue);
												}
										}
								} else {
										// Standard DragosVariable / DragosObject behavior
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

				// 1. Merge standard input values with base data
				let mergedData = deepMergeObjects(baseData, inputValues);

				// 2. Deep merge extensions directly into the root data
				for (const ext of extensions) {
						mergedData = deepMergeObjects(mergedData, ext);
				}

				// Update json_data
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

		// Filter dynamic inputs (input_1, input_2, etc.)
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

		// Add new slot if last is connected
		const last = dynamicInputs[dynamicInputs.length - 1];

		if (last.slot.link != null) {
				node.addInput(
						`input_${last.index + 1}`,
						"PROMPT_VAR"
				);
				changed = true;
		}

		// Remove trailing empty slots
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

		// Update json_data with connected inputs
		updateJsonWithInputs(node, graph);
}

function buildNestedObjectFromWidgets(node)
{
	const result = {};

	for (const w of node.widgets)
	{
		if (!w.dragosPath || w.hidden)
			continue;

		const value =
			w._otherPopupValue !== undefined
				? w._otherPopupValue
				: w.value;

		// SKIP empty values
		if (
			value === "" ||
			value === null ||
			value === undefined
		)
			continue;

		const keys = w.dragosPath.split(".");
		let current = result;

		for (let i = 0; i < keys.length; i++)
		{
			const k = keys[i];

			if (i === keys.length - 1)
			{
				current[k] = value;
			}
			else
			{
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

	// Load schema for selected category
	const schema = await loadSchema(categoryWidget.value);
	if (!schema) return;

	// Parse saved data from previous json_data
	let savedData = {};
	if (node.properties?.json_data) {
		try {
			const parsed = JSON.parse(node.properties.json_data);
			savedData = parsed.data || {};
		} catch {}
	}

	// Clear old dynamic widgets (keep category)
	node.widgets = node.widgets.filter(w => w.name === "category");

	// Rebuild widgets from schema
	buildWidgetsFromSchema(node, schema);

	// Restore values from savedData
	for (const w of node.widgets) {
		if (!w.dragosPath) continue;
		if (w.isStatic) continue;  // Skip static widgets - always use schema value
		
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

	// Evaluate conditional visibility & layout
	evaluateConditions(node);
	applyWidgetVisibility(node);

	// Build final JSON to store in hidden widget & properties
	const data = buildNestedObjectFromWidgets(node);
	const schemaMeta = schema._meta || {};
	const displayName = schemaMeta.display_name || schemaMeta.displayName || categoryWidget.value || "";

	const final = {
		_meta: {
			category: String(displayName).toLowerCase(),
			extension: String(schemaMeta.extension || "").toLowerCase(),
			schema: String(categoryWidget.value || "").toLowerCase()
		},
		data: data
	};

	// Store in hidden json_data widget
	let jsonWidget = node.widgets.find(w => w.name === "json_data");
	if (!jsonWidget) {
		jsonWidget = node.addWidget("text", "json_data", "", () => {});
		jsonWidget.hidden = true;
		jsonWidget.computeSize = () => [0, -8];
		jsonWidget.draw = () => {};
	}
	jsonWidget.value = JSON.stringify(final);

	// Also persist in node properties for graph save/load
	node.properties = node.properties || {};
	node.properties.json_data = jsonWidget.value;

	// Hook dynamic widgets to update json_data on change
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

	// Resize node if needed
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

				// Handle dynamic inputs
				const origConnectionsChange = node.onConnectionsChange;
				node.onConnectionsChange = function() {
						if (origConnectionsChange) origConnectionsChange.apply(this, arguments);
						manageDynamicInputs(node, graph);
				};

				// Periodic update for connected inputs
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