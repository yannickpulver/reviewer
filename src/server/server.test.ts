import { describe, it, expect } from "vitest";
import type { Grouping } from "../group/types.js";
import { applyGrouping } from "./server.js";
import type { ReadyState } from "./payload.js";

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
