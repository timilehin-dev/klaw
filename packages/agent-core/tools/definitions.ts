// OpenAI-compatible tool definitions

export const agentTools = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description: [
        "Execute Python 3.11 in Klaw's secure Modal sandbox (32GB RAM, 8 CPU).",
        "Preinstalled: numpy, pandas, polars, duckdb, scipy, scikit-learn, matplotlib, seaborn, plotly,",
        "python-docx, python-pptx, openpyxl, reportlab, PyMuPDF, pdfplumber, Pillow, opencv, pytesseract,",
        "requests, httpx, beautifulsoup4, sympy, and more. Do NOT pip install — imports work globally.",
        "Write output files in the current working directory; they are returned to you.",
        "Print important results to stdout. Use for calculations, data analysis, docs, plots, scraping.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "Valid, self-contained Python 3.11 code. Use print() for outputs. Save files to the cwd (e.g. out.csv, report.pdf).",
          },
        },
        required: ["code"],
      },
    },
  },
];
