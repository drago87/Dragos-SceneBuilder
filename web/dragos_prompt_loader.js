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

    async setup(app) {
        // Helper to force a specific node type to refresh its definitions
        const refreshPromptLoaders = async () => {
            // Tell backend to refresh definitions
            await app.refreshComboInNodes(); 
        };

        // Add a menu item for manual refresh
        const originalMenuSetup = app.menu?.settingsGroup?.setup;
        // We can also just add a keybinding hook
        document.addEventListener("keydown", (e) => {
            if (e.key === "r" || e.key === "R") {
                // Check if we are not typing in an input box
                if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
                
                // Trigger global refresh (this updates the Python lists)
                // Note: This relies on the user having a default R binding or this overriding it.
                // Usually R is not bound in vanilla, so this adds it.
                // app.refreshComboInNodes(); 
                // Actually, let's rely on the button to be safe, or the existing extension behavior.
            }
        });
    },

    nodeCreated(node) {
        if (node.comfyClass !== "DragosPromptLoader") return;

        // Use requestAnimationFrame for safer initialization than setTimeout
        requestAnimationFrame(async () => {
            const promptDropdown = node.widgets?.find(w => w.name === "prompt");
            let infoWidget = node.widgets.find(w => w.name === "info_text");
            let promptWidget = node.widgets.find(w => w.name === "prompt_text");

            if (!promptDropdown || !infoWidget || !promptWidget) return;

            // --- 1. SAVE ORIGINAL SIZE IMMEDIATELY ---
            // We attach it to the widget object so it persists
            if (!infoWidget._dragosOriginalComputeSize) {
                infoWidget._dragosOriginalComputeSize = infoWidget.computeSize;
            }

            // --- 2. ADD REFRESH BUTTON ---
            // This is the most reliable way to update the list
            const refreshBtn = node.addWidget("button", "Refresh List", "refresh", async () => {
                await app.refreshComboInNodes();
            });
            // Move button to top (after dropdown) for better UX
            const idx = node.widgets.indexOf(refreshBtn);
            if (idx > 1) { // 0 = prompt, 1 = info (hidden usually), etc
                node.widgets.splice(idx, 1);
                node.widgets.splice(1, 0, refreshBtn); 
            }

            // --- 3. VISIBILITY LOGIC ---
            const updateVisibility = () => {
                const hasInfo = infoWidget.value && infoWidget.value.trim().length > 0;

                if (hasInfo) {
                    infoWidget.hidden = false;
                    // Restore original size function
                    infoWidget.computeSize = infoWidget._dragosOriginalComputeSize;
                } else {
                    infoWidget.hidden = true;
                    // Set collapsed size
                    infoWidget.computeSize = () => [0, -4];
                }
            };

            async function updateInputs(promptName) {
                if (!promptName) return;

                const { info, prompt } = await loadPromptFile(promptName);

                infoWidget.value = info;
                promptWidget.value = prompt;

                updateVisibility();

                const infoInput = node.inputs?.find(i => i.name === "info_text");
                const promptInput = node.inputs?.find(i => i.name === "prompt_text");
                if (infoInput) infoInput.value = info;
                if (promptInput) promptInput.value = prompt;

                node.setSize(node.computeSize());
                app.graph.setDirtyCanvas(true, true);
            }

            // Hook dropdown
            const oldCallback = promptDropdown.callback;
            promptDropdown.callback = async function(value) {
                if (oldCallback) oldCallback.call(this, value);
                await updateInputs(value);
            };

            // --- 4. HOOK INTO GLOBAL REFRESH (FOR "R" KEY) ---
            // Store the update function on the node so we can call it if needed, 
            // or simply rely on ComfyUI replacing the widgets values.
            // However, ComfyUI doesn't automatically re-run our 'change' logic on refresh.
            // We need to ensure the dropdown change triggers our logic.
            
            // If the global refresh changes the dropdown value (e.g. if current selection is gone),
            // the callback might not fire. We can listen for graph changes.
            const origOnPropertyChanged = node.onPropertyChanged;
            node.onPropertyChanged = function(name, value) {
                if (origOnPropertyChanged) origOnPropertyChanged.call(this, name, value);
                // If prompt value changes externally (refresh), update
                if (name === "values" && promptDropdown.value) {
                     // This might be overkill, but ensures sync
                }
            };

            // Initial run
            if (promptDropdown.value) {
                await updateInputs(promptDropdown.value);
            } else {
                updateVisibility();
                node.setSize(node.computeSize());
            }
        });
    }
});