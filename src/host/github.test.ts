import { describe, it, expect } from "vitest";
import { GitHubHost } from "./github.js";
import type { Runner } from "../util/exec.js";

function recorder(responses: Record<string, string>) {
  const calls: string[][] = [];
  const inputs: (string | undefined)[] = [];
  const run: Runner = async (cmd, args, input) => {
    calls.push([cmd, ...args]);
    inputs.push(input);
    const key = Object.keys(responses).find((k) => args.join(" ").includes(k));
    return { stdout: key ? responses[key]! : "", stderr: "" };
  };
  return { run, calls, inputs };
}

describe("GitHubHost on Enterprise", () => {
  it("uses --repo with host for pr commands and --hostname for api", async () => {
    const { run, calls, inputs } = recorder({
      "pr view": JSON.stringify({ headRefOid: "deadbeef" }),
      "pulls/1481/reviews": JSON.stringify({ html_url: "https://acme.ghe.com/acme/widgets/pull/1481" }),
    });
    const host = new GitHubHost(1481, "acme.ghe.com/acme/widgets", run);

    const res = await host.postReview([{ path: "a.ts", line: 3, body: "nit" }], "summary", "approve");
    expect(res.url).toContain("acme.ghe.com");

    // the review event maps from the action
    const apiInput = inputs[calls.findIndex((c) => c.includes("api"))]!;
    expect(JSON.parse(apiInput).event).toBe("APPROVE");

    const prView = calls.find((c) => c.includes("view"))!;
    expect(prView).toContain("--repo");
    expect(prView).toContain("acme.ghe.com/acme/widgets");

    const api = calls.find((c) => c.includes("api"))!;
    expect(api).toContain("--hostname");
    expect(api).toContain("acme.ghe.com");
    expect(api).toContain("repos/acme/widgets/pulls/1481/reviews");
    expect(api.some((a) => a.startsWith("acme.ghe.com/"))).toBe(false);
  });

  it("parses comment ids and reactions from reviewThreads", async () => {
    const { run } = recorder({
      "pr view": JSON.stringify({
        number: 7, title: "t", author: { login: "a" }, url: "u",
        baseRefName: "main", headRefName: "f", headRefOid: "sha",
        state: "OPEN", isDraft: false,
      }),
      graphql: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    isResolved: false,
                    comments: {
                      nodes: [
                        {
                          id: "C_1",
                          path: "a.ts",
                          line: 3,
                          originalLine: null,
                          author: { login: "bob" },
                          body: "nit",
                          reactionGroups: [
                            { content: "THUMBS_UP", viewerHasReacted: true, reactions: { totalCount: 2 } },
                            { content: "EYES", viewerHasReacted: false, reactions: { totalCount: 0 } },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    });
    const host = new GitHubHost(7, "org/repo", run);
    const { comments } = await host.fetch();
    expect(comments).toEqual([
      {
        id: "C_1",
        path: "a.ts",
        line: 3,
        author: "bob",
        body: "nit",
        resolved: false,
        reactions: [{ content: "+1", count: 2, viewerReacted: true }],
      },
    ]);
  });

  it("toggleReaction runs add/remove mutations and returns fresh reactions", async () => {
    const { run, calls } = recorder({
      graphql: JSON.stringify({
        data: {
          addReaction: {
            subject: {
              reactionGroups: [
                { content: "ROCKET", viewerHasReacted: true, reactions: { totalCount: 1 } },
              ],
            },
          },
        },
      }),
    });
    const host = new GitHubHost(7, "acme.ghe.com/org/repo", run);
    const reactions = await host.toggleReaction("C_1", "rocket", false);
    expect(reactions).toEqual([{ content: "rocket", count: 1, viewerReacted: true }]);

    const call = calls[0]!;
    expect(call).toContain("--hostname");
    expect(call).toContain("id=C_1");
    expect(call).toContain("content=ROCKET");
    expect(call.some((a) => a.includes("addReaction"))).toBe(true);
  });

  it("toggleReaction uses removeReaction when removing", async () => {
    const { run, calls } = recorder({
      graphql: JSON.stringify({ data: { removeReaction: { subject: { reactionGroups: [] } } } }),
    });
    const host = new GitHubHost(7, "org/repo", run);
    expect(await host.toggleReaction("C_1", "+1", true)).toEqual([]);
    const call = calls[0]!;
    expect(call.some((a) => a.includes("removeReaction"))).toBe(true);
    expect(call).toContain("content=THUMBS_UP");
  });

  it("omits --hostname for public github.com", async () => {
    const { run, calls } = recorder({
      "pr view": JSON.stringify({ headRefOid: "x" }),
      reviews: JSON.stringify({ html_url: "https://github.com/org/repo/pull/7" }),
    });
    const host = new GitHubHost(7, "org/repo", run);
    await host.postReview([], "", "comment");
    const api = calls.find((c) => c.includes("api"))!;
    expect(api).not.toContain("--hostname");
    expect(api).toContain("repos/org/repo/pulls/7/reviews");
  });
});
