"""
Modal Sandbox for Secure Code Execution.
This script deploys a Modal function that accepts code as a string,
executes it in an isolated container, and returns the stdout/stderr.
"""
import modal

app = modal.App("klaw-sandbox")

# Lightweight Python image with common data/doc libraries
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "pandas", "requests", "matplotlib", "reportlab"
)


@app.function(image=image, cpu=1, memory=1024, timeout=300)
@modal.web_endpoint(method="POST")
def execute_code(item: dict) -> dict:
    """
    Executes Python code and captures stdout/stderr.
    Expects JSON body: { "code": "..." }
    """
    import sys
    import io
    from contextlib import redirect_stdout, redirect_stderr

    code = item.get("code", "") if isinstance(item, dict) else ""

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    try:
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            # Execute the code in a restricted global namespace
            exec(code, {"__name__": "__main__"})

        return {
            "success": True,
            "stdout": stdout_capture.getvalue(),
            "stderr": stderr_capture.getvalue(),
        }
    except Exception as e:
        return {
            "success": False,
            "stdout": stdout_capture.getvalue(),
            "stderr": f"{type(e).__name__}: {str(e)}",
        }
