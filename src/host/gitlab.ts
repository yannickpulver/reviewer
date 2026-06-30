import type { Runner } from "../util/exec.js";
import type {
  ExistingComment,
  FetchResult,
  Host,
  PullMeta,
  PullState,
  ReviewAction,
  ReviewComment,
} from "./types.js";

interface GlabMr {
  iid: number;
  title: string;
  author: { username: string } | null;
  web_url: string;
  source_branch: string;
  target_branch: string;
  sha: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string } | null;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
}

/** Map GitLab's state (opened/closed/merged/locked) + draft flag to a normalized state. */
function glState(mr: GlabMr): PullState {
  if (mr.state === "merged") return "merged";
  if (mr.state === "closed" || mr.state === "locked") return "closed";
  return mr.draft || mr.work_in_progress ? "draft" : "open";
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
      state: glState(mr),
    };
    return { meta, diffText: diff.stdout, comments: await this.fetchComments() };
  }

  private async fetchComments(): Promise<ExistingComment[]> {
    try {
      const res = await this.run("glab", [
        "api", "--paginate",
        `projects/${this.projectPath}/merge_requests/${this.id}/discussions`,
      ]);
      const discussions = JSON.parse(res.stdout) as Array<{
        notes: Array<{
          system: boolean;
          body: string;
          author: { username: string } | null;
          position: { new_path: string; new_line: number | null } | null;
        }>;
      }>;
      const out: ExistingComment[] = [];
      for (const d of discussions) {
        for (const n of d.notes ?? []) {
          if (n.system || !n.position || !n.position.new_line) continue;
          out.push({
            path: n.position.new_path,
            line: n.position.new_line,
            author: n.author?.username ?? "unknown",
            body: n.body,
          });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async postReview(
    comments: ReviewComment[],
    summary: string,
    action: ReviewAction,
  ): Promise<{ url: string }> {
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

    // GitLab has no single "review event": approve/unapprove are separate endpoints.
    if (action === "approve") {
      await this.run("glab", ["api", "--method", "POST", `${base}/approve`]);
    } else if (action === "request_changes") {
      // Closest analog: remove any existing approval (best-effort).
      await this.run("glab", ["api", "--method", "POST", `${base}/unapprove`]).catch(() => {});
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
