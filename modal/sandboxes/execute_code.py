"""
Klaw Modal Sandbox — secure, high-memory code execution for agent tool calling.

Design goals
------------
1. **Fat image**: common libraries preinstalled globally at image-build time.
2. **32 GiB RAM / multi-core** for heavy data, docs, and plotting.
3. **/mnt/data volume** for skill outputs (PDFs, CSVs, charts).
4. **Optional dynamic deps**: rare packages via `dependencies` (allowlisted pip).
5. **HTTP API** for the TypeScript agent loop (`MODAL_EXECUTE_URL`).

Deploy (manual):
    modal deploy modal/sandboxes/execute_code.py
"""

from __future__ import annotations

import modal
import re

APP_NAME = "klaw-sandbox"
PYTHON_VERSION = "3.11"

MEMORY_MIB = 32 * 1024  # 32 GiB
CPU_CORES = 8.0
TIMEOUT_SEC = 600
EPHEMERAL_DISK_MIB = 100 * 1024

WORK_ROOT = "/mnt/data"
MAX_STDOUT_CHARS = 250_000
MAX_STDERR_CHARS = 100_000
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_FILE_BYTES = 60 * 1024 * 1024
MAX_RETURN_FILES = 32
MAX_DYNAMIC_DEPS = 15

# pip package tokens only (name + optional version pin). Blocks shell metacharacters.
_DEP_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._\-]*([<>=!~]=?[A-Za-z0-9._\*+\-]+)?$"
)

APT_PACKAGES = [
    "build-essential",
    "curl",
    "wget",
    "git",
    "ca-certificates",
    "pkg-config",
    "libpq-dev",
    "gcc",
    "tesseract-ocr",
    "tesseract-ocr-eng",
    "poppler-utils",
    "libmagic1",
    "libgl1",
    "libglib2.0-0",
    "libsm6",
    "libxext6",
    "libxrender1",
    "fonts-dejavu-core",
    "fonts-liberation",
    "fonts-freefont-ttf",
    "libcairo2",
    "libpango-1.0-0",
    "libpangocairo-1.0-0",
    "libgdk-pixbuf-2.0-0",
    "shared-mime-info",
    "unzip",
    "zip",
    "xz-utils",
]

PIP_PACKAGES = [
    "fastapi[standard]",
    "requests",
    "httpx",
    "aiohttp",
    "urllib3",
    "beautifulsoup4",
    "lxml",
    "html5lib",
    "feedparser",
    "tldextract",
    "numpy",
    "pandas",
    "scipy",
    "scikit-learn",
    "statsmodels",
    "pyarrow",
    "polars",
    "duckdb",
    "openpyxl",
    "xlsxwriter",
    "xlrd",
    "tabulate",
    "matplotlib",
    "seaborn",
    "plotly",
    "pillow",
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
    "opencv-python-headless",
    "sympy",
    "mpmath",
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
    "psycopg2-binary",
]

app = modal.App(APP_NAME)

