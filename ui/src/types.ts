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

export type FlagSeverity = "warning" | "danger";

export interface Flag {
  hunk: string;
  severity: FlagSeverity;
  note: string;
}

export interface Group {
  title: string;
  importance: Importance;
  summary: string;
  hunks: string[];
  flags: Flag[];
}

export interface Grouping {
  groups: Group[];
  ungrouped: string[];
}

export type PullState = "open" | "draft" | "merged" | "closed";

export interface PullMeta {
  host: "github" | "gitlab" | "local";
  id: number;
  title: string;
  author: string;
  url: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  state: PullState;
}

export type DiffScope = "full" | "since-last-review";

export interface ReviewPayload {
  meta: PullMeta;
  files: DiffFile[];
  grouping: Grouping;
  existingComments: ExistingComment[];
  diffScope: DiffScope;
  architectStarted?: boolean;
}

export type BuildStep = "fetching" | "grouping";

export interface BuildingState {
  status: "building";
  step: BuildStep;
  batch?: number;
  batches?: number;
}

export interface ReviewErrorState {
  status: "error";
  message: string;
}

export interface ReadyState extends ReviewPayload {
  status: "ready";
}

export type ReviewApiResponse = BuildingState | ReviewErrorState | ReadyState;

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
  resolved: boolean;
}

/** A resolved hunk with its owning file path, keyed by "path:Hn". */
export interface ResolvedHunk {
  ref: string;
  path: string;
  hunk: Hunk;
}

export type ArchitectSeverity = "important" | "design" | "nit" | "pre-existing";

export interface ArchitectFinding {
  path: string;
  /** New-file line number */
  line: number;
  severity: ArchitectSeverity;
  comment: string;
  fix?: string;
  /** Whether path+line was validated against the parsed diff server-side */
  anchored: boolean;
}

export interface ArchitectReview {
  verdict: "clean" | "issues";
  summary: string;
  findings: ArchitectFinding[];
}
