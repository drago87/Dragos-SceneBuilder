from .nodes import (
    DragosVariableNode,
    DragosObjectNode,
    DragosSceneCompiler,
    DragosStructuredBuilderNode,
    DragosPromptLoaderNode
)

NODE_CLASS_MAPPINGS = {

    "DragosVariable": DragosVariableNode,
    "DragosObject": DragosObjectNode,
    "DragosSceneCompiler": DragosSceneCompiler,
    "DragosStructuredBuilder": DragosStructuredBuilderNode,
    "DragosPromptLoader": DragosPromptLoaderNode
}

NODE_DISPLAY_NAME_MAPPINGS = {

    "DragosVariable": "Dragos Variable",
    "DragosObject": "Dragos Object",
    "DragosSceneCompiler": "Dragos Scene Compiler",
    "DragosStructuredBuilder": "Dragos Structured Builder",
    "DragosPromptLoader": "Dragos Prompt Loader"
}

WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY"
]