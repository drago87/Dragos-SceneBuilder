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

    nodeCreated(node) {
        // Strict check: Only run for DragosPromptLoader
        if (node.comfyClass !== "DragosPromptLoader") return;

        // Increased timeout to 50ms to ensure Python widgets are instantiated
        setTimeout(async () => {
            // 1. Find the dropdown created by Python
            const promptDropdown = node.widgets?.find(w => w.name === "prompt");
            if (!promptDropdown) {
                console.warn("DragosPromptLoader: Prompt dropdown missing on init.");
                return;
            }

            // 2. Find the text widgets created by Python
            // We DO NOT use addWidget here. We assume Python created them.
            let infoWidget = node.widgets.find(w => w.name === "info_text");
            let promptWidget = node.widgets.find(w => w.name === "prompt_text");

            if (!infoWidget || !promptWidget) {
                console.warn("DragosPromptLoader: info_text or prompt_text widgets missing. Check Python definition.");
                return;
            }

            // Helper to handle visibility of info_widget
            const updateVisibility = () => {
                const hasInfo = infoWidget.value && infoWidget.value.trim().length > 0;

                if (hasInfo) {
                    // Show widget
                    infoWidget.hidden = false;
                    if (infoWidget._originalComputeSize) {
                        infoWidget.computeSize = infoWidget._originalComputeSize;
                    }
                } else {
                    // Hide widget
                    infoWidget.hidden = true;
                    if (!infoWidget._originalComputeSize) {
                        infoWidget._originalComputeSize = infoWidget.computeSize;
                    }
                    infoWidget.computeSize = () => [0, -4];
                }
            };

            async function updateInputs(promptName) {
                if (!promptName) return;

                const { info, prompt } = await loadPromptFile(promptName);

                infoWidget.value = info;
                promptWidget.value = prompt;

                updateVisibility();

                // Sync inputs
                const infoInput = node.inputs?.find(i => i.name === "info_text");
                const promptInput = node.inputs?.find(i => i.name === "prompt_text");
                if (infoInput) infoInput.value = info;
                if (promptInput) promptInput.value = prompt;

                node.setSize(node.computeSize());
                node.graph?.setDirtyCanvas(true, true);
            }

            // Hook the dropdown callback
            const oldCallback = promptDropdown.callback;
            promptDropdown.callback = async function(value) {
                if (oldCallback) oldCallback.call(this, value);
                await updateInputs(value);
            };

            // Initial load
            if (promptDropdown.value) {
                await updateInputs(promptDropdown.value);
            } else {
                updateVisibility();
                node.setSize(node.computeSize());
            }

        }, 50); // Increased timeout
    }
});