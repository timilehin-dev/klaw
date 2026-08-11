// OpenAI-compatible tool definitions

export const agentTools = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description: [
        "Execute Python 3.11 in Klaw's secure Modal sandbox (32GB RAM, 8 CPU).",
        "Workspace is /mnt/data (cwd). Most common libraries are PREINSTALLED globally",
        "(numpy, pandas, polars, duckdb, scipy, sklearn, matplotlib, seaborn, plotly,",
        "python-docx, python-pptx, openpyxl, reportlab, PyMuPDF, pdfplumber, Pillow,",
        "opencv, pytesseract, requests, httpx, beautifulsoup4, sympy, SQLAlchemy, psycopg2, …).",
        "Prefer imports without pip. Only set `dependencies` for rare packages NOT already available.",
        "Write outputs under /mnt/data; they are returned. Print key results to stdout.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "Valid, self-contained Python 3.11 code. Use print() for outputs. Save files under /mnt/data (e.g. /mnt/data/out.csv).",
          },
          dependencies: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional pip packages to install before run if missing (e.g. ['yfinance']). Skip when using preinstalled libs.",
          },
        },
        required: ["code"],
      },
    },
  },
];
