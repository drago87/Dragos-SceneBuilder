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

	if (node.comfyClass === "DragosVariable")
		return getWidgetValue(node, ["text"]) ?? "";

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


function refreshNode(node, graph, previewWidget, syncPreviewHeight)
{
    if (!node || !graph || !node.inputs)
        return;


    ////////////////////////////////////////////////////////////
    // STEP 1 — Collect ordered origin nodes (stable order)
    ////////////////////////////////////////////////////////////

    const orderedOrigins = [];

    for (let i = 0; i < node.inputs.length; i++)
    {
        const input = node.inputs[i];

        if (!input || input.link == null)
            continue;

        const link = graph.links[input.link];
        if (!link)
            continue;

        const origin = graph.getNodeById(link.origin_id);

        if (!origin)
            continue;

        if (!isNodeActive(origin))
            continue;

        orderedOrigins.push(origin);
    }



    ////////////////////////////////////////////////////////////
    // STEP 2 — Build intermediate structure
    ////////////////////////////////////////////////////////////

    const built = [];

    for (let i = 0; i < orderedOrigins.length; i++)
    {
        const origin = orderedOrigins[i];

        const value =
            getValueRecursive(origin, graph);

        if (
            value == null ||
            (typeof value === "object" &&
             Object.keys(value).length === 0)
        )
            continue;


        let category = "";
        let extension = "";


        // Read _meta from json_data widget ONCE
        const jsonWidget =
            origin.widgets?.find(
                w => w.name === "json_data"
            );

        if (jsonWidget?.value)
        {
            try
            {
                const parsed =
                    JSON.parse(jsonWidget.value);

                const meta = parsed?._meta;

                if (meta)
                {
                    category =
                        String(
                            meta.display_name ??
                            meta.displayName ??
                            meta.category ??
                            ""
                        ).toLowerCase();

                    extension =
                        String(
                            meta.extension ?? ""
                        ).toLowerCase();
                }
            }
            catch {}
        }


        // Fallback category detection
        if (!category)
        {
            category =
                String(
                    getWidgetValue(
                        origin,
                        ["category", "obj_name", "var_name"]
                    ) || ""
                ).toLowerCase();
        }


        built.push({
            category,
            extension,
            value,
            sceneKey: null
        });
    }



    ////////////////////////////////////////////////////////////
    // STEP 3 — Merge into final scene
    ////////////////////////////////////////////////////////////

    const scene = {};

    let characterCount = 0;


    for (let i = 0; i < built.length; i++)
    {
        const entry = built[i];

        ////////////////////////////////////////////////////////
        // TOP-LEVEL
        ////////////////////////////////////////////////////////

        if (!entry.extension)
        {
            if (entry.category === "character")
            {
                characterCount++;

                const key =
                    `character_${characterCount}`;

                scene[key] = entry.value;

                entry.sceneKey = key;
            }
            else if (entry.category)
            {
                const key = entry.category;

                scene[key] = entry.value;

                entry.sceneKey = key;
            }

            continue;
        }


        ////////////////////////////////////////////////////////
        // EXTENSION MERGE
        ////////////////////////////////////////////////////////

        const targetCategory =
            entry.extension;

        for (let j = i - 1; j >= 0; j--)
        {
            const candidate = built[j];

            if (
                candidate.category !== targetCategory
            )
                continue;

            const targetKey =
                candidate.sceneKey;

            if (!targetKey)
                break;

            if (!scene[targetKey])
                scene[targetKey] = {};

            Object.assign(
                scene[targetKey],
                entry.value
            );

            break;
        }
    }



    ////////////////////////////////////////////////////////////
    // STEP 4 — Remove empty objects (deep clean)
    ////////////////////////////////////////////////////////////

    function removeEmpty(obj)
    {
        if (!obj || typeof obj !== "object")
            return obj;

        for (const key in obj)
        {
            const val =
                removeEmpty(obj[key]);

            if (
                val == null ||
                (typeof val === "object" &&
                 Object.keys(val).length === 0)
            )
            {
                delete obj[key];
            }
        }

        return obj;
    }

    removeEmpty(scene);



    ////////////////////////////////////////////////////////////
    // STEP 5 — Convert to JSON
    ////////////////////////////////////////////////////////////

    const json =
        JSON.stringify(scene, null, "\t");



    ////////////////////////////////////////////////////////////
    // STEP 6 — Update preview widget (only if changed)
    ////////////////////////////////////////////////////////////

    if (
        previewWidget &&
        previewWidget.value !== json
    )
    {
        previewWidget.value = json;

        if (syncPreviewHeight)
            syncPreviewHeight();
    }



    ////////////////////////////////////////////////////////////
    // STEP 7 — Hidden output widget
    ////////////////////////////////////////////////////////////

    let hiddenOutput =
        node.widgets.find(
            w => w.name === "output_json_string"
        );

    if (!hiddenOutput)
    {
        hiddenOutput =
            node.addWidget(
                "text",
                "output_json_string",
                "",
                () => {}
            );

        hiddenOutput.hidden = true;
        hiddenOutput.computeSize =
            () => [0, -8];
        hiddenOutput.draw =
            () => {};
    }

    hiddenOutput.value = json;



	////////////////////////////////////////////////////////////
	// STEP 8 — Dynamic inputs (CORRECT INDEX-SAFE VERSION)
	////////////////////////////////////////////////////////////
	
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
	
	
	if (dynamicInputs.length === 0)
		return;
	
	
	let changed = false;
	
	
	////////////////////////////////////////////////////////////
	// Add new slot if last is connected
	////////////////////////////////////////////////////////////
	
	const last = dynamicInputs[dynamicInputs.length - 1];
	
	if (last.slot.link != null)
	{
		node.addInput(
			`input_${last.index + 1}`,
			"PROMPT_VAR"
		);
	
		changed = true;
	}
	
	
	////////////////////////////////////////////////////////////
	// Remove trailing empty slots SAFELY using REAL INDEX
	////////////////////////////////////////////////////////////
	
	while (dynamicInputs.length > 1)
	{
		const lastEntry =
			dynamicInputs[dynamicInputs.length - 1];
	
		const prevEntry =
			dynamicInputs[dynamicInputs.length - 2];
	
		if (
			lastEntry.slot.link == null &&
			prevEntry.slot.link == null
		)
		{
			// find CURRENT real index (important)
			const currentRealIndex =
				node.inputs.findIndex(
					s => s === lastEntry.slot
				);
	
			if (currentRealIndex !== -1)
			{
				node.removeInput(currentRealIndex);
	
				dynamicInputs.pop();
	
				changed = true;
	
				continue;
			}
		}
	
		break;
	}
	
	
	if (changed)
	{
		node.setDirtyCanvas(true, true);
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
		let syncPreviewHeight = null;

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
			previewWidget.inputEl.style.resize = "none";


			syncPreviewHeight = function()
			{
				if (!previewWidget?.inputEl) return;
				if (!node.size) return;

				const HEADER = LiteGraph.NODE_TITLE_HEIGHT || 30;
				const SLOT = LiteGraph.NODE_SLOT_HEIGHT || 20;
				const PADDING = 10;

				let widgetY = HEADER;

				for (const w of node.widgets)
				{
					if (w === previewWidget) break;

					const size = w.computeSize?.(node.size[0]);
					widgetY += (size?.[1] || SLOT) + 4;
				}

				const inputsHeight =
					(node.inputs?.length || 0) * SLOT;

				const available =
					node.size[1]
					- widgetY
					- inputsHeight
					- PADDING;

				previewWidget.inputEl.style.height =
					Math.max(available, 50) + "px";
			};


			const origOnResize = node.onResize;

			node.onResize = function()
			{
				if (origOnResize)
					origOnResize.apply(this, arguments);

				syncPreviewHeight();
			};


						// force correct node size first
			requestAnimationFrame(() =>
			{
				if (node.computeSize)
				{
					const newSize = node.computeSize();
					node.setSize(newSize);
				}
			
				syncPreviewHeight();
			
				node.setDirtyCanvas(true, true);
			});
			
			setTimeout(() =>
			{
				if (node.computeSize)
				{
					const newSize = node.computeSize();
					node.setSize(newSize);
				}
			
				syncPreviewHeight();
			
				node.setDirtyCanvas(true, true);
			
			}, 100);
		}


		const graph = app.graph;

		const update = () =>
			refreshNode(
				node,
				graph,
				previewWidget,
				syncPreviewHeight
			);


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