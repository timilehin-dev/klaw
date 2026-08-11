# Klaw Browser Automation (Playwright)

Headless Chromium on Modal for agent tool `browser_action`.

## Deploy

```bash
modal deploy modal/sandboxes/browser_automation.py
```

Set in `.env`:

```env
MODAL_BROWSER_URL=https://<workspace>--klaw-browser-browser-action.modal.run
```

## Actions

| action | required fields | purpose |
|--------|-----------------|---------|
| `navigate` / `content` | `url` | Load page, return visible text |
| `click` | `url`, `selector` | Click then return text |
| `type` | `url`, `selector`, `text` | Fill + Enter, return text |
| `screenshot` | `url` | Return base64 PNG |

## Notes

- Content is truncated (~8k chars) to protect model context.
- Prefer `web_search` (Tavily) for simple research; use browser for interactive / JS sites.
