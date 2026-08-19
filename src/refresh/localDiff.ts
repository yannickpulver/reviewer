import type { ExistingComment, Host, PullMeta } from "../host/types.js";
import { runCommand, type Runner } from "../util/exec.js";

/** Where a refreshed diff came from. */
export type RefreshSource = "local" | "remote";

export interface RefreshedDiff {
  diffText: string;
  source: RefreshSource;
  /** Commits in the local HEAD that aren't in `meta.headSha` (0 on the remote path). */
  ahead: number;
  /** Only set on the remote path, where comments are refetched alongside the diff. */
  comments?: ExistingComment[];
}

/**
 * Re-fetch the diff for an in-flight review, preferring the local worktree.
 *
 * When the worktree *is* the PR head (plus your own commits and uncommitted
 * edits) we diff locally, so fixes show up before they're pushed. Otherwise —
 * someone else's PR, or a different branch checked out — we fall back to the
 * host, which picks up commits pushed since the review started. Never throws
 * for "wrong branch": the remote path always works.
 */
export async function refreshDiff(
  host: Host,
  meta: PullMeta,
  run: Runner = runCommand,
): Promise<RefreshedDiff> {
  if (meta.host === "local") {
    const { diffText } = await host.fetch();
    return { diffText, source: "local", ahead: 0 };
  }

  const local = await localDiffForPull(meta, run);
  if (local) return local;

  const { diffText, comments } = await host.fetch();
  return { diffText, source: "remote", ahead: 0, comments };
}

/** Local diff for a PR/MR, or null when the worktree isn't that PR's head. */
async function localDiffForPull(meta: PullMeta, run: Runner): Promise<RefreshedDiff | null> {
  if (!(await worktreeIsPullHead(meta, run))) return null;

  const base = await resolveBase(meta.baseRef, run);
  if (!base) return null; // base branch not available locally — the host knows better

  const mergeBase = (await run("git", ["merge-base", base, "HEAD"])).stdout.trim();
  const { stdout: diffText } = await run("git", ["diff", mergeBase]);
  return { diffText, source: "local", ahead: await countAhead(meta.headSha, run) };
}

/**
 * True when the local HEAD contains the PR head commit — i.e. this worktree is
 * that branch, possibly with extra commits on top. Falls back to a branch-name
 * match, which covers an amended or rebased head whose old SHA is gone.
 */
async function worktreeIsPullHead(meta: PullMeta, run: Runner): Promise<boolean> {
  if (meta.headSha) {
    try {
      await run("git", ["merge-base", "--is-ancestor", meta.headSha, "HEAD"]);
      return true;
    } catch {
      /* not an ancestor, or the commit isn't here — try the branch name */
    }
  }
  try {
    const head = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    return head !== "HEAD" && head === meta.headRef;
  } catch {
    return false;
  }
}

/** Prefer the remote-tracking base (`origin/main`) over a possibly stale local one. */
async function resolveBase(baseRef: string, run: Runner): Promise<string | null> {
  for (const ref of [`origin/${baseRef}`, baseRef]) {
    try {
      await run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function countAhead(headSha: string, run: Runner): Promise<number> {
  if (!headSha) return 0;
  try {
    const { stdout } = await run("git", ["rev-list", "--count", `${headSha}..HEAD`]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0; // headSha unknown locally (amended/rebased) — don't guess
  }
}
