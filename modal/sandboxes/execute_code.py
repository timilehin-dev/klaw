"""
Klaw Modal Sandbox — secure, high-memory code execution for agent tool calling.

Design goals
------------
1. **Fat image**: every common library the agent might need is preinstalled.
   User/agent code must NOT run `pip install` at runtime.
2. **32 GiB RAM / multi-core** for heavy data, docs, and plotting workloads.
3. **Workspace I/O**: stage input files, execute, collect generated artifacts.
4. **Stable HTTP API** for the TypeScript agent loop (`MODAL_EXECUTE_URL`).

Deploy (when you are ready — not automatic):
    modal deploy modal/sandboxes/execute_code.py

Then set MODAL_EXECUTE_URL to the printed `execute_code` endpoint URL.
"""

from __future__ import annotations

import modal

APP_NAME = "klaw-sandbox"
PYTHON_VERSION = "3.11"

# Resource profile (Modal memory is MiB)
MEMORY_MIB = 32 * 1024  # 32 GiB
CPU_CORES = 8.0
TIMEOUT_SEC = 600
EPHEMERAL_DISK_MIB = 100 * 1024  # 100 GiB scratch

WORK_ROOT = "/tmp/klaw_workspace"
MAX_STDOUT_CHARS = 250_000
MAX_STDERR_CHARS = 100_000
MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MiB per returned file
MAX_TOTAL_FILE_BYTES = 60 * 1024 * 1024  # 60 MiB total artifacts
MAX_RETURN_FILES = 32

# ---------------------------------------------------------------------------
# System packages (apt) — available globally in the container
# ---------------------------------------------------------------------------
APT_PACKAGES = [
    # Build / basics
    "build-essential",
    "curl",
    "wget",
    "git",
    "ca-certificates",
    "pkg-config",
    # OCR / PDF / images
    "tesseract-ocr",
    "tesseract-ocr-eng",
    "poppler-utils",
    "libmagic1",
    "libgl1",
    "libglib2.0-0",
    "libsm6",
    "libxext6",
    "libxrender1",
    # Fonts & rendering (docs / matplotlib)
    "fonts-dejavu-core",
    "fonts-liberation",
    "fonts-freefont-ttf",
    "libcairo2",
    "libpango-1.0-0",
    "libpangocairo-1.0-0",
    "libgdk-pixbuf-2.0-0",
    "shared-mime-info",
    # Compression / archives
    "unzip",
    "zip",
    "xz-utils",
]

# ---------------------------------------------------------------------------
# Python packages — baked into the image (global site-packages)
# Grouped for readability; all install at image-build time once.
# ---------------------------------------------------------------------------
PIP_PACKAGES = [
    # HTTP API (Modal fastapi_endpoint)
    "fastapi[standard]",
    # HTTP / scraping
    "requests",
    "httpx",
    "aiohttp",
    "urllib3",
    "beautifulsoup4",
    "lxml",
    "html5lib",
    "feedparser",
    "tldextract",
    # Core data stack
    "numpy",
    "pandas",
    "scipy",
    "scikit-learn",
    "statsmodels",
    "pyarrow",
    "polars",
    "duckdb",
    # Spreadsheets / tabular
    "openpyxl",
    "xlsxwriter",
    "xlrd",
    "tabulate",
    # Visualization
    "matplotlib",
    "seaborn",
    "plotly",
    "pillow",
    # Documents (aligns with skills/document-generation)
    "python-docx",
    "python-pptx",
    "reportlab",
    "fpdf2",
    "PyMuPDF",
    "pdfplumber",
    "pypdf",
    "pdf2image",
    "pytesseract",
    "markdown",
    "jinja2",
    # Images / CV (headless)
    "opencv-python-headless",
    # Math
    "sympy",
    "mpmath",
    # Serialization / validation / utils
    "pydantic",
    "jsonschema",
    "orjson",
    "pyyaml",
    "python-dateutil",
    "pytz",
    "chardet",
    "python-magic",
    "regex",
    "tqdm",
    "tenacity",
    "sqlalchemy",
]

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version=PYTHON_VERSION)
    .apt_install(*APT_PACKAGES)
    .pip_install(*PIP_PACKAGES)
    .env(
        {
            # Headless plotting
            "MPLBACKEND": "Agg",
            "PYTHONUNBUFFERED": "1",
            # Tesseract data path is usually default on Debian
            "KLAW_SANDBOX": "1",
            "KLAW_WORK_ROOT": WORK_ROOT,
        }
    )
)


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit] + f"\n...[truncated {omitted} chars]"


