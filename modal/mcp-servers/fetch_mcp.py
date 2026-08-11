"""
Klaw Modal MCP-style HTTP wrapper: Fetch URL → text/markdown.
Deploy: modal deploy modal/mcp-servers/fetch_mcp.py
Set MCP_FETCH_HTTP_URL to the printed endpoint.
"""
from __future__ import annotations

import re
import modal

app = modal.App("klaw-mcp-fetch")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]", "httpx", "beautifulsoup4", "lxml", "markdownify")
)


@app.function(image=image, timeout=60, memory=1024)
@modal.fastapi_endpoint(method="POST")
def call(item: dict) -> dict:
    import httpx
    from bs4 import BeautifulSoup

    name = item.get("name") or item.get("tool") or "fetch"
    args = item.get("arguments") or item
    if name != "fetch":
        return {"isError": True, "content": [{"type": "text", "text": f"Unknown tool {name}"}]}

    url = args.get("url")
    if not url:
        return {"isError": True, "content": [{"type": "text", "text": "url required"}]}

    max_len = int(args.get("max_length") or 12000)
    try:
        r = httpx.get(
            url,
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Klaw-MCP-Fetch/1.0"},
        )
        r.raise_for_status()
        text = r.text
        if "html" in r.headers.get("content-type", ""):
            soup = BeautifulSoup(text, "lxml")
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            text = soup.get_text("\n")
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if len(text) > max_len:
            text = text[:max_len] + f"\n...[truncated {len(text) - max_len} chars]"
        return {
            "isError": False,
            "content": [{"type": "text", "text": f"# Fetch {url}\n\n{text}"}],
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
                "name": "fetch",
                "description": "Fetch URL content as text for LLM use",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string"},
                        "max_length": {"type": "number"},
                    },
                    "required": ["url"],
                },
            }
        ]
    }
