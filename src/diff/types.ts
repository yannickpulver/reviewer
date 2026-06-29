export type LineType = "context" | "add" | "del";

export interface DiffLine {
  type: LineType;
  content: string;
  /** 1-based line number in the old file; null for added lines */
  oldLineNo: number | null;
  /** 1-based line number in the new file; null for deleted lines */
  newLineNo: number | null;
}

export interface Hunk {
  /** Stable id within its file: "H0", "H1", ... */
  id: string;
  /** Raw "@@ -a,b +c,d @@ ..." header line */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  /** Path in the new tree (or old path for deletions) */
  path: string;
  /** Previous path; differs from path only on rename */
  oldPath: string;
  status: FileStatus;
  /** True for binary files (no textual hunks) */
  binary: boolean;
  hunks: Hunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
}

/** A reference into the parsed model, e.g. "src/auth.ts:H1". */
export type HunkRef = string;

export function makeHunkRef(filePath: string, hunkId: string): HunkRef {
  return `${filePath}:${hunkId}`;
}

export function parseHunkRef(ref: HunkRef): { path: string; hunkId: string } | null {
  const idx = ref.lastIndexOf(":");
  if (idx <= 0 || idx === ref.length - 1) return null;
  return { path: ref.slice(0, idx), hunkId: ref.slice(idx + 1) };
}
