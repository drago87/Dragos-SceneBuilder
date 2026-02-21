import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";


function isNodeActive(node)
{
	if (!node) return false;

	if (node.mode === 2) return false;
	if (node.mode === 4) return false;

	return true;
}

function getWidgetValue(node, names)
{
	if (!node.widgets) return null;

	for (const name of names)
	{
		const w = node.widgets.find(w => w.name === name);
		if (w) return w.value;
	}

	return null;
}

function getValueRecursive(node, graph)
{
	if (!node) return undefined;
	if (!isNodeActive(node)) return undefined;

	// DragosVariable
	if (node.comfyClass === "DragosVariable")
	{
		return getWidgetValue(node, ["text"]) ?? "";
	}

	// DragosStructuredBuilder
	if (node.comfyClass === "DragosStructuredBuilder")
	{
		const result = {};

		for (const widget of node.widgets || [])
		{
			if (!widget.dragosPath) continue;
			if (widget.hidden) continue;
			if (widget.value === "" || widget.value == null) continue;

			const parts = widget.dragosPath.split(".");
			let current = result;

			for (let i = 0; i < parts.length - 1; i++)
			{
				const part = parts[i];

				if (!(part in current))
					current[part] = {};

				current = current[part];
			}

			current[parts[parts.length - 1]] = widget.value;
		}

		return result;
	}

	// DragosObject
	if (node.comfyClass === "DragosObject")
	{
		const result = {};

		for (const input of node.inputs || [])
		{
			if (input.link == null) continue;

			const link = graph.links[input.link];
			if (!link) continue;

			const origin = graph.getNodeById(link.origin_id);
			if (!isNodeActive(origin)) continue;

			const key =
				getWidgetValue(origin, ["var_name", "obj_name"])
				?? input.name;

			const value = getValueRecursive(origin, graph);

			if (value !== undefined)
				result[key] = value;
		}

		return result;
	}

	return undefined;
}

function refreshNode(node, graph, previewWidget)
{
	if (!node.inputs) return;

	if (previewWidget)
	{
		const scene = {};
		let characterCount = 1;

		for (const input of node.inputs)
		{
			if (input.link == null) continue;

			const link = graph.links[input.link];
			if (!link) continue;

			const origin = graph.getNodeById(link.origin_id);
			if (!origin) continue;
			if (!isNodeActive(origin)) continue;

			let key = null;

			// StructuredBuilder handling
			if (origin.comfyClass === "DragosStructuredBuilder")
			{
				const categoryWidget =
					origin.widgets?.find(w => w.name === "category");

				const category = categoryWidget?.value;

				if (category === "camera")
				{
					key = "camera";
				}
				else if (category && category.startsWith("character"))
				{
					key = `character_${characterCount++}`;
				}
				else
				{
					key = category ?? input.name;
				}
			}
			else
			{
				key =
					getWidgetValue(origin, ["var_name", "obj_name"])
					?? input.name;
			}

			const value = getValueRecursive(origin, graph);

			if (value !== undefined)
				scene[key] = value;
		}

		const json = JSON.stringify(scene, null, "\t");

		if (previewWidget.value !== json)
			previewWidget.value = json;
	}

	// dynamic input slots

	const inputs = node.inputs;
	if (!inputs.length) return;

	const last = inputs[inputs.length - 1];

	if (last.link != null)
	{
		node.addInput(`input_${inputs.length + 1}`, "PROMPT_VAR");
		node.setDirtyCanvas(true, true);
	}

	if (inputs.length > 1)
	{
		const last = inputs[inputs.length - 1];
		const prev = inputs[inputs.length - 2];

		if (last.link == null && prev.link == null)
		{
			node.removeInput(inputs.length - 1);
			node.setDirtyCanvas(true, true);
		}
	}
}

app.registerExtension({

	name: "Dragos.SceneBuilder.Dynamic",

	async nodeCreated(node)
	{
		if (
			node.comfyClass !== "DragosObject"
			&&
			node.comfyClass !== "DragosSceneCompiler"
		) return;

		let previewWidget = null;

		if (node.comfyClass === "DragosSceneCompiler")
		{
			previewWidget =
				ComfyWidgets.STRING(
					node,
					"preview",
					["STRING", { multiline: true }],
					app
				).widget;

			previewWidget.inputEl.readOnly = true;
			previewWidget.inputEl.style.fontSize = "11px";
			previewWidget.inputEl.style.height = "180px";
		}

		const graph = app.graph;

		const update = () =>
			refreshNode(node, graph, previewWidget);

		const origConnectionsChange = node.onConnectionsChange;
		node.onConnectionsChange = function ()
		{
			if (origConnectionsChange)
				origConnectionsChange.apply(this, arguments);

			update();
		};

		const origWidgetChanged = node.onWidgetChanged;
		node.onWidgetChanged = function ()
		{
			if (origWidgetChanged)
				origWidgetChanged.apply(this, arguments);

			update();
		};

		const timer = setInterval(() =>
		{
			if (!graph._nodes.includes(node))
			{
				clearInterval(timer);
				return;
			}

			update();

		}, 500);

		update();
	}

});