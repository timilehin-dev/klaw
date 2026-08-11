"""
Klaw Modal MCP-style HTTP wrapper: Time tools.
Deploy: modal deploy modal/mcp-servers/time_mcp.py
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import modal

app = modal.App("klaw-mcp-time")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]"
)


@app.function(image=image, timeout=30)
@modal.fastapi_endpoint(method="POST")
def call(item: dict) -> dict:
    name = item.get("name") or item.get("tool") or "get_current_time"
    args = item.get("arguments") or item
    try:
        if name == "get_current_time":
            tz_name = args.get("timezone") or "UTC"
            tz = ZoneInfo(tz_name)
            now = datetime.now(tz)
            text = (
                f'{{"timezone":"{tz_name}","datetime":"{now.isoformat()}",'
                f'"formatted":"{now.strftime("%Y-%m-%d %H:%M:%S %Z")}"}}'
            )
            return {"isError": False, "content": [{"type": "text", "text": text}]}
        if name == "convert_time":
            # Accept ISO time; convert display to target tz
            to_tz = ZoneInfo(args.get("to_timezone") or "UTC")
            raw = args.get("time") or datetime.now(timezone.utc).isoformat()
            try:
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except Exception:
                dt = datetime.now(timezone.utc)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            converted = dt.astimezone(to_tz)
            text = (
                f'{{"source":"{raw}","converted":"{converted.isoformat()}",'
                f'"to_timezone":"{args.get("to_timezone") or "UTC"}"}}'
            )
            return {"isError": False, "content": [{"type": "text", "text": text}]}
        return {
            "isError": True,
            "content": [{"type": "text", "text": f"Unknown tool {name}"}],
        }
    except Exception as e:
        return {
            "isError": True,
            "content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}],
        }


@app.function(image=image, timeout=10)
@modal.fastapi_endpoint(method="GET")
def tools() -> dict:
    return {
        "tools": [
            {
                "name": "get_current_time",
                "description": "Current time in a timezone",
                "inputSchema": {
                    "type": "object",
                    "properties": {"timezone": {"type": "string"}},
                },
            },
            {
                "name": "convert_time",
                "description": "Convert time between zones",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "time": {"type": "string"},
                        "from_timezone": {"type": "string"},
                        "to_timezone": {"type": "string"},
                    },
                    "required": ["time", "from_timezone", "to_timezone"],
                },
            },
        ]
    }
