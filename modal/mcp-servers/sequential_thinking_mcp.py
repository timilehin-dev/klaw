"""
Klaw Modal MCP-style HTTP: Sequential Thinking.
Deploy: modal deploy modal/mcp-servers/sequential_thinking_mcp.py
"""
from __future__ import annotations

import json
import modal

app = modal.App("klaw-mcp-sequential-thinking")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]"
)


@app.function(image=image, timeout=30)
@modal.fastapi_endpoint(method="POST")
def call(item: dict) -> dict:
    name = item.get("name") or item.get("tool") or "sequentialthinking"
    args = item.get("arguments") or item
    if name != "sequentialthinking":
        return {
            "isError": True,
            "content": [{"type": "text", "text": f"Unknown tool {name}"}],
        }
    payload = {
        "thoughtNumber": args.get("thoughtNumber", 1),
        "totalThoughts": args.get("totalThoughts", 1),
        "nextThoughtNeeded": bool(args.get("nextThoughtNeeded")),
        "thought": args.get("thought", ""),
        "status": "continue" if args.get("nextThoughtNeeded") else "complete",
    }
    return {
        "isError": False,
        "content": [{"type": "text", "text": json.dumps(payload, indent=2)}],
    }


@app.function(image=image, timeout=10)
@modal.fastapi_endpoint(method="GET")
def tools() -> dict:
    return {
        "tools": [
            {
                "name": "sequentialthinking",
                "description": "Structured multi-step thought recording",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "thought": {"type": "string"},
                        "thoughtNumber": {"type": "number"},
                        "totalThoughts": {"type": "number"},
                        "nextThoughtNeeded": {"type": "boolean"},
                    },
                    "required": [
                        "thought",
                        "thoughtNumber",
                        "totalThoughts",
                        "nextThoughtNeeded",
                    ],
                },
            }
        ]
    }
