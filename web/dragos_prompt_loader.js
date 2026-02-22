import { app } from "../../scripts/app.js";

const EXTENSION_NAME = "Dragos-SceneBuilder";

// -----------------------------
// Load prompt file
// -----------------------------
async function loadPromptFile(promptName) {
    if (!promptName) return { info: "", prompt: "" };

    try {
        const filename = promptName + ".txt";
        const response = await fetch(`/extensions/${EXTENSION_NAME}/prompts/${filename}`);
        if (!response.ok) throw new Error("Failed to load prompt file");
        const text = await response.text();
        return parsePrompt(text);
    } catch (err) {
        console.error("Dragos Prompt Loader error:", err);
        return { info: "", prompt: "" };
    }
}

// -----------------------------
// Parse prompt file content
// -----------------------------
function parsePrompt(content) {
    let info = "";
    let prompt = content.trim();

    const infoMatch = content.match(/<info>([\s\S]*?)<\/info>/i);
    if (infoMatch) info = infoMatch[1].trim();

    const promptMatch = content.match(/<prompt>([\s\S]*?)<\/prompt>/i);
    if (promptMatch) prompt = promptMatch[1].trim();
    else if (infoMatch) prompt = content.replace(infoMatch[0], "").trim();

    return { info, prompt };
}

// -----------------------------
// Extension registration
// -----------------------------
app.registerExtension({
    name: "Dragos.PromptLoader",

	nodeCreated(node)
	{
		// Only affect DragosPromptLoaderNode
		if (node.comfyClass !== "DragosPromptLoaderNode")
			return;
	
		setTimeout(async () =>
		{
			const promptDropdown =
				node.widgets?.find(w => w.name === "prompt");
	
			if (!promptDropdown)
				return;
	
			let infoWidget =
				node.widgets.find(w => w.name === "info_text");
	
			if (!infoWidget)
			{
				infoWidget =
					node.addWidget("text", "info_text", "", () => {});
	
				infoWidget.hidden = false;
			}
	
			let promptWidget =
				node.widgets.find(w => w.name === "prompt_text");
	
			if (!promptWidget)
			{
				promptWidget =
					node.addWidget("text", "prompt_text", "", () => {});
	
				promptWidget.hidden = false;
			}
	
			async function updateInputs(promptName)
			{
				if (!promptName) return;
	
				const { info, prompt } =
					await loadPromptFile(promptName);
	
				infoWidget.value = info;
				promptWidget.value = prompt;
	
				const infoInput =
					node.inputs?.find(i => i.name === "info_text");
	
				const promptInput =
					node.inputs?.find(i => i.name === "prompt_text");
	
				if (infoInput) infoInput.value = info;
				if (promptInput) promptInput.value = prompt;
	
				node.graph?.setDirtyCanvas(true, true);
			}
	
			const oldCallback = promptDropdown.callback;
	
			promptDropdown.callback = async function(value)
			{
				if (oldCallback)
					oldCallback.call(this, value);
	
				await updateInputs(value);
			};
	
			if (promptDropdown.value)
				await updateInputs(promptDropdown.value);
	
		}, 10);
	}
});