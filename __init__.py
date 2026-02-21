from .scene_builder import (
    DragosVariableNode,
    DragosObjectNode,
    DragosSceneCompiler,
    DragosStructuredBuilderNode
)

NODE_CLASS_MAPPINGS = {

    "DragosVariable": DragosVariableNode,
    "DragosObject": DragosObjectNode,
    "DragosSceneCompiler": DragosSceneCompiler,
    "DragosStructuredBuilder": DragosStructuredBuilderNode
}

NODE_DISPLAY_NAME_MAPPINGS = {

    "DragosVariable": "Dragos Variable",
    "DragosObject": "Dragos Object",
    "DragosSceneCompiler": "Dragos Scene Compiler",
    "DragosStructuredBuilder": "Dragos Structured Builder"
}

WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY"
]