# Persistent outputs for agent-generated files (skills write here)
output_vol = modal.Volume.from_name("klaw-agent-outputs", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version=PYTHON_VERSION)
    .apt_install(*APT_PACKAGES)
    .pip_install(*PIP_PACKAGES)
    .env(
        {
            "MPLBACKEND": "Agg",
            "PYTHONUNBUFFERED": "1",
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


def _sanitize_dependencies(raw: list | None) -> tuple[list[str], str | None]:
    if not raw:
        return [], None
    if not isinstance(raw, list):
        return [], "dependencies must be a list of package strings"
    if len(raw) > MAX_DYNAMIC_DEPS:
        return [], f"Too many dependencies (max {MAX_DYNAMIC_DEPS})"

    cleaned: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            return [], f"Invalid dependency entry: {item!r}"
        dep = item.strip()
        if len(dep) > 120:
            return [], f"Dependency too long: {dep[:40]}..."
        if not _DEP_RE.match(dep):
            return [], f"Rejected dependency (invalid name/pin): {dep}"
        # Block obvious path / URL installs
        lower = dep.lower()
        if any(x in lower for x in ("://", "/", "\\", "..", "git+", "file:")):
            return [], f"Rejected dependency (only PyPI pins allowed): {dep}"
        cleaned.append(dep)
    return cleaned, None


def _install_dependencies(deps: list[str]) -> str | None:
    """Install allowlisted packages. Returns error string or None."""
    if not deps:
        return None
    import subprocess
    import sys

    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--no-cache-dir", *deps],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        return None
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode("utf-8", errors="replace") if e.stderr else str(e)
        return f"Failed to install dependencies {deps}: {err}"


def _prepare_workspace() -> None:
    """Ensure /mnt/data exists and is clean enough for isolated runs."""
    import shutil
    from pathlib import Path

    work = Path(WORK_ROOT)
    work.mkdir(parents=True, exist_ok=True)
    for child in list(work.iterdir()):
        # Keep volume metadata; wipe run artifacts for isolation
        if child.name in {".modal", ".git"}:
            continue
        try:
            if child.is_file() or child.is_symlink():
                child.unlink(missing_ok=True)
            elif child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            pass


def _run_user_code(
    code: str,
    *,
    input_files: dict[str, str] | None = None,
    timeout_seconds: int | None = None,
    dependencies: list[str] | None = None,
) -> dict:
    import base64
    import io
    import os
    import signal
    import time
    import traceback
    from contextlib import redirect_stderr, redirect_stdout
    from pathlib import Path

    started = time.monotonic()

    deps, dep_err = _sanitize_dependencies(dependencies)
    if dep_err:
        return {
            "success": False,
            "stdout": "",
            "stderr": dep_err,
            "files": [],
            "duration_ms": int((time.monotonic() - started) * 1000),
            "error_type": "InvalidDependencies",
        }

    install_err = _install_dependencies(deps)
    if install_err:
        return {
            "success": False,
            "stdout": "",
            "stderr": install_err,
            "files": [],
            "duration_ms": int((time.monotonic() - started) * 1000),
            "error_type": "DependencyInstallError",
            "meta": {"dependencies": deps},
        }

    _prepare_workspace()
    work = Path(WORK_ROOT)

    staged: list[str] = []
    for rel, b64 in (input_files or {}).items():
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

    def _timeout_handler(signum, frame):  # noqa: ARG001
        raise TimeoutError(f"Code execution exceeded {timeout_seconds}s")

    effective_timeout = None
    if timeout_seconds is not None and timeout_seconds > 0:
        effective_timeout = min(int(timeout_seconds), TIMEOUT_SEC - 5)

    old_cwd = os.getcwd()
    os.chdir(work)

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
            if deps:
                print(f"[klaw] installed dependencies: {', '.join(deps)}")
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

    files_out: list[dict] = []
    total_bytes = 0
    for path in sorted(work.rglob("*")):
        if not path.is_file():
            continue
        if path.name == "main.py":
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
            "dependencies": deps,
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
    volumes={WORK_ROOT: output_vol},
)
@modal.fastapi_endpoint(method="POST")
def execute_code(item: dict) -> dict:
    """
    Request JSON:
      {
        "code": "...",
        "dependencies": ["optional-package"],
        "files": { "in.csv": "<base64>" },
        "timeout_seconds": 120
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

    dependencies = item.get("dependencies")

    result = _run_user_code(
        code,
        input_files=input_files,
        timeout_seconds=timeout_seconds,
        dependencies=dependencies if isinstance(dependencies, list) else None,
    )

    # Persist generated files on the volume
    try:
        output_vol.commit()
    except Exception:
        pass

    return result


@app.function(image=image, cpu=0.25, memory=512, timeout=30)
@modal.fastapi_endpoint(method="GET")
def health() -> dict:
    return {
        "status": "ok",
        "app": APP_NAME,
        "python": PYTHON_VERSION,
        "execute": {
            "memory_mib": MEMORY_MIB,
            "cpu": CPU_CORES,
            "timeout_sec": TIMEOUT_SEC,
            "workspace": WORK_ROOT,
            "volume": "klaw-agent-outputs",
        },
        "note": "Fat image preinstalls common libs; optional dependencies for rare packages only.",
    }


@app.local_entrypoint()
def main():
    """modal run modal/sandboxes/execute_code.py"""
    sample = (
        "import numpy as np, pandas as pd\n"
        "from pathlib import Path\n"
        "df = pd.DataFrame({'x': np.arange(5), 'y': np.arange(5) ** 2})\n"
        "df.to_csv('/mnt/data/out.csv', index=False)\n"
        "print(df.describe())\n"
        "print('wrote', Path('/mnt/data/out.csv').resolve())\n"
    )
    result = execute_code.remote({"code": sample})
    print("success:", result.get("success"))
    print("stdout:\n", result.get("stdout"))
    print("stderr:\n", result.get("stderr"))
    print("files:", [f.get("path") for f in result.get("files") or []])
