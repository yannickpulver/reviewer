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

const GH_EVENT: Record<ReviewAction, string> = {
  comment: "COMMENT",
  approve: "APPROVE",
  request_changes: "REQUEST_CHANGES",
};

/** Map gh's state (OPEN/CLOSED/MERGED) + draft flag to a normalized state. */
function ghState(v: { state: string; isDraft: boolean }): PullState {
  const s = (v.state ?? "").toUpperCase();
  if (s === "MERGED") return "merged";
  if (s === "CLOSED") return "closed";
  return v.isDraft ? "draft" : "open";
}

interface GhView {
  number: number;
  title: string;
  author: { login: string } | null;
  url: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  state: string;
  isDraft: boolean;
}

export class GitHubHost implements Host {
  readonly kind = "github" as const;

  /** Enterprise host, if any (e.g. "acme.ghe.com"); undefined for github.com. */
  private readonly apiHost: string | undefined;
  /** "owner/repo" without host, for `gh api` paths. */
  private readonly ownerRepo: string;

  constructor(
    private readonly id: number,
    /** [host/]owner/repo — host present for Enterprise */
    private readonly repo: string,
    private readonly run: Runner,
  ) {
    const segs = repo.split("/");
    if (segs.length > 2 || (segs[0] && segs[0].includes("."))) {
      this.apiHost = segs[0];
      this.ownerRepo = segs.slice(1).join("/");
    } else {
      this.apiHost = undefined;
      this.ownerRepo = repo;
    }
  }

  /** Args to target the right host for `gh api`. */
  private hostArgs(): string[] {
    return this.apiHost ? ["--hostname", this.apiHost] : [];
  }

  async fetch(): Promise<FetchResult> {
    const view = await this.run("gh", [
      "pr", "view", String(this.id),
      "--repo", this.repo,
      "--json", "number,title,author,url,baseRefName,headRefName,headRefOid,state,isDraft",
    ]);
    const v = JSON.parse(view.stdout) as GhView;

    const diff = await this.run("gh", ["pr", "diff", String(this.id), "--repo", this.repo]);

    const meta: PullMeta = {
      host: "github",
      id: v.number,
      title: v.title,
      author: v.author?.login ?? "unknown",
      url: v.url,
      baseRef: v.baseRefName,
      headRef: v.headRefName,
      headSha: v.headRefOid,
      state: ghState(v),
    };
    return { meta, diffText: diff.stdout, comments: await this.fetchComments() };
  }

  private async fetchComments(): Promise<ExistingComment[]> {
    try {
      const res = await this.run("gh", [
        "api", ...this.hostArgs(), "--paginate",
        `repos/${this.ownerRepo}/pulls/${this.id}/comments`,
      ]);
      const raw = JSON.parse(res.stdout) as Array<{
        path: string;
        line: number | null;
        original_line: number | null;
        side: string | null;
        user: { login: string } | null;
        body: string;
      }>;
      return raw
        .filter((c) => c.side !== "LEFT")
        .map((c) => ({
          path: c.path,
          line: c.line ?? c.original_line ?? 0,
          author: c.user?.login ?? "unknown",
          body: c.body,
        }))
        .filter((c) => c.line > 0);
    } catch {
      return []; // comments are best-effort; never block the review
    }
  }

  async postReview(
    comments: ReviewComment[],
    summary: string,
    action: ReviewAction,
  ): Promise<{ url: string }> {
    const view = await this.run("gh", [
      "pr", "view", String(this.id), "--repo", this.repo, "--json", "headRefOid",
    ]);
    const headSha = (JSON.parse(view.stdout) as { headRefOid: string }).headRefOid;

    const body = {
      commit_id: headSha,
      body: summary,
      event: GH_EVENT[action],
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: "RIGHT",
        body: c.body,
      })),
    };

    const res = await this.run(
      "gh",
      [
        "api",
        ...this.hostArgs(),
        "--method", "POST",
        `repos/${this.ownerRepo}/pulls/${this.id}/reviews`,
        "--input", "-",
      ],
      JSON.stringify(body),
    );
    const out = JSON.parse(res.stdout) as { html_url?: string };
    const base = `https://${this.apiHost ?? "github.com"}`;
    return { url: out.html_url ?? `${base}/${this.ownerRepo}/pull/${this.id}` };
  }
}

/** Resolve owner/repo for the current directory via gh. */
export async function githubRepoFromCwd(run: Runner): Promise<string> {
  const res = await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return res.stdout.trim();
}
