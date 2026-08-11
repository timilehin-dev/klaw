/**
 * Detect destructive / high-risk code that should pause for human approval.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\brm\s+-rf\b/i,
  /\bshutil\.rmtree\b/i,
  /\bos\.(remove|unlink|rmdir)\b/i,
  /\bpathlib\.Path\([^\)]*\)\.unlink\b/i,
  /\bsmtplib\b/i,
  /\bsendmail\b/i,
  /\bsubprocess\.[^(]*\([^)]*shell\s*=\s*True/i,
  /\brequests\.(post|put|patch|delete)\b/i,
  /\bhttpx\.(post|put|patch|delete)\b/i,
  /\bopen\([^\)]*['\"]w/i,
];

export function codeLooksDestructive(code: string): boolean {
  if (!code) return false;
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(code));
}

/** LLM flag OR static heuristic */
export function requiresHumanApproval(
  code: string,
  flag?: boolean | null
): boolean {
  if (flag === true) return true;
  return codeLooksDestructive(code);
}
