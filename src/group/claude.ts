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

export interface GroupOptions {
  run?: Runner;
  /** Override the per-batch char budget (mainly for tests). */
  batchBudget?: number;
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
    const parts: Grouping[] = [];
    for (const batch of batches) {
      const knownRefs = batch.flatMap((s) => s.refs);
      const raw = await callClaude(buildPrompt(batch), run);
      parts.push(reconcileGrouping(raw, knownRefs));
    }
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
    diffText: blocks[i] ?? "",
  }));
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

Rules:
- Reference hunks ONLY by the exact ids listed below. Do not invent ids.
- Every hunk should go in exactly one group.
- importance is one of: "high", "medium", "low".
- summary: one or two sentences on what the group changes and why it matters.
- Respond with ONLY a JSON object, no prose, no code fences.

JSON shape:
{"groups":[{"title":"...","importance":"high|medium|low","summary":"...","hunks":["file:Hn"]}]}

Hunk ids:
${refListing}

Unified diff:
${diffBody}`;
}

interface ClaudeEnvelope {
  result?: string;
  is_error?: boolean;
}

async function callClaude(prompt: string, run: Runner): Promise<unknown> {
  const { stdout } = await run("claude", ["-p", "--output-format", "json"], prompt);
  const env = JSON.parse(stdout) as ClaudeEnvelope;
  if (env.is_error || typeof env.result !== "string") {
    throw new Error("claude returned an error envelope");
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
    throw new Error("no JSON object found in claude output");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
