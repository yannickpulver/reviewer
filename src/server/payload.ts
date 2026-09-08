import type { DiffFile } from "../diff/types.js";
import type { Grouping } from "../group/types.js";
import type {
  DiffScope,
  ExistingComment,
  PullMeta,
  ReviewAction,
  ReviewComment,
} from "../host/types.js";
import type { RefreshSource } from "../refresh/localDiff.js";
import type { LineMap } from "../refresh/remap.js";

/** Everything the UI needs to render a review. Sent by GET /api/review. */
export interface ReviewPayload {
  meta: PullMeta;
  files: DiffFile[];
  grouping: Grouping;
  /** Inline comments already on the PR/MR */
  existingComments: ExistingComment[];
  /** Whether the diff covers the whole PR/MR or just the changes since the reviewer's last review. */
  diffScope: DiffScope;
  /** Whether the host supports POST /api/react. */
  reactionsSupported: boolean;
  /** True when the architect review was started alongside grouping (--architect). */
  architectStarted?: boolean;
  /** True while `grouping` is only a fallback and the real one is still being computed. */
  groupingPending?: boolean;
  /** Bumped on every refresh; 0 for the original review. */
  rev: number;
  /** Result of the most recent refresh, if any. */
  refresh?: RefreshSummary;
}

/** What a refresh changed, relative to the review it replaced. */
export interface RefreshSummary {
  /** Whether the refreshed diff came from the local worktree or the host. */
  source: RefreshSource;
  /** Local commits not yet in the PR/MR head — inline comments can't be posted while > 0. */
  ahead: number;
  hunksUnchanged: number;
  hunksChanged: number;
  hunksNew: number;
  /** Architect findings whose line is gone — likely fixed. */
  findingsStale: number;
  /** Existing PR/MR comments that no longer anchor to a diff line. */
  existingDetached: number;
}

/** Response of POST /api/refresh. */
export interface RefreshResponse {
  payload: ReviewPayload;
  /** Lets the UI move its drafted comments onto the refreshed diff. */
  lineMap: LineMap;
  summary: RefreshSummary;
}

/** Body of POST /api/react. */
export interface ReactBody {
  commentId: string;
  content: string;
  remove: boolean;
}

/** Body of POST /api/review. */
export interface SubmitBody {
  comments: ReviewComment[];
  summary: string;
  action: ReviewAction;
}

export type BuildStep = "fetching";

/** Progress reported by GET /api/review while the pipeline is still running. */
export interface BuildingState {
  status: "building";
  step: BuildStep;
}

export interface ReviewErrorState {
  status: "error";
  message: string;
}

export interface ReadyState extends ReviewPayload {
  status: "ready";
}

/** Response shape of GET /api/review. */
export type ReviewApiResponse = BuildingState | ReviewErrorState | ReadyState;
