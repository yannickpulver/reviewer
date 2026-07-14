import { describe, it, expect } from "vitest";
import { LocalHost, defaultBase } from "./local.js";
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

describe("LocalHost", () => {
  it("diffs the merge-base against the working tree and can't submit", async () => {
    const { run, calls } = recorder({
      "rev-parse --abbrev-ref": "feature-x\n",
      "rev-parse HEAD": "headsha\n",
      "merge-base main HEAD": "basesha\n",
      "diff basesha": "diff --git a/a.ts b/a.ts\n",
      "config user.name": "Yannick\n",
    });
    const host = new LocalHost("main", run);
    const res = await host.fetch();

    expect(res.meta.host).toBe("local");
    expect(res.meta.headRef).toBe("feature-x");
    expect(res.meta.baseRef).toBe("main");
    expect(res.meta.headSha).toBe("headsha");
    expect(res.meta.author).toBe("Yannick");
    expect(res.diffText).toContain("diff --git");
    expect(res.comments).toEqual([]);

    // The diff is taken against the merge-base, not the base ref directly.
    expect(calls.some((c) => c.join(" ") === "git diff basesha")).toBe(true);

    await expect(host.postReview([], "", "comment")).rejects.toThrow(/no PR/i);
  });
});

describe("defaultBase", () => {
  it("prefers origin/HEAD", async () => {
    const { run } = recorder({ "symbolic-ref": "refs/remotes/origin/main\n" });
    expect(await defaultBase(run)).toBe("origin/main");
  });

  it("falls back to main when there's no origin/HEAD", async () => {
    const run: Runner = async (_cmd, args) => {
      const joined = args.join(" ");
      if (joined.includes("symbolic-ref")) throw new Error("no origin/HEAD");
      if (joined.includes("rev-parse --verify --quiet main")) return { stdout: "sha\n", stderr: "" };
      throw new Error(`missing ref: ${joined}`);
    };
    expect(await defaultBase(run)).toBe("main");
  });
});
