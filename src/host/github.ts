import type { Runner } from "../util/exec.js";
import type { FetchResult, Host, PullMeta, ReviewComment } from "./types.js";

interface GhView {
  number: number;
  title: string;
  author: { login: string } | null;
  url: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
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
      "--json", "number,title,author,url,baseRefName,headRefName,headRefOid",
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
    };
    return { meta, diffText: diff.stdout };
  }

  async postReview(comments: ReviewComment[], summary: string): Promise<{ url: string }> {
    const view = await this.run("gh", [
      "pr", "view", String(this.id), "--repo", this.repo, "--json", "headRefOid",
    ]);
    const headSha = (JSON.parse(view.stdout) as { headRefOid: string }).headRefOid;

    const body = {
      commit_id: headSha,
      body: summary,
      event: "COMMENT",
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
