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
	widget.callback = () => {
		if (widget.value === "other") {
			const userInput = prompt(`Enter custom value for ${widget.name}:`, "");
			if (userInput !== null && userInput !== "") {
				widget.value = userInput;
			} else {
				widget.value = widget.options.values[0] || "";
			}
			evaluateConditions(widget.node);
			applyWidgetVisibility(widget.node);
			app.graph.setDirtyCanvas(true, true);
		} else {
			evaluateConditions(widget.node);
			applyWidgetVisibility(widget.node);
			app.graph.setDirtyCanvas(true, true);
		}
	};
}

//
// Build widgets recursively
//
function buildWidgetsFromSchema(node, schema, path = "", inheritedConditions = {}) {
	const mergedConditions = { ...inheritedConditions, ...(schema._conditions || {}) };

	// Capture gender from _meta
	if (schema._meta?.gender) {
		// create a pseudo-widget to hold gender for dragos_dynamic.js
		const genderWidget = {
			name: "Gender",
			value: schema._meta.gender,
			dragosPath: "Gender",
			hidden: false,
		};
		node.widgets.push(genderWidget);
	}

	for (const key in schema) {
		if (key.startsWith("_")) continue;

		const value = schema[key];
		const fullPath = path ? `${path}.${key}` : key;
		const meta = value?._meta || {};
		const label = meta.display_name || prettifyLabel(key);
		const depth = path ? path.split(".").length : 0;

		// Dropdown
		if (Array.isArray(value)) {
			const widget = node.addWidget(
				"combo",
				label,
				value[0],
				() => attachOtherHandler(widget),
				{ values: value }
			);
			widget.dragosPath = fullPath;
			widget.dragosConditions = { ...mergedConditions };
			continue;
		}

		// Nested object → Header
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

		// Text field
		if (value === "" || value === "string") {
			const widget = node.addWidget("text", label, "", () => {
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
// Rebuild UI safely
//
async function rebuild(node) {
    const categoryWidget = node.widgets.find(w => w.name === "category");
    if (!categoryWidget) return;

    const schema = await loadSchema(categoryWidget.value);
    if (!schema) return;

    const savedValues = {};
    for (const w of node.widgets)
        if (w.dragosPath)
            savedValues[w.dragosPath] = w.value;

    clearGeneratedWidgets(node);
    buildWidgetsFromSchema(node, schema);

    for (const w of node.widgets) {
        if (!w.dragosPath) continue;

        if (w.name === "Gender" && schema._meta?.gender) {
            w.value = schema._meta.gender;
            continue;
        }

        if (savedValues[w.dragosPath] !== undefined)
            w.value = savedValues[w.dragosPath];
    }

    evaluateConditions(node);
    applyWidgetVisibility(node);

    //
    // ADD THIS BLOCK
    //
    let jsonWidget = node.widgets.find(w => w.name === "json_data");

    if (!jsonWidget)
    {
        jsonWidget = node.addWidget(
            "text",
            "json_data",
            "",
            () => {},
            { multiline: true }
        );

        jsonWidget.hidden = true;
    }

    const data = buildNestedObjectFromWidgets(node);
    jsonWidget.value = JSON.stringify(data);
    //
    // END BLOCK
    //

    if (node.computeSize)
        node.setSize(node.computeSize());

    app.graph.setDirtyCanvas(true, true);
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
// Extension registration
//
app.registerExtension({
	name: "Dragos.StructuredBuilder",
	nodeCreated(node) {
		if (node.comfyClass !== "DragosStructuredBuilder") return;

		const categoryWidget = node.widgets.find(w => w.name === "category");
		if (!categoryWidget) return;

		const originalCallback = categoryWidget.callback;
		categoryWidget.callback = async function(value) {
			if (originalCallback) originalCallback.call(this, value);
			await rebuild(node);
		};

		setTimeout(() => rebuild(node), 10);
	}
});