def _guess_media_type(name: str) -> str:
    import mimetypes

    media, _ = mimetypes.guess_type(name)
    return media or "application/octet-stream"


def _run_user_code(
    code: str,
    *,
    input_files: dict[str, str] | None = None,
    timeout_seconds: int | None = None,
) -> dict:
    """
    Execute user code in an isolated workspace and collect outputs.

    input_files: optional map of relative_path -> base64 content to stage first.
    """
    import base64
    import io
    import os
    import shutil
    import signal
    import time
    import traceback
    from contextlib import redirect_stderr, redirect_stdout
    from pathlib import Path

    started = time.monotonic()
    work = Path(WORK_ROOT)
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)

    # Stage input files (if any)
    staged: list[str] = []
    for rel, b64 in (input_files or {}).items():
        # Prevent path escape
        target = (work / rel).resolve()
        if not str(target).startswith(str(work.resolve())):
            return {
                "success": False,
                "stdout": "",
                "stderr": f"Invalid input path: {rel}",
                "files": [],
                "duration_ms": int((time.monotonic() - started) * 1000),
                "error_type": "InvalidPath",
            }
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(b64))
        staged.append(str(target.relative_to(work)))

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    success = True
    error_type: str | None = None

    # Soft timeout via SIGALRM (Unix only — Modal containers are Linux)
    def _timeout_handler(signum, frame):  # noqa: ARG001
        raise TimeoutError(f"Code execution exceeded {timeout_seconds}s")

    effective_timeout = None
    if timeout_seconds is not None and timeout_seconds > 0:
        effective_timeout = min(int(timeout_seconds), TIMEOUT_SEC - 5)

    old_cwd = os.getcwd()
    os.chdir(work)

    # Rich but still sandboxed globals — standard builtins, no injected secrets
    exec_globals: dict = {
        "__name__": "__main__",
        "__file__": str(work / "main.py"),
        "__builtins__": __builtins__,
    }

    try:
        if effective_timeout:
            signal.signal(signal.SIGALRM, _timeout_handler)
            signal.alarm(effective_timeout)

        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            if staged:
                print(f"[klaw] staged input files: {', '.join(staged)}")
            print(f"[klaw] workspace: {work}")
            exec(compile(code, str(work / "main.py"), "exec"), exec_globals)
    except Exception as e:
        success = False
        error_type = type(e).__name__
        stderr_buf.write(f"{error_type}: {e}\n")
        stderr_buf.write(traceback.format_exc())
    finally:
        if effective_timeout:
            signal.alarm(0)
        os.chdir(old_cwd)

    # Collect generated artifacts (skip nothing critical; skip huge files)
    files_out: list[dict] = []
    total_bytes = 0
    for path in sorted(work.rglob("*")):
        if not path.is_file():
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size <= 0 or size > MAX_FILE_BYTES:
            continue
        if total_bytes + size > MAX_TOTAL_FILE_BYTES:
            break
        if len(files_out) >= MAX_RETURN_FILES:
            break
        rel = str(path.relative_to(work)).replace("\\", "/")
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        files_out.append(
            {
                "name": path.name,
                "path": rel,
                "size": size,
                "media_type": _guess_media_type(path.name),
                "content_base64": base64.b64encode(raw).decode("ascii"),
            }
        )
        total_bytes += size

    duration_ms = int((time.monotonic() - started) * 1000)
    return {
        "success": success,
        "stdout": _truncate(stdout_buf.getvalue(), MAX_STDOUT_CHARS),
        "stderr": _truncate(stderr_buf.getvalue(), MAX_STDERR_CHARS),
        "files": files_out,
        "duration_ms": duration_ms,
        "error_type": error_type,
        "meta": {
            "python": PYTHON_VERSION,
            "memory_mib": MEMORY_MIB,
            "cpu": CPU_CORES,
            "workspace": WORK_ROOT,
            "files_returned": len(files_out),
            "files_bytes": total_bytes,
        },
    }


