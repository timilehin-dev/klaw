// OpenAI-compatible tool definitions

export const agentTools = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description: [
        "Execute Python 3.11 in Klaw's secure Modal sandbox (32GB RAM, 8 CPU).",
        "Workspace is /mnt/data (also cwd). Preinstalled: numpy, pandas, polars, duckdb, scipy, scikit-learn,",
        "matplotlib, seaborn, plotly, python-docx, python-pptx, openpyxl, reportlab, PyMuPDF, pdfplumber,",
        "Pillow, opencv, pytesseract, requests, httpx, beautifulsoup4, sympy, SQLAlchemy, psycopg2, and more.",
        "Do NOT pip install. Write output files under /mnt/data; they are returned. Print key results to stdout.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "Valid, self-contained Python 3.11 code. Use print() for outputs. Save files under /mnt/data (e.g. /mnt/data/out.csv).",
          },
        },
        required: ["code"],
      },
    },
  },
];
