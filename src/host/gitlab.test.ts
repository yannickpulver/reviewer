import { describe, it, expect } from "vitest";
import { GitLabHost } from "./gitlab.js";
import type { Runner } from "../util/exec.js";

/** Fake glab: matches the first response key contained in the joined args. */
function recorder(responses: Record<string, string>) {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = Object.keys(responses).find((k) => args.join(" ").includes(k));
    return { stdout: key ? responses[key]! : "", stderr: "" };
  };
  return { run, calls };
}

const MR = JSON.stringify({
  iid: 5, title: "t", author: { username: "a" }, web_url: "u",
  source_branch: "f", target_branch: "main", sha: "sha",
  diff_refs: { base_sha: "b", head_sha: "h", start_sha: "s" }, state: "opened",
});

const DISCUSSIONS = JSON.stringify([
  {
    notes: [
      { id: 42, system: false, body: "nit", author: { username: "bob" }, resolved: false,
        position: { new_path: "a.ts", new_line: 3 } },
    ],
  },
]);

describe("GitLabHost reactions", () => {
  it("attaches award emoji to fetched comments", async () => {
    const { run } = recorder({
      award_emoji: JSON.stringify([
        { id: 1, name: "thumbsup", user: { username: "me" } },
        { id: 2, name: "thumbsup", user: { username: "bob" } },
        { id: 3, name: "party_blob", user: { username: "bob" } },
      ]),
      discussions: DISCUSSIONS,
      "api user": JSON.stringify({ username: "me" }),
      merge_requests: MR,
    });
    const host = new GitLabHost(5, "group/repo", run);
    const { comments } = await host.fetch();
    expect(comments).toEqual([
      {
        id: "42",
        path: "a.ts",
        line: 3,
        author: "bob",
        body: "nit",
        resolved: false,
        reactions: [
          { content: "+1", count: 2, viewerReacted: true },
          { content: "party_blob", count: 1, viewerReacted: false },
        ],
      },
    ]);
  });

  it("adds an award by mapped name", async () => {
    const { run, calls } = recorder({
      award_emoji: JSON.stringify([{ id: 9, name: "tada", user: { username: "me" } }]),
      "api user": JSON.stringify({ username: "me" }),
    });
    const host = new GitLabHost(5, "group/repo", run);
    const reactions = await host.toggleReaction("42", "hooray", false);
    expect(reactions).toEqual([{ content: "hooray", count: 1, viewerReacted: true }]);

    const post = calls.find((c) => c.includes("POST"))!;
    expect(post).toContain("name=tada");
    expect(post).toContain("projects/group%2Frepo/merge_requests/5/notes/42/award_emoji");
  });

  it("removes only the viewer's own award", async () => {
    const { run, calls } = recorder({
      award_emoji: JSON.stringify([
        { id: 1, name: "thumbsup", user: { username: "bob" } },
        { id: 2, name: "thumbsup", user: { username: "me" } },
      ]),
      "api user": JSON.stringify({ username: "me" }),
    });
    const host = new GitLabHost(5, "group/repo", run);
    await host.toggleReaction("42", "+1", true);

    const del = calls.find((c) => c.includes("DELETE"))!;
    expect(del[del.length - 1]).toBe(
      "projects/group%2Frepo/merge_requests/5/notes/42/award_emoji/2",
    );
  });
});
