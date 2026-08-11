"""
Klaw Modal Sandbox — headless browser automation (Playwright + Chromium).

Deploy (manual):
    modal deploy modal/sandboxes/browser_automation.py

Set MODAL_BROWSER_URL to the printed `browser_action` endpoint.
"""

from __future__ import annotations

import modal

APP_NAME = "klaw-browser"
PYTHON_VERSION = "3.11"
MEMORY_MIB = 4 * 1024  # 4 GiB — Chromium is heavy
CPU_CORES = 2.0
TIMEOUT_SEC = 300
MAX_CONTENT_CHARS = 8000

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version=PYTHON_VERSION)
    .pip_install("playwright", "fastapi[standard]")
    .run_commands("playwright install --with-deps chromium")
    .env({"PYTHONUNBUFFERED": "1"})
)


@app.function(
    image=image,
    cpu=CPU_CORES,
    memory=MEMORY_MIB,
    timeout=TIMEOUT_SEC,
)
@modal.fastapi_endpoint(method="POST")
async def browser_action(item: dict) -> dict:
    """
    Request JSON:
      {
        "action": "navigate" | "click" | "type" | "screenshot",
        "url": "https://...",
        "selector": "css selector",   # click/type
        "text": "value",              # type
        "wait_ms": 1000               # optional settle delay
      }
    """
    from playwright.async_api import async_playwright

    if not isinstance(item, dict):
        return {"success": False, "error": "Body must be a JSON object", "content": ""}

    action = (item.get("action") or "").strip().lower()
    url = item.get("url")
    selector = item.get("selector")
    text = item.get("text")
    wait_ms = int(item.get("wait_ms") or 500)

    if action not in {"navigate", "click", "type", "screenshot", "content"}:
        return {
            "success": False,
            "error": f"Unknown action: {action}",
            "content": "",
        }

    if action in {"navigate", "click", "type", "screenshot", "content"} and not url:
        return {"success": False, "error": "url is required", "content": ""}

    if action in {"click", "type"} and not selector:
        return {
            "success": False,
            "error": f"selector is required for action={action}",
            "content": "",
        }

    if action == "type" and text is None:
        return {"success": False, "error": "text is required for type", "content": ""}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": 1280, "height": 720},
            user_agent=(
                "Mozilla/5.0 (compatible; KlawBot/1.0; +https://github.com/timilehin-dev/klaw)"
            ),
        )
        try:
            await page.goto(str(url), wait_until="domcontentloaded", timeout=60000)

            if action == "click":
                await page.click(str(selector), timeout=15000)
                await page.wait_for_timeout(wait_ms)
            elif action == "type":
                await page.fill(str(selector), str(text), timeout=15000)
                await page.keyboard.press("Enter")
                await page.wait_for_timeout(wait_ms)
            elif action == "screenshot":
                import base64

                png = await page.screenshot(full_page=False)
                b64 = base64.b64encode(png).decode("ascii")
                title = await page.title()
                return {
                    "success": True,
                    "content": f"Screenshot captured for: {title}",
                    "screenshot_base64": b64,
                    "url": page.url,
                    "title": title,
                }
            else:
                # navigate / content — just load and extract
                await page.wait_for_timeout(min(wait_ms, 2000))

            text_content = await page.evaluate("() => document.body ? document.body.innerText : ''")
            title = await page.title()
            final_url = page.url
            if not isinstance(text_content, str):
                text_content = str(text_content)

            if len(text_content) > MAX_CONTENT_CHARS:
                text_content = (
                    text_content[:MAX_CONTENT_CHARS]
                    + f"\n...[truncated {len(text_content) - MAX_CONTENT_CHARS} chars]"
                )

            return {
                "success": True,
                "content": text_content,
                "url": final_url,
                "title": title,
                "action": action,
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"{type(e).__name__}: {e}",
                "content": "",
            }
        finally:
            await browser.close()


@app.function(image=image, cpu=0.25, memory=512, timeout=30)
@modal.fastapi_endpoint(method="GET")
def health() -> dict:
    return {
        "status": "ok",
        "app": APP_NAME,
        "actions": ["navigate", "click", "type", "screenshot", "content"],
        "memory_mib": MEMORY_MIB,
    }


@app.local_entrypoint()
def main():
    """modal run modal/sandboxes/browser_automation.py"""
    result = browser_action.remote(
        {"action": "navigate", "url": "https://example.com"}
    )
    print(result)
