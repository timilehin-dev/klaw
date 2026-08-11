/**
 * Embedded skill catalog — source of truth at runtime.
 * Markdown under /skills is for humans & deploy docs; this bundle works in
 * Next.js / Inngest without relying on monorepo filesystem paths.
 */

export type SkillId =
  | "document-generation"
  | "data-analysis"
  | "web-research"
  | "sql-querying"
  | "code-review"
  | "api-testing"
  | "financial-modeling"
  | "text-processing";

export type SkillDefinition = {
  id: SkillId;
  title: string;
  /** When true, dual-router prefers DeepSeek for pure reasoning paths */
  preferReasoningModel?: boolean;
  markdown: string;
};

export const SKILL_CATALOG: SkillDefinition[] = [
  {
    id: "document-generation",
    title: "Document Generation",
    markdown: `# Skill: Document Generation
**Trigger:** User asks to create a PDF, DOCX, XLSX, or CSV.
**Action:**
1. Extract the required data and structure.
2. Write a Python script using \`reportlab\` (for PDF) or \`openpyxl\` (for XLSX) or \`python-docx\` / \`csv\`.
3. The script MUST save the file under \`/mnt/data/\` (sandbox workspace), e.g. \`/mnt/data/output.pdf\`.
4. Call \`execute_code\` to run the script.
5. Tell the user the relative path (e.g. \`output.pdf\`) that was generated.`,
  },
  {
    id: "data-analysis",
    title: "Data Analysis & Visualization",
    markdown: `# Skill: Data Analysis & Visualization
**Trigger:** User provides data (CSV, JSON, or pasted) and asks for analysis or charts.
**Action:**
1. Write a Python script using \`pandas\` to read and analyze the data.
2. Use \`matplotlib\` or \`seaborn\` to generate charts (headless Agg backend is already set).
3. Save charts to \`/mnt/data/chart.png\`.
4. Print statistical summaries to stdout.
5. Call \`execute_code\` to run the script.`,
  },
  {
    id: "web-research",
    title: "Web Scraping & Research",
    markdown: `# Skill: Web Scraping & Research
**Trigger:** User asks to scrape a website or gather information from URLs.
**Action:**
1. Write a Python script using \`requests\` and \`BeautifulSoup\` (or \`httpx\`).
2. Extract the requested data (e.g., pricing tables, article text).
3. Save structured data (JSON/CSV) under \`/mnt/data/\`.
4. Call \`execute_code\` to run the script.
5. Respect site terms; prefer public pages; set a clear User-Agent.`,
  },
  {
    id: "sql-querying",
    title: "SQL Database Querying",
    markdown: `# Skill: SQL Database Querying
**Trigger:** User asks to query a database, extract metrics, or analyze records.
**Action:**
1. Write a Python script using \`sqlite3\`, \`duckdb\`, \`SQLAlchemy\`, or \`psycopg2\` as appropriate.
2. Prefer read-only queries unless the user explicitly asks for writes.
3. Format results as a Pandas DataFrame and print to stdout (and optionally save CSV under \`/mnt/data/\`).
4. Call \`execute_code\` to run the script.
5. Never hard-code production secrets — use env vars only if the sandbox provides them.`,
  },
  {
    id: "code-review",
    title: "Code Refactoring & Review",
    preferReasoningModel: true,
    markdown: `# Skill: Code Refactoring & Review
**Trigger:** User provides code and asks for optimization, bug fixes, or translation to another language.
**Action:**
1. Analyze the code structure, complexity, and failure modes.
2. Write the improved code with clear explanations of changes.
3. If testing is required, write a test script and call \`execute_code\`.
4. Return the final formatted code block.
5. Prefer DeepSeek-class reasoning for pure review when tools are not required.`,
  },
  {
    id: "api-testing",
    title: "API Testing & Integration",
    markdown: `# Skill: API Testing & Integration
**Trigger:** User asks to test an endpoint, integrate an API, or parse JSON responses.
**Action:**
1. Write a Python script using \`requests\` or \`httpx\`.
2. Perform the GET/POST/PUT/PATCH/DELETE operations.
3. Parse the JSON response and print relevant fields (status, headers subset, body keys).
4. Call \`execute_code\` to run the script.
5. Never log secrets; redact tokens in stdout.`,
  },
  {
    id: "financial-modeling",
    title: "Financial & Math Modeling",
    preferReasoningModel: true,
    markdown: `# Skill: Financial & Math Modeling
**Trigger:** User asks for ROI calculation, forecasting, or complex mathematical modeling.
**Action:**
1. Write a Python script using \`numpy\`, \`pandas\`, and/or \`sympy\` as needed.
2. Perform the calculations with explicit assumptions printed to stdout.
3. Generate a summary report (and optional chart under \`/mnt/data/\`).
4. Call \`execute_code\` to run the script.`,
  },
  {
    id: "text-processing",
    title: "Text Processing & OCR",
    markdown: `# Skill: Text Processing & OCR
**Trigger:** User provides documents, text logs, or asks to extract text from images.
**Action:**
1. Write a Python script using \`Pillow\` + \`pytesseract\` (OCR), \`PyMuPDF\`/\`pdfplumber\` (PDFs), or regex (logs).
2. Process the input file (stage inputs via sandbox \`files\` when available).
3. Save extracted text to \`/mnt/data/extracted.txt\`.
4. Call \`execute_code\` to run the script.`,
  },
];
