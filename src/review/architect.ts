import type { DiffFile } from "../diff/types.js";
import { claudeArgs, claudeEnvelopeError, extractJsonObject } from "../group/claude.js";
import { runCommand, type Runner } from "../util/exec.js";

export type ArchitectSeverity = "important" | "design" | "nit" | "pre-existing";

export interface ArchitectFinding {
  path: string;
  /** New-file line number */
  line: number;
  severity: ArchitectSeverity;
  /** Plain-language: what breaks, when, why it matters */
  comment: string;
  /** Suggested fix, short */
  fix?: string;
  /** Set server-side once validated against the parsed diff */
  anchored: boolean;
}

export interface ArchitectReview {
  verdict: "clean" | "issues";
  summary: string;
  findings: ArchitectFinding[];
}

const SEVERITIES = new Set<ArchitectSeverity>(["important", "design", "nit", "pre-existing"]);

interface ClaudeEnvelope {
  result?: string;
  is_error?: boolean;
}

/**
 * Run an independent architect review of the diff via the local `claude` CLI,
 * then validate every finding against the parsed diff so the UI knows which
 * ones can be anchored inline.
 */
export async function architectReview(
  diffText: string,
  files: DiffFile[],
  model?: string,
  run: Runner = runCommand,
): Promise<ArchitectReview> {
  const { stdout } = await run("claude", claudeArgs(model), buildPrompt(diffText));
  const env = JSON.parse(stdout) as ClaudeEnvelope;
  if (env.is_error || typeof env.result !== "string") {
    throw new Error(claudeEnvelopeError(env));
  }
  const raw = extractJsonObject(env.result);
  return parseReview(raw, files);
}

interface RawFinding {
  path?: unknown;
  line?: unknown;
  severity?: unknown;
  comment?: unknown;
  fix?: unknown;
}

interface RawReview {
  verdict?: unknown;
  summary?: unknown;
  findings?: unknown;
}

/** Build the set of valid new-side "path\nline" anchors present in the parsed diff. */
function anchorSet(files: DiffFile[]): Set<string> {
  const set = new Set<string>();
  for (const f of files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.newLineNo !== null) set.add(`${f.path}\n${l.newLineNo}`);
      }
    }
  }
  return set;
}

/**
 * Validate raw (untrusted, LLM-produced) findings against the parsed diff.
 * Malformed entries are dropped; well-formed ones are kept and tagged
 * `anchored: true/false` depending on whether path+line actually exists in
 * the diff — never dropped just for being unanchored.
 */
export function validateFindings(raw: unknown, files: DiffFile[]): ArchitectFinding[] {
  if (!Array.isArray(raw)) return [];
  const anchors = anchorSet(files);
  const out: ArchitectFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as RawFinding;
    if (typeof f.path !== "string" || !f.path) continue;
    if (typeof f.line !== "number" || !Number.isFinite(f.line)) continue;
    if (typeof f.comment !== "string" || !f.comment.trim()) continue;
    const severity = SEVERITIES.has(f.severity as ArchitectSeverity)
      ? (f.severity as ArchitectSeverity)
      : "nit";
    const fix = typeof f.fix === "string" && f.fix.trim() ? f.fix.trim() : undefined;
    out.push({
      path: f.path,
      line: f.line,
      severity,
      comment: f.comment.trim(),
      fix,
      anchored: anchors.has(`${f.path}\n${f.line}`),
    });
  }
  return out;
}

function parseReview(raw: unknown, files: DiffFile[]): ArchitectReview {
  const r = (raw ?? {}) as RawReview;
  const findings = validateFindings(r.findings, files);
  const verdict: ArchitectReview["verdict"] =
    r.verdict === "issues" || findings.length > 0 ? "issues" : "clean";
  const summary =
    typeof r.summary === "string" && r.summary.trim()
      ? r.summary.trim()
      : findings.length === 0
        ? "No blocking issues found."
        : `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
  return { verdict, summary, findings };
}

function buildPrompt(diffText: string): string {
  return `You are an independent senior software architect reviewing a pull-request diff. Your job: find real problems, not to look thorough.

Process:
1. Read the entire diff.
2. List candidate findings.
3. For each candidate, try to refute it: check that the diff lines actually support the claim. Drop any finding you cannot back with specific lines from this diff, and any finding you are less than ~80% confident is a real problem.
4. Output only the survivors as JSON.

Never report:
- style, formatting, or naming preferences
- restating or explaining what the code does
- issues in unchanged context lines, unless it is a real bug — then tag it "pre-existing"
- speculative suggestions ("consider adding tests/logging/docs")
- hypothetical edge cases without a concrete failure path

Severity:
- "important": would block merge — bugs, data loss, security, broken behavior
- "design": wrong abstraction, awkward API shape, inconsistency with the rest of the change
- "nit": small worthwhile improvement (at most 5 nits total)
- "pre-existing": real bug visible in context lines but not introduced by this change; never blocking

Writing style — this matters as much as the findings:
- 1–3 short sentences per finding: what breaks, when it happens, and the fix.
- Explain why it's a problem so that someone unfamiliar with the code understands. Simple, informative language. No jargon, no headers, no praise, no hedging ("might potentially").

Output JSON only:
{ "verdict": "clean" | "issues", "summary": "<one line: tally like '1 important, 2 nits' or 'No blocking issues found.'>", "findings": [{ "path": "...", "line": <new-file line number>, "severity": "...", "comment": "...", "fix": "..." }] }
If nothing survives, return verdict "clean" with an empty findings array.

Unified diff:
${diffText}`;
}
