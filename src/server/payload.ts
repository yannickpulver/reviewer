import type { DiffFile } from "../diff/types.js";
import type { Grouping } from "../group/types.js";
import type {
  DiffScope,
  ExistingComment,
  PullMeta,
  ReviewAction,
  ReviewComment,
} from "../host/types.js";

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

export type BuildStep = "fetching" | "grouping";

/** Progress reported by GET /api/review while the pipeline is still running. */
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

/** Response shape of GET /api/review. */
export type ReviewApiResponse = BuildingState | ReviewErrorState | ReadyState;
