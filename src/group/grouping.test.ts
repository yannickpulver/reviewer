import { describe, it, expect } from "vitest";
import { mergeGroupings, reconcileGrouping, sortByImportance } from "./grouping.js";
import type { Grouping } from "./types.js";

const KNOWN = ["a.ts:H0", "a.ts:H1", "b.ts:H0"];

describe("reconcileGrouping", () => {
  it("keeps valid refs and computes ungrouped", () => {
    const raw = {
      groups: [{ title: "Core", importance: "high", summary: "x", hunks: ["a.ts:H0"] }],
    };
    const g = reconcileGrouping(raw, KNOWN);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]!.hunks).toEqual(["a.ts:H0"]);
    expect(g.ungrouped).toEqual(["a.ts:H1", "b.ts:H0"]);
  });

  it("drops unknown and duplicate refs", () => {
    const raw = {
      groups: [
        { title: "G1", importance: "low", summary: "", hunks: ["a.ts:H0", "ghost:H9"] },
        { title: "G2", importance: "low", summary: "", hunks: ["a.ts:H0", "a.ts:H1"] },
      ],
    };
    const g = reconcileGrouping(raw, KNOWN);
    expect(g.groups[0]!.hunks).toEqual(["a.ts:H0"]);
    expect(g.groups[1]!.hunks).toEqual(["a.ts:H1"]); // duplicate a.ts:H0 dropped
    expect(g.ungrouped).toEqual(["b.ts:H0"]);
  });

  it("skips empty groups and defaults bad fields", () => {
    const raw = {
      groups: [
        { title: "", importance: "nope", hunks: ["a.ts:H0"] },
        { title: "Empty", importance: "high", hunks: ["ghost:H0"] },
      ],
    };
    const g = reconcileGrouping(raw, KNOWN);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]!.title).toBe("Changes");
    expect(g.groups[0]!.importance).toBe("medium");
  });

  it("handles garbage input", () => {
    expect(reconcileGrouping(null, KNOWN).ungrouped).toEqual(KNOWN);
    expect(reconcileGrouping({ groups: "x" }, KNOWN).ungrouped).toEqual(KNOWN);
  });
});

describe("mergeGroupings", () => {
  it("merges same-title groups with max importance", () => {
    const parts: Grouping[] = [
      { groups: [{ title: "Auth", importance: "low", summary: "a", hunks: ["a.ts:H0"] }], ungrouped: [] },
      { groups: [{ title: "auth", importance: "high", summary: "b", hunks: ["b.ts:H0"] }], ungrouped: ["c.ts:H0"] },
    ];
    const m = mergeGroupings(parts);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0]!.importance).toBe("high");
    expect(m.groups[0]!.hunks).toEqual(["a.ts:H0", "b.ts:H0"]);
    expect(m.groups[0]!.summary).toBe("a b");
    expect(m.ungrouped).toEqual(["c.ts:H0"]);
  });
});

describe("sortByImportance", () => {
  it("orders high→low", () => {
    const g: Grouping = {
      groups: [
        { title: "lo", importance: "low", summary: "", hunks: [] },
        { title: "hi", importance: "high", summary: "", hunks: [] },
        { title: "mid", importance: "medium", summary: "", hunks: [] },
      ],
      ungrouped: [],
    };
    expect(sortByImportance(g).groups.map((x) => x.title)).toEqual(["hi", "mid", "lo"]);
  });
});
