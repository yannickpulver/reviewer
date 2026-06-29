import type { DiffFile } from "../diff/types.js";
import type { Grouping } from "../group/types.js";
import type { ExistingComment, PullMeta, ReviewAction, ReviewComment } from "../host/types.js";

/** Everything the UI needs to render a review. Sent by GET /api/review. */
export interface ReviewPayload {
  meta: PullMeta;
  files: DiffFile[];
  grouping: Grouping;
  /** Inline comments already on the PR/MR */
  existingComments: ExistingComment[];
}

/** Body of POST /api/review. */
export interface SubmitBody {
  comments: ReviewComment[];
  summary: string;
  action: ReviewAction;
}
