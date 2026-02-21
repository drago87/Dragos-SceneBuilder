import json
import os

PROMPT_VAR_TYPE = "PROMPT_VAR"

SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "web", "schema")


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
            print(f"[unwrap] depth {depth}: tuple -> {v}")
            v = v[0]
            depth += 1
        print(f"[unwrap] final value: {v}")
        return v

    def compile_json(self, **kwargs):
        scene = {}

        print("=== DragosSceneCompiler: compile_json ===")
        for key, v in kwargs.items():
            print(f"Input '{key}' raw value: {v}")
            unwrapped = self._unwrap_prompt_var(v)
            print(f"Input '{key}' unwrapped: {unwrapped}")

            if isinstance(unwrapped, dict) and "name" in unwrapped and "value" in unwrapped:
                scene[unwrapped["name"]] = unwrapped["value"]
                print(f"Added to scene: {unwrapped['name']} -> {unwrapped['value']}")
            else:
                print(f"Skipped input '{key}': not a valid prompt var")

        json_out = json.dumps(scene, indent="\t", ensure_ascii=False)
        print("=== compile_json result ===")
        print(json_out)
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

        return ({
            "name": category,
            "value": parsed
        },)