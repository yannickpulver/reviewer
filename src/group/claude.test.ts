import { describe, it, expect } from "vitest";
import { extractJsonObject, packBatches, sliceSegments, groupDiff } from "./claude.js";
import { parseUnifiedDiff } from "../diff/parse.js";
import type { Runner } from "../util/exec.js";

const TWO_FILES = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-x
+y
diff --git a/b.ts b/b.ts
index 1..2 100644
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,1 @@
-m
+n
`;

describe("extractJsonObject", () => {
  it("parses bare json", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced json", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("parses json amid prose", () => {
    expect(extractJsonObject('Here:\n{"a":1}\nthanks')).toEqual({ a: 1 });
  });
  it("throws on no json", () => {
    expect(() => extractJsonObject("nope")).toThrow();
  });
});

describe("sliceSegments", () => {
  it("splits raw diff per file aligned with parsed model", () => {
    const diff = parseUnifiedDiff(TWO_FILES);
    const segs = sliceSegments(diff, TWO_FILES);
    expect(segs.map((s) => s.path)).toEqual(["a.ts", "b.ts"]);
    expect(segs[0]!.refs).toEqual(["a.ts:H0"]);
    expect(segs[0]!.diffText).toContain("a/a.ts");
    expect(segs[0]!.diffText).not.toContain("b.ts");
  });
});

describe("packBatches", () => {
  it("keeps files together under budget", () => {
    const diff = parseUnifiedDiff(TWO_FILES);
    const segs = sliceSegments(diff, TWO_FILES);
    expect(packBatches(segs, 1_000_000)).toHaveLength(1);
  });
  it("splits when over budget but never splits a file", () => {
    const diff = parseUnifiedDiff(TWO_FILES);
    const segs = sliceSegments(diff, TWO_FILES);
    const batches = packBatches(segs, 10); // tiny → one file per batch
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
  });
});

describe("groupDiff", () => {
  it("calls claude per batch and merges", async () => {
    const diff = parseUnifiedDiff(TWO_FILES);
    const run: Runner = async (cmd) => {
      expect(cmd).toBe("claude");
      return {
        stdout: JSON.stringify({
          result: '{"groups":[{"title":"Edits","importance":"high","summary":"s","hunks":["a.ts:H0","b.ts:H0"]}]}',
        }),
        stderr: "",
      };
    };
    const g = await groupDiff(diff, TWO_FILES, { run });
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]!.hunks.sort()).toEqual(["a.ts:H0", "b.ts:H0"]);
  });

  it("falls back to a single group when claude fails", async () => {
    const diff = parseUnifiedDiff(TWO_FILES);
    const run: Runner = async () => {
      throw new Error("claude missing");
    };
    const g = await groupDiff(diff, TWO_FILES, { run });
    expect(g.groups[0]!.title).toBe("All changes");
    expect(g.groups[0]!.hunks.sort()).toEqual(["a.ts:H0", "b.ts:H0"]);
  });
});
