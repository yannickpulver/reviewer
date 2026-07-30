import type { ParsedDiff } from "../diff/types.js";
import { runCommand, type Runner } from "../util/exec.js";
import {
  fallbackGrouping,
  mergeGroupings,
  reconcileGrouping,
  sortByImportance,
} from "./grouping.js";
import type { Grouping } from "./types.js";

/** Target prompt size per Claude call, in characters (~chars/4 tokens → ~100k tokens). */
const BATCH_CHAR_BUDGET = 400_000;

/** Max diff body lines per hunk in the grouping prompt — classification doesn't need full bodies. */
const MAX_HUNK_LINES = 40;

export interface GroupOptions {
  run?: Runner;
  /** Override the per-batch char budget (mainly for tests). */
  batchBudget?: number;
  /** Claude model to pass to the CLI; defaults to "sonnet" — grouping is classification and doesn't need a bigger model. */
  model?: string;
  /** Called as each batch completes, with the completed count (1-based) and the total. */
  onProgress?: (completed: number, totalBatches: number) => void;
}

/** A single file's slice of the raw diff plus its known hunk refs. */
interface FileSegment {
  path: string;
  refs: string[];
  diffText: string;
}

/**
 * Group the diff via the local `claude` CLI. Chunks large diffs by token budget
 * (never splitting a file), groups each chunk, merges by title, and falls back to
 * a single group if Claude is unavailable or returns unusable output.
 */
export async function groupDiff(
  diff: ParsedDiff,
  rawDiff: string,
  opts: GroupOptions = {},
): Promise<Grouping> {
  const run = opts.run ?? runCommand;
  const budget = opts.batchBudget ?? BATCH_CHAR_BUDGET;

  const segments = sliceSegments(diff, rawDiff);
  if (segments.length === 0) return { groups: [], ungrouped: [] };

  const batches = packBatches(segments, budget);

  try {
    let completed = 0;
    const parts = await Promise.all(
      batches.map(async (batch) => {
        const raw = await callClaude(buildPrompt(batch), run, opts.model ?? "sonnet");
        opts.onProgress?.(++completed, batches.length);
        return reconcileGrouping(raw, batch.flatMap((s) => s.refs));
      }),
    );
    return sortByImportance(mergeGroupings(parts));
  } catch {
    return fallbackGrouping(diff);
  }
}

/** Split the raw diff into per-file segments aligned with the parsed files. */
export function sliceSegments(diff: ParsedDiff, rawDiff: string): FileSegment[] {
  const lines = rawDiff.split("\n");
  const blocks: string[] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (cur) blocks.push(cur.join("\n"));
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur.join("\n"));

  // Pair blocks with parsed files positionally (both follow diff order).
  return diff.files.map((f, i) => ({
    path: f.path,
    refs: f.hunks.map((h) => `${f.path}:${h.id}`),
    diffText: capHunkBodies(blocks[i] ?? "", MAX_HUNK_LINES),
  }));
}

/** Truncate each hunk's body, keeping all file/hunk headers so every hunk stays identifiable. */
export function capHunkBodies(diffText: string, maxLines: number): string {
  const out: string[] = [];
  let inHunk = false;
  let body = 0;
  let omitted = 0;
  const flush = () => {
    if (omitted > 0) out.push(`... (${omitted} more lines omitted)`);
    omitted = 0;
    body = 0;
  };
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      inHunk = false;
      out.push(line);
    } else if (line.startsWith("@@")) {
      flush();
      inHunk = true;
      out.push(line);
    } else if (inHunk && ++body > maxLines) {
      omitted++;
    } else {
      out.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/** Pack whole-file segments into batches under the char budget. */
export function packBatches(segments: FileSegment[], budget: number): FileSegment[][] {
  const batches: FileSegment[][] = [];
  let cur: FileSegment[] = [];
  let size = 0;
  for (const seg of segments) {
    const segSize = seg.diffText.length;
    if (cur.length > 0 && size + segSize > budget) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(seg);
    size += segSize;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

function buildPrompt(batch: FileSegment[]): string {
  const refListing = batch
    .flatMap((s) => s.refs)
    .map((r) => `- ${r}`)
    .join("\n");
  const diffBody = batch.map((s) => s.diffText).join("\n");

  return `You are organizing a code review. Group the changed hunks into logically related units so a reviewer can review related changes together, and push low-signal changes (string/copy tweaks, formatting, lockfile/dependency bumps, generated files, trivial chores) into low-importance groups.

You also flag changes that may need a closer look: likely bugs, risky edits, missing error/null handling, security or data-loss risks, or logic that looks off. Only flag things you have real reason to doubt — do not invent problems, and skip groups where nothing stands out.

Rules:
- Reference hunks ONLY by the exact ids listed below. Do not invent ids.
- Every hunk should go in exactly one group.
- importance is one of: "high", "medium", "low".
- summary: one or two sentences on what the group changes and why it matters.
- flags: optional array of attention hints for this group. Each flag points at ONE hunk id (which must be one of that group's hunks) with a severity and a one-sentence note. Omit or leave empty when nothing is worth flagging.
- flag severity is one of: "danger" (likely a bug or real risk), "warning" (worth a closer look).
- Respond with ONLY a JSON object, no prose, no code fences.

JSON shape:
{"groups":[{"title":"...","importance":"high|medium|low","summary":"...","hunks":["file:Hn"],"flags":[{"hunk":"file:Hn","severity":"danger|warning","note":"..."}]}]}

Hunk ids:
${refListing}

Unified diff:
${diffBody}`;
}

interface ClaudeEnvelope {
  result?: string;
  is_error?: boolean;
}

/**
 * Args for one-shot claude calls: JSON output, no built-in tools, no MCP servers,
 * no settings (CLAUDE.md/hooks/output styles would slow startup and can break
 * the strict-JSON output contract).
 */
export function claudeArgs(model?: string): string[] {
  const args = [
    "-p",
    "--output-format", "json",
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
  ];
  if (model) args.push("--model", model);
  return args;
}

/** Error message for a failed claude envelope, including the model's own error text when present. */
export function claudeEnvelopeError(env: ClaudeEnvelope): string {
  const detail = typeof env.result === "string" && env.result.trim() ? `: ${env.result.trim()}` : "";
  return `claude returned an error envelope${detail}`;
}

async function callClaude(prompt: string, run: Runner, model?: string): Promise<unknown> {
  const { stdout } = await run("claude", claudeArgs(model), prompt);
  const env = JSON.parse(stdout) as ClaudeEnvelope;
  if (env.is_error || typeof env.result !== "string") {
    throw new Error(claudeEnvelopeError(env));
  }
  return extractJsonObject(env.result);
}

/** Extract a JSON object from model text that may be fenced or surrounded by prose. */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    const snippet = text.trim().slice(0, 200) || "(empty)";
    throw new Error(`no JSON object found in claude output: ${snippet}`);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
