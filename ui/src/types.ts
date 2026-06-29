// Mirror of the server payload (src/server/payload.ts). Keep in sync.

export type LineType = "context" | "add" | "del";
export type Importance = "high" | "medium" | "low";
export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffLine {
  type: LineType;
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface Hunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
}

export interface Group {
  title: string;
  importance: Importance;
  summary: string;
  hunks: string[];
}

export interface Grouping {
  groups: Group[];
  ungrouped: string[];
}

export interface PullMeta {
  host: "github" | "gitlab";
  id: number;
  title: string;
  author: string;
  url: string;
  baseRef: string;
  headRef: string;
  headSha: string;
}

export interface ReviewPayload {
  meta: PullMeta;
  files: DiffFile[];
  grouping: Grouping;
  existingComments: ExistingComment[];
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export type ReviewAction = "comment" | "approve" | "request_changes";

export interface ExistingComment {
  path: string;
  line: number;
  author: string;
  body: string;
}

/** A resolved hunk with its owning file path, keyed by "path:Hn". */
export interface ResolvedHunk {
  ref: string;
  path: string;
  hunk: Hunk;
}
