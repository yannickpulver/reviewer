import type { Runner } from "../util/exec.js";
import { currentLogin } from "./index.js";
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

  async fetch(opts?: { sinceLastReview?: boolean }): Promise<FetchResult> {
    const view = await this.run("gh", [
      "pr", "view", String(this.id),
      "--repo", this.repo,
      "--json", "number,title,author,url,baseRefName,headRefName,headRefOid,state,isDraft",
    ]);
    const v = JSON.parse(view.stdout) as GhView;

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

    let diffText: string | undefined;
    let diffScope: FetchResult["diffScope"] = "full";
    if (opts?.sinceLastReview) {
      const last = await this.getLastReview();
      if (last) {
        try {
          const compare = await this.run("gh", [
            "api", ...this.hostArgs(),
            "-H", "Accept: application/vnd.github.v3.diff",
            `repos/${this.ownerRepo}/compare/${last.sha}...${meta.headSha}`,
          ]);
          diffText = compare.stdout;
          diffScope = "since-last-review";
        } catch (e) {
          console.error(
            `  (could not fetch the diff since your last review: ${(e as Error).message}) — falling back to the full diff.`,
          );
        }
      } else {
        console.error("  (no previous review found) — showing the full diff.");
      }
    }
    if (diffText === undefined) {
      diffText = (await this.run("gh", ["pr", "diff", String(this.id), "--repo", this.repo])).stdout;
    }

    return { meta, diffText, comments: await this.fetchComments(), diffScope };
  }

  /** The current user's latest submitted (non-pending) review, or null if none/unavailable. */
  async getLastReview(): Promise<{ sha: string; submittedAt: string } | null> {
    const me = await currentLogin("gh", ["api", "user", "--jq", ".login", ...this.hostArgs()], this.run);
    if (!me) return null;
    try {
      const res = await this.run("gh", [
        "api", ...this.hostArgs(), "--paginate",
        `repos/${this.ownerRepo}/pulls/${this.id}/reviews`,
      ]);
      const reviews = JSON.parse(res.stdout) as Array<{
        user: { login: string } | null;
        state: string;
        commit_id: string;
        submitted_at: string | null;
      }>;
      const mine = reviews.filter(
        (r) => r.user?.login === me && r.state !== "PENDING" && r.submitted_at,
      );
      if (!mine.length) return null;
      mine.sort(
        (a, b) => new Date(b.submitted_at!).getTime() - new Date(a.submitted_at!).getTime(),
      );
      return { sha: mine[0]!.commit_id, submittedAt: mine[0]!.submitted_at! };
    } catch {
      return null;
    }
  }

  private async fetchComments(): Promise<ExistingComment[]> {
    const [owner, repo] = this.ownerRepo.split("/");
    const query = `
      query($owner:String!,$repo:String!,$num:Int!){
        repository(owner:$owner,name:$repo){
          pullRequest(number:$num){
            reviewThreads(first:100){
              nodes{
                isResolved
                comments(first:100){
                  nodes{ path line originalLine author{login} body }
                }
              }
            }
          }
        }
      }`;
    try {
      const res = await this.run("gh", [
        "api", ...this.hostArgs(), "graphql",
        "-f", `query=${query}`,
        "-F", `owner=${owner}`,
        "-F", `repo=${repo}`,
        "-F", `num=${this.id}`,
      ]);
      const parsed = JSON.parse(res.stdout) as {
        data?: {
          repository?: {
            pullRequest?: {
              reviewThreads?: {
                nodes: Array<{
                  isResolved: boolean;
                  comments: {
                    nodes: Array<{
                      path: string;
                      line: number | null;
                      originalLine: number | null;
                      author: { login: string } | null;
                      body: string;
                    }>;
                  };
                }>;
              };
            };
          };
        };
      };
      const threads = parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
      const out: ExistingComment[] = [];
      for (const t of threads) {
        for (const c of t.comments.nodes) {
          const line = c.line ?? c.originalLine ?? 0;
          if (line <= 0) continue;
          out.push({
            path: c.path,
            line,
            author: c.author?.login ?? "unknown",
            body: c.body,
            resolved: t.isResolved,
          });
        }
      }
      return out;
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
