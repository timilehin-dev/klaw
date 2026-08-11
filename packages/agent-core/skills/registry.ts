import { SKILL_CATALOG, type SkillDefinition } from "./catalog";

/**
 * Load skill prompts for the system message.
 * Uses the embedded catalog (reliable in serverless). Optionally merges
 * on-disk /skills if present (local monorepo dev).
 */
export function loadSkillPrompts(): string {
  let combined =
    "\n\n# AVAILABLE SKILLS\nYou have access to the following industry-standard skills. Follow their instructions precisely when triggered. Sandbox workspace is `/mnt/data` (also the process cwd). Libraries are preinstalled — never pip install.\n\n";

  const skills = listSkills();
  for (const skill of skills) {
    combined += `--- ${skill.id.toUpperCase()} ---\n${skill.markdown}\n\n`;
  }

  return combined;
}

export function listSkills(): SkillDefinition[] {
  // Embedded catalog is authoritative
  return SKILL_CATALOG;
}

/**
 * Lightweight heuristic for dual-model routing.
 * Returns true when the task is primarily reasoning/review and may not need tools.
 */
export function prefersReasoningModel(userMessage: string): boolean {
  const m = (userMessage || "").toLowerCase();

  const reasoningHints =
    /\b(refactor|code review|review (this|my) code|optimize this|explain (this|the) code|translate (this|to)|architecture review|prove that|derive|walk me through)\b/;
  const toolHints =
    /\b(run|execute|plot|chart|graph|pdf|docx|xlsx|csv|scrape|crawl|http|api|endpoint|query|sql|database|roi|forecast|ocr|extract text|screenshot|generate (a |an )?(file|report|document|spreadsheet))\b/;

  if (toolHints.test(m)) return false;
  if (reasoningHints.test(m)) return true;

  // Prefer reasoning for long pure-code pastes without action verbs
  const codeFence = (userMessage.match(/```/g) || []).length >= 2;
  if (codeFence && !toolHints.test(m)) return true;

  return false;
}

export function buildBaseSystemPrompt(): string {
  return [
    "You are Klaw, an expert AI engineer assistant.",
    "You can call the `execute_code` tool to run Python 3.11 in a secure 32GB Modal sandbox.",
    "Sandbox workspace: `/mnt/data` (cwd). Write all output files there.",
    "Libraries are preinstalled globally (numpy, pandas, polars, duckdb, scipy, scikit-learn,",
    "matplotlib, seaborn, plotly, python-docx, python-pptx, openpyxl, reportlab, PyMuPDF,",
    "pdfplumber, Pillow, opencv, pytesseract, requests, httpx, beautifulsoup4, sympy,",
    "SQLAlchemy, psycopg2, and more) — never pip install at runtime.",
    "Use skills below when their triggers match. Prefer tools for computation and file generation.",
  ].join(" ");
}
