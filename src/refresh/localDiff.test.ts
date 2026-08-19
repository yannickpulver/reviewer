import { describe, it, expect } from "vitest";
import type { Host, PullMeta } from "../host/types.js";
import type { Runner } from "../util/exec.js";
import { refreshDiff } from "./localDiff.js";

const META: PullMeta = {
  host: "github",
  id: 42,
  title: "Add thing",
  author: "yannick",
  url: "https://github.com/o/r/pull/42",
  baseRef: "main",
  headRef: "feature",
  headSha: "PRHEAD",
  state: "open",
};

const REMOTE_DIFF = "diff --git a/remote.ts b/remote.ts\n";

function fakeHost(): Host {
  return {
    kind: "github",
    fetch: async () => ({
      meta: META,
      diffText: REMOTE_DIFF,
      comments: [
      { id: "c1", path: "a.ts", line: 1, author: "kim", body: "hi", resolved: false, reactions: [] },
    ],
      diffScope: "full",
    }),
    postReview: async () => ({ url: "" }),
  };
}

/** Keys are matched as substrings of the command line, in insertion order. */
function fakeRun(responses: Record<string, string>, failing: string[] = []): Runner {
  return async (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    if (failing.some((f) => line.includes(f))) throw new Error(`refused: ${line}`);
    const key = Object.keys(responses).find((k) => line.includes(k));
    if (key === undefined) throw new Error(`unexpected command: ${line}`);
    return { stdout: responses[key]!, stderr: "" };
  };
}

const LOCAL_RESPONSES = {
  "merge-base --is-ancestor": "",
  "rev-parse --verify --quiet origin/main": "originbase\n",
  "merge-base origin/main HEAD": "mergebase\n",
  "diff mergebase": "diff --git a/local.ts b/local.ts\n",
  "rev-list --count PRHEAD..HEAD": "2\n",
};

describe("refreshDiff", () => {
  it("diffs locally when the worktree contains the PR head", async () => {
    const res = await refreshDiff(fakeHost(), META, fakeRun(LOCAL_RESPONSES));
    expect(res.source).toBe("local");
    expect(res.diffText).toContain("local.ts");
    expect(res.ahead).toBe(2);
    expect(res.comments).toBeUndefined();
  });

  it("falls back to the branch name when the PR head commit isn't here (amend/rebase)", async () => {
    const res = await refreshDiff(
      fakeHost(),
      META,
      fakeRun(
        { ...LOCAL_RESPONSES, "rev-parse --abbrev-ref": "feature\n" },
        ["--is-ancestor", "rev-list --count"],
      ),
    );
    expect(res.source).toBe("local");
    expect(res.ahead).toBe(0); // can't count against a commit we don't have
  });

  it("uses the host when a different branch is checked out", async () => {
    const res = await refreshDiff(
      fakeHost(),
      META,
      fakeRun({ "rev-parse --abbrev-ref": "some-other-branch\n" }, ["--is-ancestor"]),
    );
    expect(res.source).toBe("remote");
    expect(res.diffText).toBe(REMOTE_DIFF);
    expect(res.comments).toHaveLength(1);
  });

  it("uses the host when the base branch isn't available locally", async () => {
    const res = await refreshDiff(
      fakeHost(),
      META,
      fakeRun(LOCAL_RESPONSES, ["rev-parse --verify"]),
    );
    expect(res.source).toBe("remote");
  });

  it("re-runs the local host's own diff for a --local review", async () => {
    const localMeta: PullMeta = { ...META, host: "local", headSha: "" };
    const res = await refreshDiff(fakeHost(), localMeta, fakeRun({}));
    expect(res.source).toBe("local");
    expect(res.diffText).toBe(REMOTE_DIFF); // whatever LocalHost.fetch returns
    expect(res.ahead).toBe(0);
  });
});
