import { runCommand, type Runner } from "../util/exec.js";
import { parseInput } from "./detect.js";
import { GitHubHost, githubRepoFromCwd } from "./github.js";
import { GitLabHost, projectPathFromRemote } from "./gitlab.js";
import type { Host, HostKind, Target } from "./types.js";

export type { Host, HostKind, PullMeta, ReviewComment, FetchResult } from "./types.js";

/** Resolve a Host implementation from a CLI argument (PR/MR number or URL). */
export async function resolveHost(input: string, run: Runner = runCommand): Promise<Host> {
  const parsed = parseInput(input);

  if (parsed.kind === "url") {
    return makeHost(parsed.target, run);
  }

  // Bare number: detect host from the local origin remote.
  let remote: string;
  try {
    remote = (await run("git", ["remote", "get-url", "origin"])).stdout.trim();
  } catch {
    throw new Error(
      "No git origin remote found. Run inside the repo, or pass a full PR/MR URL.",
    );
  }
  const host = await detectHostFromRemote(remote, run);
  if (host === "github") {
    const repo = ghQualify(hostnameFromRemote(remote), await githubRepoFromCwd(run));
    return new GitHubHost(parsed.id, repo, run);
  }
  if (host === "gitlab") {
    return new GitLabHost(parsed.id, projectPathFromRemote(remote), run);
  }
  throw new Error(
    `Could not tell if "${remote}" is GitHub or GitLab. Pass a full PR/MR URL instead.`,
  );
}

/** Resolve the open PR/MR for the current branch (no argument given). */
export async function resolveCurrentBranchHost(run: Runner = runCommand): Promise<Host> {
  let remote: string;
  try {
    remote = (await run("git", ["remote", "get-url", "origin"])).stdout.trim();
  } catch {
    throw new Error(
      "No git origin remote found. Run inside the repo, or pass a PR/MR number or URL.",
    );
  }
  const host = await detectHostFromRemote(remote, run);

  if (host === "github") {
    const repo = ghQualify(hostnameFromRemote(remote), await githubRepoFromCwd(run));
    let id: number;
    try {
      const res = await run("gh", ["pr", "view", "--json", "number", "--jq", ".number"]);
      id = Number(res.stdout.trim());
    } catch {
      throw new Error("No open PR found for the current branch.");
    }
    if (!id) throw new Error("No open PR found for the current branch.");
    return new GitHubHost(id, repo, run);
  }

  if (host === "gitlab") {
    const repo = projectPathFromRemote(remote);
    const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    const res = await run("glab", [
      "api",
      `projects/${encodeURIComponent(repo)}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened`,
    ]);
    const list = JSON.parse(res.stdout) as Array<{ iid: number }>;
    if (!list.length) throw new Error(`No open MR found for branch "${branch}".`);
    return new GitLabHost(list[0]!.iid, repo, run);
  }

  throw new Error(
    `Could not tell if "${remote}" is GitHub or GitLab. Pass a PR/MR URL instead.`,
  );
}

function makeHost(target: Target, run: Runner): Host {
  if (!target.repo) throw new Error("Internal: URL target missing repo path.");
  return target.host === "github"
    ? new GitHubHost(target.id, target.repo, run)
    : new GitLabHost(target.id, target.repo, run);
}

/**
 * Detect whether a remote points at GitHub or GitLab. Uses hostname heuristics
 * (incl. GitHub Enterprise `.ghe.com` / `github.*` and self-hosted `gitlab.*`),
 * then falls back to probing the authenticated `gh`/`glab` CLIs for fully custom
 * Enterprise domains (e.g. `git.company.com`).
 */
export async function detectHostFromRemote(
  remote: string,
  run: Runner,
): Promise<HostKind | null> {
  const name = hostnameFromRemote(remote).toLowerCase();
  if (!name) return null;

  if (name.includes("gitlab")) return "gitlab";
  if (
    name === "github.com" ||
    name.includes("github") ||
    name.endsWith(".ghe.com") ||
    name.includes(".ghe.")
  ) {
    return "github";
  }

  // Custom Enterprise domain: ask the authenticated CLIs which one owns this host.
  if (await cliKnowsHost("gh", run, name)) return "github";
  if (await cliKnowsHost("glab", run, name)) return "gitlab";
  return null;
}

async function cliKnowsHost(cli: "gh" | "glab", run: Runner, name: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await run(cli, ["auth", "status"]);
    return `${stdout}\n${stderr}`.toLowerCase().includes(name);
  } catch {
    return false;
  }
}

/** Qualify a GitHub repo ref with its host for non-public (Enterprise) hosts. */
function ghQualify(host: string, nameWithOwner: string): string {
  return host && host.toLowerCase() !== "github.com"
    ? `${host}/${nameWithOwner}`
    : nameWithOwner;
}

/** Extract the hostname from an scp-style (`user@host:path`) or URL remote. */
function hostnameFromRemote(remote: string): string {
  const scp = remote.match(/^[^@/]+@([^:/]+):/);
  if (scp) return scp[1]!;
  try {
    return new URL(remote).hostname;
  } catch {
    const bare = remote.match(/^([^:/]+):/);
    return bare ? bare[1]! : "";
  }
}
