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

  it("keeps flags anchored to the group's hunks, drops the rest", () => {
    const raw = {
      groups: [
        {
          title: "Core",
          importance: "high",
          summary: "x",
          hunks: ["a.ts:H0", "a.ts:H1"],
          flags: [
            { hunk: "a.ts:H0", severity: "danger", note: "  null deref  " },
            { hunk: "a.ts:H1", severity: "bogus", note: "off-by-one" }, // severity defaults
            { hunk: "b.ts:H0", severity: "warning", note: "wrong group" }, // ref not in group
            { hunk: "a.ts:H0", severity: "warning", note: "" }, // empty note
          ],
        },
      ],
    };
    const g = reconcileGrouping(raw, KNOWN);
    expect(g.groups[0]!.flags).toEqual([
      { hunk: "a.ts:H0", severity: "danger", note: "null deref" },
      { hunk: "a.ts:H1", severity: "warning", note: "off-by-one" },
    ]);
  });

  it("defaults flags to an empty array when absent", () => {
    const g = reconcileGrouping(
      { groups: [{ title: "Core", importance: "high", summary: "x", hunks: ["a.ts:H0"] }] },
      KNOWN,
    );
    expect(g.groups[0]!.flags).toEqual([]);
  });
});

describe("mergeGroupings", () => {
  it("merges same-title groups with max importance", () => {
    const parts: Grouping[] = [
      {
        groups: [
          {
            title: "Auth",
            importance: "low",
            summary: "a",
            hunks: ["a.ts:H0"],
            flags: [{ hunk: "a.ts:H0", severity: "warning", note: "check this" }],
          },
        ],
        ungrouped: [],
      },
      {
        groups: [
          {
            title: "auth",
            importance: "high",
            summary: "b",
            hunks: ["b.ts:H0"],
            flags: [{ hunk: "b.ts:H0", severity: "danger", note: "bug" }],
          },
        ],
        ungrouped: ["c.ts:H0"],
      },
    ];
    const m = mergeGroupings(parts);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0]!.importance).toBe("high");
    expect(m.groups[0]!.hunks).toEqual(["a.ts:H0", "b.ts:H0"]);
    expect(m.groups[0]!.summary).toBe("a b");
    expect(m.groups[0]!.flags).toHaveLength(2);
    expect(m.ungrouped).toEqual(["c.ts:H0"]);
  });
});

describe("sortByImportance", () => {
  it("orders high→low", () => {
    const g: Grouping = {
      groups: [
        { title: "lo", importance: "low", summary: "", hunks: [], flags: [] },
        { title: "hi", importance: "high", summary: "", hunks: [], flags: [] },
        { title: "mid", importance: "medium", summary: "", hunks: [], flags: [] },
      ],
      ungrouped: [],
    };
    expect(sortByImportance(g).groups.map((x) => x.title)).toEqual(["hi", "mid", "lo"]);
  });
});
