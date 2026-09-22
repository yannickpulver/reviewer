import type { DiffFile, Hunk, LineMap, LineType, ResolvedHunk, ReviewComment } from "@/types";

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
