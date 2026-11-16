import type { DiffFile, Hunk, HunkRange, LineMap, LineType, ResolvedHunk, ReviewComment } from "@/types";

/** Build a lookup of "path:Hn" → resolved hunk. */
export function indexHunks(files: DiffFile[]): Map<string, ResolvedHunk> {
  const map = new Map<string, ResolvedHunk>();
  for (const file of files) {
    for (const hunk of file.hunks) {
      const ref = `${file.path}:${hunk.id}`;
      map.set(ref, { ref, path: file.path, hunk });
    }
  }
  return map;
}

/** Group consecutive hunk refs that belong to the same file (for cleaner headers). */
export interface FileBlock {
  path: string;
  hunks: Hunk[];
}

export function blocksForRefs(
  refs: string[],
  index: Map<string, ResolvedHunk>,
): FileBlock[] {
  const blocks: FileBlock[] = [];
  for (const ref of refs) {
    const resolved = index.get(ref);
    if (!resolved) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.path === resolved.path) {
      last.hunks.push(resolved.hunk);
    } else {
      blocks.push({ path: resolved.path, hunks: [resolved.hunk] });
    }
  }
  return blocks;
}

/** Stable key for a draftable comment anchor (new-side line). */
export function lineKey(path: string, newLineNo: number): string {
  return `${path}::${newLineNo}`;
}

/**
 * Move drafted comments onto a refreshed diff. Drafts whose line no longer
 * exists come back as `detached` instead of being silently re-anchored — posting
 * them against the wrong line would be worse than losing the anchor.
 */
export function remapDrafts(
  drafts: Record<string, ReviewComment>,
  lineMap: LineMap,
): { moved: Record<string, ReviewComment>; detached: ReviewComment[] } {
  const moved: Record<string, ReviewComment> = {};
  const detached: ReviewComment[] = [];
  for (const c of Object.values(drafts)) {
    const line = lineMap[c.path]?.[c.line];
    if (line === undefined) detached.push(c);
    else moved[lineKey(c.path, line)] = { ...c, line };
  }
  return { moved, detached };
}

/** Render a hunk back to unified-diff text for use as model context. */
export function hunkToText(hunk: Hunk): string {
  const sign = (t: LineType) => (t === "add" ? "+" : t === "del" ? "-" : " ");
  const body = hunk.lines.map((l) => sign(l.type) + l.content).join("\n");
  return `${hunk.header}\n${body}`;
}

/** One file matching a search query, with every ref of that file. */
export interface SearchHit {
  path: string;
  refs: string[];
  /** Number of diff lines containing the query (0 when only the path matched). */
  matches: number;
}

/**
 * Files whose path, or any diff line, contains `query` (case-insensitive).
 * Binary files can only match on their path.
 */
export function searchFiles(files: DiffFile[], query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const file of files) {
    const pathMatch = file.path.toLowerCase().includes(needle);
    let matches = 0;
    if (!file.binary) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.content.toLowerCase().includes(needle)) matches++;
        }
      }
    }
    if (!pathMatch && matches === 0) continue;
    hits.push({
      path: file.path,
      refs: file.hunks.map((h) => `${file.path}:${h.id}`),
      matches,
    });
  }
  return hits;
}

/** Unchanged new-side lines `start..end` (inclusive; empty when start > end); old = new + delta. */
export interface Region {
  start: number;
  end: number;
  delta: number;
}

/**
 * The unchanged lines before a shown hunk (or after the last one). `down`
 * grows from the hunk above, `up` from the hunk below. They're the same region
 * unless changes shown elsewhere (another group, an earlier review) sit in
 * between — expanding stops at those.
 */
export interface Gap {
  down: Region | null;
  up: Region | null;
  split: boolean;
}

/** First new-side line after the hunk. A hunk with no new lines sits after line `newStart`. */
const newAfter = (h: HunkRange) => (h.newLines > 0 ? h.newStart + h.newLines : h.newStart + 1);
const oldAfter = (h: HunkRange) => (h.oldLines > 0 ? h.oldStart + h.oldLines : h.oldStart + 1);
/** Last new-side line before the hunk. */
const newBefore = (h: HunkRange) => (h.newLines > 0 ? h.newStart - 1 : h.newStart);

const sameHunk = (a: HunkRange, b: HunkRange) =>
  a.newStart === b.newStart && a.oldStart === b.oldStart;

/** `shown.length + 1` gaps: before each shown hunk, then after the last one. */
export function gapsAround(shown: HunkRange[], all: HunkRange[], total: number): Gap[] {
  if (!shown.every((h) => all.some((a) => sameHunk(a, h)))) all = shown;
  const pos = (h: HunkRange) => all.findIndex((a) => sameHunk(a, h));
  return Array.from({ length: shown.length + 1 }, (_, i) => {
    const prev = shown[i - 1];
    const next = shown[i];
    const from = prev ? pos(prev) + 1 : 0;
    const to = next ? pos(next) : all.length;
    const between = from <= to ? all.slice(from, to) : [];
    const first = between[0];
    const last = between[between.length - 1];
    const after = (h: HunkRange | undefined) =>
      h ? { start: newAfter(h), delta: oldAfter(h) - newAfter(h) } : { start: 1, delta: 0 };
    const down = prev
      ? { ...after(prev), end: first ? newBefore(first) : next ? newBefore(next) : total }
      : null;
    const up = next ? { ...after(last ?? prev), end: newBefore(next) } : null;
    return { down, up, split: between.length > 0 };
  });
}

/** How many lines of a gap are shown from each side. */
export interface Revealed {
  down: number;
  up: number;
}

/**
 * The new-side line numbers revealed in a gap (top part, bottom part), how
 * many stay hidden, and which directions can still grow.
 */
export function revealedLines(
  gap: Gap,
  revealed: Revealed,
): { top: number[]; bottom: number[]; hidden: number; down: boolean; up: boolean } {
  const size = (r: Region | null) => (r ? Math.max(0, r.end - r.start + 1) : 0);
  const range = (start: number, n: number) => Array.from({ length: n }, (_, k) => start + k);
  if (gap.split || !gap.down || !gap.up) {
    const d = Math.min(revealed.down, size(gap.down));
    const u = Math.min(revealed.up, size(gap.up));
    return {
      top: gap.down ? range(gap.down.start, d) : [],
      bottom: gap.up ? range(gap.up.end - u + 1, u) : [],
      hidden: size(gap.down) - d + size(gap.up) - u,
      down: d < size(gap.down),
      up: u < size(gap.up),
    };
  }
  // One region reached from both sides.
  const n = size(gap.down);
  const d = Math.min(revealed.down, n);
  const u = Math.min(revealed.up, n - d);
  const hidden = n - d - u;
  return {
    top: range(gap.down.start, d),
    bottom: range(gap.up.end - u + 1, u),
    hidden,
    down: hidden > 0,
    up: hidden > 0,
  };
}
