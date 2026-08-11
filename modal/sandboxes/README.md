# Klaw Modal Sandbox

High-memory, pre-provisioned Python environment used by the `execute_code` agent tool.

## Specs

| Resource | Value |
|----------|--------|
| App name | `klaw-sandbox` |
| Python | 3.11 |
| Memory | **32 GiB** |
| CPU | 8 cores |
| Timeout | 10 minutes |
| Scratch disk | 100 GiB ephemeral |
| Plot backend | `Agg` (headless) |

All dependencies are **baked into the image** at build time. Agent code should `import` packages — never `pip install` at runtime.

## What’s preinstalled

**Data:** numpy, pandas, polars, pyarrow, duckdb, scipy, scikit-learn, statsmodels  

**Docs:** python-docx, python-pptx, openpyxl, reportlab, fpdf2, PyMuPDF, pdfplumber, pypdf, pdf2image, pytesseract  

**Viz / images:** matplotlib, seaborn, plotly, Pillow, opencv-python-headless  

**Web:** requests, httpx, aiohttp, beautifulsoup4, lxml  

**System:** tesseract-ocr, poppler-utils, fonts, build tools  

Full list: `requirements.txt` (must stay in sync with `execute_code.py`).

## Deploy (manual — when you’re ready)

```bash
# from repo root, with Modal CLI authenticated
modal deploy modal/sandboxes/execute_code.py
```

Copy the **`execute_code`** endpoint URL into `.env`:

```env
MODAL_EXECUTE_URL=https://<workspace>--klaw-sandbox-execute-code.modal.run
```

Optional health check (separate URL printed for `health`):

```bash
curl "$HEALTH_URL"
```

## Local smoke test

```bash
modal run modal/sandboxes/execute_code.py
```

## HTTP API

`POST MODAL_EXECUTE_URL`

```json
{
  "code": "import pandas as pd\npd.DataFrame({'a':[1]}).to_csv('out.csv')\nprint('ok')",
  "files": {
    "input.csv": "<optional base64>"
  },
  "timeout_seconds": 120
}
```

Response includes `stdout`, `stderr`, generated `files[]` (base64), and `meta`.

### Agent conventions

1. Write outputs under the **current working directory** (workspace root).
2. `print(...)` results you want the model to see.
3. Prefer preinstalled libraries listed above.
4. Do not call `pip install` or mutate system packages.
