export type HostKind = "github" | "gitlab" | "local";

/** Normalized PR/MR lifecycle state. */
export type PullState = "open" | "draft" | "merged" | "closed";

export interface PullMeta {
  host: HostKind;
  /** PR number (GitHub) or MR iid (GitLab) */
  id: number;
  title: string;
  author: string;
  url: string;
  baseRef: string;
  headRef: string;
  /** Head commit SHA — needed to anchor inline comments */
  headSha: string;
  state: PullState;
}

/** A drafted inline comment, anchored to a line in the new (right) side of the diff. */
export interface ReviewComment {
  path: string;
  /** 1-based line number in the new file */
  line: number;
  body: string;
}

/** The verdict attached to a submitted review. */
export type ReviewAction = "comment" | "approve" | "request_changes";

/** An existing inline comment already on the PR/MR, anchored to a new-side line. */
export interface ExistingComment {
  path: string;
  /** 1-based line in the new file */
  line: number;
  author: string;
  body: string;
  /** Whether the review thread this comment belongs to is resolved. */
  resolved: boolean;
}

/** Whether the fetched diff covers the whole PR/MR or just the changes since the reviewer's last review. */
export type DiffScope = "full" | "since-last-review";

export interface FetchResult {
  meta: PullMeta;
  /** Raw unified diff text */
  diffText: string;
  /** Inline comments already left by reviewers */
  comments: ExistingComment[];
  diffScope: DiffScope;
}

export interface Host {
  kind: HostKind;
  fetch(opts?: { sinceLastReview?: boolean }): Promise<FetchResult>;
  postReview(
    comments: ReviewComment[],
    summary: string,
    action: ReviewAction,
  ): Promise<{ url: string }>;
  /** The current user's most recent submitted review (GitHub only), or null/undefined if unsupported/none. */
  getLastReview?(): Promise<{ sha: string; submittedAt: string } | null>;
}

/** Where the PR/MR lives, resolved from a URL or the local repo remote. */
export interface Target {
  host: HostKind;
  id: number;
  /** owner/repo (GitHub) or full project path (GitLab), if known from a URL */
  repo?: string;
}
