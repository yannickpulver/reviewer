import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../diff/parse.js";
import type { Grouping } from "../group/types.js";
import type { ArchitectFinding } from "../review/architect.js";
import { buildLineMap, carryGrouping, remapExisting, remapFindings } from "./remap.js";

const REVIEWED = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const bug = risky();
 const b = 2;
 const c = 3;
diff --git a/src/kept.ts b/src/kept.ts
--- a/src/kept.ts
+++ b/src/kept.ts
@@ -1,2 +1,3 @@
 x
+const kept = true;
 y
`;

// The bug line got replaced by two safe ones; kept.ts is untouched; new.ts is new.
const REFRESHED = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,5 @@
 const a = 1;
+const guard = check();
+const safe = value();
 const b = 2;
 const c = 3;
diff --git a/src/kept.ts b/src/kept.ts
--- a/src/kept.ts
+++ b/src/kept.ts
@@ -1,2 +1,3 @@
 x
+const kept = true;
 y
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+const fresh = 1;
+const also = 2;
`;

const oldFiles = parseUnifiedDiff(REVIEWED).files;
const newFiles = parseUnifiedDiff(REFRESHED).files;

const GROUPING: Grouping = {
  groups: [
    {
      title: "Risky bit",
      importance: "high",
      summary: "",
      hunks: ["src/a.ts:H0"],
    },
    {
      title: "Untouched",
      importance: "low",
      summary: "",
      hunks: ["src/kept.ts:H0"],
    },
  ],
  ungrouped: [],
};

describe("buildLineMap", () => {
  it("follows lines that moved and drops ones that are gone", () => {
    const map = buildLineMap(oldFiles, newFiles);
    expect(map["src/a.ts"]![1]).toBe(1); // "const a = 1;" didn't move
    expect(map["src/a.ts"]![3]).toBe(4); // "const b = 2;" shifted down one
    expect(map["src/a.ts"]![4]).toBe(5);
    expect(map["src/a.ts"]![2]).toBeUndefined(); // the risky() line is gone
  });

  it("ignores files that aren't in both diffs", () => {
    const map = buildLineMap(oldFiles, newFiles);
    expect(map["src/new.ts"]).toBeUndefined();
  });
});

describe("carryGrouping", () => {
  const carried = carryGrouping(GROUPING, oldFiles, newFiles, "Local changes");

  it("keeps a rewritten hunk in the group its file already had", () => {
    const risky = carried.grouping.groups.find((g) => g.title === "Risky bit")!;
    expect(risky.hunks).toEqual(["src/a.ts:H0"]);
    expect(carried.hunksChanged).toBe(1);
  });

  it("puts hunks from files new to the review in the fresh group, first", () => {
    expect(carried.grouping.groups[0]!.title).toBe("Local changes");
    expect(carried.grouping.groups[0]!.hunks).toEqual(["src/new.ts:H0"]);
    expect(carried.hunksNew).toBe(1);
  });

  it("carries unchanged hunks into the group they were in", () => {
    const untouched = carried.grouping.groups.find((g) => g.title === "Untouched")!;
    expect(untouched.hunks).toEqual(["src/kept.ts:H0"]);
    expect(carried.hunksUnchanged).toBe(1);
  });

  it("drops groups whose hunks all disappeared", () => {
    const gone: Grouping = {
      groups: [
        ...GROUPING.groups,
        { title: "Deleted file", importance: "low", summary: "", hunks: ["src/old.ts:H0"] },
      ],
      ungrouped: [],
    };
    const res = carryGrouping(gone, oldFiles, newFiles, "Local changes");
    expect(res.grouping.groups.map((g) => g.title)).not.toContain("Deleted file");
  });

  it("keeps ungrouped hunks ungrouped", () => {
    const res = carryGrouping(
      { groups: [GROUPING.groups[0]!], ungrouped: ["src/kept.ts:H0"] },
      oldFiles,
      newFiles,
      "Local changes",
    );
    expect(res.grouping.ungrouped).toEqual(["src/kept.ts:H0"]);
  });
});

describe("remapFindings", () => {
  const map = buildLineMap(oldFiles, newFiles);
  const findings: ArchitectFinding[] = [
    { path: "src/a.ts", line: 2, severity: "important", comment: "risky() throws", anchored: true },
    { path: "src/a.ts", line: 3, severity: "nit", comment: "naming", anchored: true },
    { path: "src/a.ts", line: 99, severity: "nit", comment: "unanchored", anchored: false },
  ];

  it("marks a finding stale when its line is gone", () => {
    const res = remapFindings(findings, map, newFiles);
    expect(res.findings[0]!.stale).toBe(true);
    expect(res.findings[0]!.anchored).toBe(false);
    expect(res.stale).toBe(1);
  });

  it("moves a surviving finding to its new line", () => {
    const res = remapFindings(findings, map, newFiles);
    expect(res.findings[1]!.line).toBe(4);
    expect(res.findings[1]!.anchored).toBe(true);
    expect(res.findings[1]!.stale).toBe(false);
  });

  it("leaves findings that never anchored alone", () => {
    const res = remapFindings(findings, map, newFiles);
    expect(res.findings[2]!.line).toBe(99);
    expect(res.findings[2]!.stale).toBe(false);
  });
});

describe("remapExisting", () => {
  it("moves comments that still have a line and drops the rest", () => {
    const map = buildLineMap(oldFiles, newFiles);
    const res = remapExisting(
      [
        { id: "c1", path: "src/a.ts", line: 3, author: "kim", body: "ok?", resolved: false, reactions: [] },
        { id: "c2", path: "src/a.ts", line: 2, author: "kim", body: "on the bug", resolved: false, reactions: [] },
      ],
      map,
    );
    expect(res.comments).toEqual([
      { id: "c1", path: "src/a.ts", line: 4, author: "kim", body: "ok?", resolved: false, reactions: [] },
    ]);
    expect(res.detached).toBe(1);
  });
});
