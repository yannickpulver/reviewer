import { describe, it, expect } from "vitest";
import { GitHubHost } from "./github.js";
import type { Runner } from "../util/exec.js";

function recorder(responses: Record<string, string>) {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = Object.keys(responses).find((k) => args.join(" ").includes(k));
    return { stdout: key ? responses[key]! : "", stderr: "" };
  };
  return { run, calls };
}

describe("GitHubHost on Enterprise", () => {
  it("uses --repo with host for pr commands and --hostname for api", async () => {
    const { run, calls } = recorder({
      "pr view": JSON.stringify({ headRefOid: "deadbeef" }),
      "pulls/1481/reviews": JSON.stringify({ html_url: "https://acme.ghe.com/acme/widgets/pull/1481" }),
    });
    const host = new GitHubHost(1481, "acme.ghe.com/acme/widgets", run);

    const res = await host.postReview([{ path: "a.ts", line: 3, body: "nit" }], "summary");
    expect(res.url).toContain("acme.ghe.com");

    const prView = calls.find((c) => c.includes("view"))!;
    expect(prView).toContain("--repo");
    expect(prView).toContain("acme.ghe.com/acme/widgets");

    const api = calls.find((c) => c.includes("api"))!;
    expect(api).toContain("--hostname");
    expect(api).toContain("acme.ghe.com");
    expect(api).toContain("repos/acme/widgets/pulls/1481/reviews");
    expect(api.some((a) => a.startsWith("acme.ghe.com/"))).toBe(false);
  });

  it("omits --hostname for public github.com", async () => {
    const { run, calls } = recorder({
      "pr view": JSON.stringify({ headRefOid: "x" }),
      reviews: JSON.stringify({ html_url: "https://github.com/org/repo/pull/7" }),
    });
    const host = new GitHubHost(7, "org/repo", run);
    await host.postReview([], "");
    const api = calls.find((c) => c.includes("api"))!;
    expect(api).not.toContain("--hostname");
    expect(api).toContain("repos/org/repo/pulls/7/reviews");
  });
});
