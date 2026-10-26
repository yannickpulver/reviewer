import { describe, it, expect } from "vitest";
import type { Grouping } from "../group/types.js";
import type { Host } from "../host/types.js";
import { applyGrouping, queueEntry, startServer } from "./server.js";
import type { QueueEntry, ReadyState } from "./payload.js";

const FALLBACK: Grouping = {
  groups: [{ title: "All changes", importance: "medium", summary: "", hunks: ["a.ts:H0"] }],
  ungrouped: [],
};

const REAL: Grouping = {
  groups: [{ title: "Auth", importance: "high", summary: "s", hunks: ["a.ts:H0"] }],
  ungrouped: [],
};

function readyState(rev: number, pending: boolean): ReadyState {
  return {
    status: "ready",
    meta: {
      host: "local",
      id: 0,
      title: "t",
      author: "a",
      url: "",
      baseRef: "main",
      headRef: "topic",
      headSha: "abc",
      state: "open",
      description: "",
    },
    files: [],
    grouping: FALLBACK,
    existingComments: [],
    diffScope: "full",
    reactionsSupported: false,
    rev,
    ...(pending ? { groupingPending: true } : {}),
  };
}

describe("applyGrouping", () => {
  it("swaps the grouping in and bumps rev when nothing refreshed", () => {
    const res = applyGrouping(readyState(0, true), REAL, 0);
    expect(res.dropped).toBe(false);
    expect(res.state.grouping).toBe(REAL);
    expect(res.state.rev).toBe(1);
    expect(res.state.groupingPending).toBeUndefined();
  });

  it("drops a grouping computed against an older diff but clears the pending flag", () => {
    const res = applyGrouping(readyState(1, true), REAL, 0);
    expect(res.dropped).toBe(true);
    expect(res.state.grouping).toBe(FALLBACK);
    expect(res.state.rev).toBe(1);
    expect(res.state.groupingPending).toBeUndefined();
  });

  it("drops a grouping that lands while a refresh is in flight", () => {
    const res = applyGrouping(readyState(0, true), REAL, 0, true);
    expect(res.dropped).toBe(true);
    expect(res.state.grouping).toBe(FALLBACK);
    expect(res.state.rev).toBe(0);
    expect(res.state.groupingPending).toBeUndefined();
  });

  it("keeps the state ready in both cases", () => {
    expect(applyGrouping(readyState(0, true), REAL, 0).state.status).toBe("ready");
    expect(applyGrouping(readyState(2, true), REAL, 0).state.status).toBe("ready");
  });
});

describe("queueEntry", () => {
  const label = { id: 7, title: "From picker", author: "bob" };

  it("shows the picker's label while the diff is still fetching", () => {
    expect(queueEntry(1, label, { status: "building", step: "fetching" }, null)).toEqual({
      slot: 1,
      id: 7,
      title: "From picker",
      author: "bob",
      status: "fetching",
    });
  });

  it("takes the review's own meta once ready, and reports pending grouping", () => {
    const e = queueEntry(0, label, readyState(0, true), null);
    expect(e).toMatchObject({ id: 0, title: "t", author: "a", status: "grouping" });
    expect(queueEntry(0, label, readyState(1, false), null).status).toBe("ready");
  });

  it("marks errors and submitted reviews", () => {
    expect(queueEntry(0, label, { status: "error", message: "x" }, null).status).toBe("error");
    expect(queueEntry(0, label, readyState(1, false), "https://pr").submitted).toBe("https://pr");
  });
});

describe("startServer with a queue", () => {
  const fakeHost = (posted: string[], url: string): Host => ({
    kind: "github",
    fetch: async () => {
      throw new Error("not used");
    },
    postReview: async () => {
      posted.push(url);
      return { url };
    },
  });

  it("serves each review under its own slot and tracks submissions", async () => {
    const posted: string[] = [];
    const server = await startServer([
      { host: fakeHost(posted, "https://pr/1"), label: { id: 1, title: "One", author: "a" } },
      { host: fakeHost(posted, "https://pr/2"), label: { id: 2, title: "Two", author: "b" } },
    ]);
    try {
      const { meta, ...rest } = readyState(0, false);
      const { status: _s, rev: _r, ...payload } = rest;
      server.sessions[1]!.setPayload({ ...payload, meta: { ...meta, id: 2, title: "Two!" } }, "");

      const getQueue = async () =>
        (await (await fetch(`${server.url}/api/queue`)).json()) as QueueEntry[];
      const queue = await getQueue();
      expect(queue.map((e) => [e.title, e.status])).toEqual([
        ["One", "fetching"],
        ["Two!", "ready"],
      ]);

      const first = (await (await fetch(`${server.url}/api/s/0/review`)).json()) as { status: string };
      expect(first.status).toBe("building");
      const res = await fetch(`${server.url}/api/s/1/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: [], summary: "lgtm", action: "approve" }),
      });
      expect(await res.json()).toEqual({ url: "https://pr/2" });
      expect(posted).toEqual(["https://pr/2"]);

      const after = await getQueue();
      expect(after[1]!.submitted).toBe("https://pr/2");
      expect(after[0]!.submitted).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
