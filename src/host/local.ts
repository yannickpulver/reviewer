import type { Runner } from "../util/exec.js";
import type { FetchResult, Host, PullMeta, ReviewComment, ReviewAction } from "./types.js";

/**
 * Reviews the current git branch before it's a PR/MR: diffs the merge-base
 * with its base branch against the working tree, so committed branch changes
 * and open (uncommitted, tracked) edits both show up. There's no remote review
 * to post to, so `postReview` throws.
 */
export class LocalHost implements Host {
  readonly kind = "local" as const;

  constructor(
    /** Base ref to diff against, e.g. "origin/main" or "main". */
    private readonly base: string,
    private readonly run: Runner,
  ) {}

  async fetch(): Promise<FetchResult> {
    const headRef = (await this.run("git", ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    const headSha = (await this.run("git", ["rev-parse", "HEAD"])).stdout.trim();
    const mergeBase = (await this.run("git", ["merge-base", this.base, "HEAD"])).stdout.trim();
    // merge-base → working tree: branch commits plus any uncommitted edits.
    const diff = await this.run("git", ["diff", mergeBase]);
    const author = (
      await this.run("git", ["config", "user.name"]).catch(() => ({ stdout: "", stderr: "" }))
    ).stdout.trim();

    const meta: PullMeta = {
      host: "local",
      id: 0,
      title: headRef,
      author: author || "you",
      url: "",
      baseRef: this.base,
      headRef,
      headSha,
      state: "open",
    };
    return { meta, diffText: diff.stdout, comments: [] };
  }

  async postReview(
    _comments: ReviewComment[],
    _summary: string,
    _action: ReviewAction,
  ): Promise<{ url: string }> {
    throw new Error("Local branch review — there's no PR/MR to submit comments to.");
  }
}

/** Pick a sensible base branch to diff the current branch against. */
export async function defaultBase(run: Runner): Promise<string> {
  try {
    const head = (
      await run("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
    ).stdout.trim();
    if (head) return head.replace(/^refs\/remotes\//, ""); // e.g. "origin/main"
  } catch {
    /* no origin/HEAD; fall back to well-known local branches */
  }
  for (const ref of ["main", "master"]) {
    try {
      await run("git", ["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      /* try next */
    }
  }
  throw new Error("Could not determine a base branch to diff against. Pass --base <ref>.");
}
