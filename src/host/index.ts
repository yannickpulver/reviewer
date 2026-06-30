import { runCommand, type Runner } from "../util/exec.js";
import { parseInput } from "./detect.js";
import { GitHubHost, githubRepoFromCwd } from "./github.js";
import { GitLabHost, projectPathFromRemote } from "./gitlab.js";
import type { Host, HostKind, PullState, Target } from "./types.js";

export type { Host, HostKind, PullMeta, ReviewComment, FetchResult } from "./types.js";

/** Lightweight open PR/MR entry for the picker. */
export interface PullSummary {
  id: number;
  title: string;
  author: string;
  state: PullState;
}

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

/** Resolve the host kind and repo path from the local origin remote. */
async function resolveRepoFromRemote(
  run: Runner,
): Promise<{ host: HostKind; repo: string }> {
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
    return { host, repo: ghQualify(hostnameFromRemote(remote), await githubRepoFromCwd(run)) };
  }
  if (host === "gitlab") {
    return { host, repo: projectPathFromRemote(remote) };
  }
  throw new Error(
    `Could not tell if "${remote}" is GitHub or GitLab. Pass a PR/MR URL instead.`,
  );
}

/** Build a Host for a known kind/id/repo (e.g. a pick from the open-PR list). */
export function hostForId(
  kind: HostKind,
  id: number,
  repo: string,
  run: Runner = runCommand,
): Host {
  return kind === "github"
    ? new GitHubHost(id, repo, run)
    : new GitLabHost(id, repo, run);
}

/** List open PRs/MRs for the repo of the current directory (no argument given). */
export async function listOpenPulls(
  run: Runner = runCommand,
): Promise<{ host: HostKind; repo: string; pulls: PullSummary[] }> {
  const { host, repo } = await resolveRepoFromRemote(run);
  const pulls =
    host === "github"
      ? await listGitHubPulls(repo, run)
      : await listGitLabPulls(repo, run);
  return { host, repo, pulls };
}

async function listGitHubPulls(repo: string, run: Runner): Promise<PullSummary[]> {
  const res = await run("gh", [
    "pr", "list", "--repo", repo, "--state", "open",
    "--json", "number,title,author,isDraft",
  ]);
  const raw = JSON.parse(res.stdout) as Array<{
    number: number;
    title: string;
    author: { login: string } | null;
    isDraft: boolean;
  }>;
  return raw.map((p) => ({
    id: p.number,
    title: p.title,
    author: p.author?.login ?? "unknown",
    state: p.isDraft ? "draft" : "open",
  }));
}

async function listGitLabPulls(repo: string, run: Runner): Promise<PullSummary[]> {
  const res = await run("glab", [
    "api",
    `projects/${encodeURIComponent(repo)}/merge_requests?state=opened&per_page=100`,
  ]);
  const raw = JSON.parse(res.stdout) as Array<{
    iid: number;
    title: string;
    author: { username: string } | null;
    draft?: boolean;
    work_in_progress?: boolean;
  }>;
  return raw.map((m) => ({
    id: m.iid,
    title: m.title,
    author: m.author?.username ?? "unknown",
    state: m.draft || m.work_in_progress ? "draft" : "open",
  }));
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
