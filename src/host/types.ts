export type HostKind = "github" | "gitlab";

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
}

/** A drafted inline comment, anchored to a line in the new (right) side of the diff. */
export interface ReviewComment {
  path: string;
  /** 1-based line number in the new file */
  line: number;
  body: string;
}

export interface FetchResult {
  meta: PullMeta;
  /** Raw unified diff text */
  diffText: string;
}

export interface Host {
  kind: HostKind;
  fetch(): Promise<FetchResult>;
  postReview(comments: ReviewComment[], summary: string): Promise<{ url: string }>;
}

/** Where the PR/MR lives, resolved from a URL or the local repo remote. */
export interface Target {
  host: HostKind;
  id: number;
  /** owner/repo (GitHub) or full project path (GitLab), if known from a URL */
  repo?: string;
}
