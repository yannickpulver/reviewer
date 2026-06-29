import type { Runner } from "../util/exec.js";
import type { FetchResult, Host, PullMeta, ReviewComment } from "./types.js";

interface GlabMr {
  iid: number;
  title: string;
  author: { username: string } | null;
  web_url: string;
  source_branch: string;
  target_branch: string;
  sha: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string } | null;
}

export class GitLabHost implements Host {
  readonly kind = "gitlab" as const;

  constructor(
    private readonly id: number,
    /** full project path, e.g. group/sub/repo */
    private readonly repo: string,
    private readonly run: Runner,
  ) {}

  private get projectPath(): string {
    return encodeURIComponent(this.repo);
  }

  private async fetchMr(): Promise<GlabMr> {
    const res = await this.run("glab", [
      "api",
      `projects/${this.projectPath}/merge_requests/${this.id}`,
    ]);
    return JSON.parse(res.stdout) as GlabMr;
  }

  async fetch(): Promise<FetchResult> {
    const mr = await this.fetchMr();
    const diff = await this.run("glab", ["mr", "diff", String(this.id), "-R", this.repo]);

    const meta: PullMeta = {
      host: "gitlab",
      id: mr.iid,
      title: mr.title,
      author: mr.author?.username ?? "unknown",
      url: mr.web_url,
      baseRef: mr.target_branch,
      headRef: mr.source_branch,
      headSha: mr.diff_refs?.head_sha ?? mr.sha,
    };
    return { meta, diffText: diff.stdout };
  }

  async postReview(comments: ReviewComment[], summary: string): Promise<{ url: string }> {
    const mr = await this.fetchMr();
    const refs = mr.diff_refs;
    if (!refs) throw new Error("GitLab MR has no diff_refs; cannot anchor inline comments.");

    const base = `projects/${this.projectPath}/merge_requests/${this.id}`;

    for (const c of comments) {
      await this.run("glab", [
        "api", "--method", "POST", `${base}/discussions`,
        "-f", `body=${c.body}`,
        "-f", "position[position_type]=text",
        "-f", `position[base_sha]=${refs.base_sha}`,
        "-f", `position[head_sha]=${refs.head_sha}`,
        "-f", `position[start_sha]=${refs.start_sha}`,
        "-f", `position[new_path]=${c.path}`,
        "-f", `position[new_line]=${c.line}`,
      ]);
    }

    if (summary.trim()) {
      await this.run("glab", [
        "api", "--method", "POST", `${base}/notes`, "-f", `body=${summary}`,
      ]);
    }

    return { url: mr.web_url };
  }
}

/** Resolve the full project path for the current directory from the origin remote. */
export async function gitlabRepoFromCwd(run: Runner): Promise<string> {
  const remote = await run("git", ["remote", "get-url", "origin"]);
  return projectPathFromRemote(remote.stdout.trim());
}

export function projectPathFromRemote(remote: string): string {
  // git@gitlab.com:group/sub/repo.git  or  https://gitlab.com/group/sub/repo.git
  const cleaned = remote.replace(/\.git$/, "");
  const ssh = cleaned.match(/^[^@]+@[^:]+:(.+)$/);
  if (ssh) return ssh[1]!;
  try {
    const u = new URL(cleaned);
    return u.pathname.replace(/^\//, "");
  } catch {
    return cleaned;
  }
}
