import json
import os
import re

PROMPT_VAR_TYPE = "PROMPT_VAR"

SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "web", "schema")

PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "web", "prompts")


def load_prompt_files():

    files = []

    for f in os.listdir(PROMPTS_DIR):
        if f.endswith(".txt"):
            files.append(os.path.splitext(f)[0])

    return sorted(files)


def parse_prompt_file(content: str):
    """
    Parses a prompt file and returns (info, prompt)
    
    Supported formats:

    Format1:
        <info>...</info>
        <prompt>...</prompt>

    Format2:
        <info>...</info>
        raw text

    Format3:
        <prompt>...</prompt>

    Format4:
        raw text
    """

    info = ""
    prompt = content.strip()

    # Extract <info> block if present
    info_match = re.search(r"<info>([\s\S]*?)</info>", content, re.IGNORECASE)
    if info_match:
        info = info_match.group(1).strip()

    # Extract <prompt> block if present
    prompt_match = re.search(r"<prompt>([\s\S]*?)</prompt>", content, re.IGNORECASE)
    if prompt_match:
        prompt = prompt_match.group(1).strip()
    elif info_match:
        # remove info block if present
        prompt = content.replace(info_match.group(0), "").strip()
    else:
        # fallback: use entire content
        prompt = content.strip()

    return info, prompt


class DragosPromptLoaderNode:

    CATEGORY = "DragosScene"
    RETURN_TYPES = ("STRING",)
    FUNCTION = "load_prompt"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": (load_prompt_files(),),
            },
            "optional": {
                "info_text": ("STRING", {"multiline": True, "default": ""}),
                "prompt_text": ("STRING", {"multiline": True, "default": ""}),
            }
        }

    def load_prompt(self, prompt, info_text="", prompt_text=""):
        path = os.path.join(PROMPTS_DIR, prompt + ".txt")

        content = ""
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

        info, parsed_prompt = parse_prompt_file(content)

        # prioritize edited textbox
        final_prompt = prompt_text.strip() if prompt_text.strip() else parsed_prompt

        return (final_prompt,)


def load_schema_categories():

    if not os.path.exists(SCHEMA_DIR):
        return ["character"]

    return [
        f.replace(".json", "")
        for f in os.listdir(SCHEMA_DIR)
        if f.endswith(".json")
    ]


def is_valid_prompt_var(v):

    if not isinstance(v, dict):
        return False

    if "name" not in v or "value" not in v:
        return False

    if v["value"] is None:
        return False

    return True


class DragosVariableNode:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "var_name": ("STRING", {"default": "subject"}),
                "text": ("STRING", {"multiline": True, "default": ""}),
            }
        }

    RETURN_TYPES = (PROMPT_VAR_TYPE,)
    FUNCTION = "get_text"
    CATEGORY = "DragosScene"

    def get_text(self, var_name, text):

        if var_name is None or var_name == "":
            return (None,)

        return ({
            "name": var_name,
            "value": text
        },)


class DragosObjectNode:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "obj_name": ("STRING", {"default": "object"}),
            },
            "optional": {
                "input_1": (PROMPT_VAR_TYPE, {"forceInput": True}),
            }
        }

    RETURN_TYPES = (PROMPT_VAR_TYPE,)
    FUNCTION = "build_object"
    CATEGORY = "DragosScene"

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def build_object(self, obj_name, **kwargs):

        if obj_name is None or obj_name == "":
            return (None,)

        combined = {}

        for v in kwargs.values():

            if not is_valid_prompt_var(v):
                continue

            combined[v["name"]] = v["value"]

        if not combined:
            return (None,)

        return ({
            "name": obj_name,
            "value": combined
        },)


class DragosSceneCompiler:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "input_1": (PROMPT_VAR_TYPE, {"forceInput": True}),
            },
            "hidden": {
                "output_json_string": ("STRING", {"multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    OUTPUT_NODE = True
    FUNCTION = "compile_json"
    CATEGORY = "DragosScene"

    @staticmethod
    def _unwrap_prompt_var(v):
        """Recursively unwrap tuples from ComfyUI PROMPT_VAR_TYPE nodes."""
        depth = 0
        while isinstance(v, tuple) and len(v) == 1:
            v = v[0]
            depth += 1
        return v

    def compile_json(self, **kwargs):
        # If hidden output exists, use it directly
        hidden_json = kwargs.get("output_json_string")
        if hidden_json:
            return (hidden_json,)

        # Otherwise, build from inputs as before
        scene = {}
        for key, v in kwargs.items():
            unwrapped = self._unwrap_prompt_var(v)
            if isinstance(unwrapped, dict) and "name" in unwrapped and "value" in unwrapped:
                scene[unwrapped["name"]] = unwrapped["value"]

        json_out = json.dumps(scene, indent="\t", ensure_ascii=False)
        return (json_out,)

class DragosStructuredBuilderNode:

    CATEGORY = "DragosScene"
    RETURN_TYPES = (PROMPT_VAR_TYPE,)
    FUNCTION = "build"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "category": (load_schema_categories(),),
            },
            "hidden": {
                "json_data": ("STRING",),
            }
        }

    def build(self, category, json_data):
    
        try:
            parsed = json.loads(json_data) if json_data else {}
        except Exception:
            parsed = {}
    
        meta = parsed.get("_meta", {})
        data = parsed.get("data", {})
    
        return ({
            "name": meta.get("category", category),
            "value": data,
            "_meta": meta
        },)