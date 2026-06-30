import type { DiffFile, Hunk, LineType, ResolvedHunk } from "@/types";

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

/** Render a hunk back to unified-diff text for use as model context. */
export function hunkToText(hunk: Hunk): string {
  const sign = (t: LineType) => (t === "add" ? "+" : t === "del" ? "-" : " ");
  const body = hunk.lines.map((l) => sign(l.type) + l.content).join("\n");
  return `${hunk.header}\n${body}`;
}