@app.function(
    image=image,
    cpu=CPU_CORES,
    memory=MEMORY_MIB,
    timeout=TIMEOUT_SEC,
    ephemeral_disk=EPHEMERAL_DISK_MIB,
)
@modal.fastapi_endpoint(method="POST")
def execute_code(item: dict) -> dict:
    """
    Execute Python code in the Klaw sandbox.

    Request JSON:
      {
        "code": "print('hello')",                 # required
        "files": { "data.csv": "<base64>" },      # optional staged inputs
        "timeout_seconds": 120                    # optional soft limit
      }

    Response JSON:
      {
        "success": true,
        "stdout": "...",
        "stderr": "...",
        "files": [{ "name", "path", "size", "media_type", "content_base64" }],
        "duration_ms": 42,
        "error_type": null,
        "meta": { ... }
      }
    """
    if not isinstance(item, dict):
        return {
            "success": False,
            "stdout": "",
            "stderr": "Request body must be a JSON object",
            "files": [],
            "duration_ms": 0,
            "error_type": "BadRequest",
        }

    code = item.get("code")
    if not code or not isinstance(code, str):
        return {
            "success": False,
            "stdout": "",
            "stderr": "Missing required string field: code",
            "files": [],
            "duration_ms": 0,
            "error_type": "BadRequest",
        }

    input_files = item.get("files") or {}
    if input_files is not None and not isinstance(input_files, dict):
        return {
            "success": False,
            "stdout": "",
            "stderr": "Field 'files' must be an object of path -> base64",
            "files": [],
            "duration_ms": 0,
            "error_type": "BadRequest",
        }

    timeout_seconds = item.get("timeout_seconds")
    if timeout_seconds is not None:
        try:
            timeout_seconds = int(timeout_seconds)
        except (TypeError, ValueError):
            timeout_seconds = None

    return _run_user_code(
        code,
        input_files=input_files,
        timeout_seconds=timeout_seconds,
    )


@app.function(image=image, cpu=0.25, memory=512, timeout=30)
@modal.fastapi_endpoint(method="GET")
def health() -> dict:
    """Lightweight health / capability probe (small container)."""
    return {
        "status": "ok",
        "app": APP_NAME,
        "python": PYTHON_VERSION,
        "execute": {
            "memory_mib": MEMORY_MIB,
            "cpu": CPU_CORES,
            "timeout_sec": TIMEOUT_SEC,
            "ephemeral_disk_mib": EPHEMERAL_DISK_MIB,
        },
        "packages_sample": [
            "numpy",
            "pandas",
            "polars",
            "matplotlib",
            "sklearn",
            "docx",
            "openpyxl",
            "reportlab",
            "fitz",  # PyMuPDF
            "pdfplumber",
            "PIL",
            "cv2",
            "sympy",
            "bs4",
            "httpx",
        ],
        "note": "All listed libraries are preinstalled in the execute_code image.",
    }


@app.local_entrypoint()
def main():
    """Quick local smoke test: modal run modal/sandboxes/execute_code.py"""
    sample = (
        "import numpy as np, pandas as pd\n"
        "from pathlib import Path\n"
        "df = pd.DataFrame({'x': np.arange(5), 'y': np.arange(5) ** 2})\n"
        "df.to_csv('out.csv', index=False)\n"
        "print(df.describe())\n"
        "print('wrote', Path('out.csv').resolve())\n"
    )
    result = execute_code.remote({"code": sample})
    print("success:", result.get("success"))
    print("stdout:\n", result.get("stdout"))
    print("stderr:\n", result.get("stderr"))
    print("files:", [f.get("path") for f in result.get("files") or []])
