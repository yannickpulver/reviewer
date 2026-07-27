import { describe, it, expect } from "vitest";
import { architectReview, validateFindings } from "./architect.js";
import { parseUnifiedDiff } from "../diff/parse.js";
import type { Runner } from "../util/exec.js";

const DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 context
-x
+y
`;

describe("validateFindings", () => {
  it("anchors a finding whose path+line exists in the diff", () => {
    const diff = parseUnifiedDiff(DIFF);
    const out = validateFindings(
      [{ path: "a.ts", line: 2, severity: "important", comment: "breaks" }],
      diff.files,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.anchored).toBe(true);
  });

  it("keeps but marks unanchored when the path doesn't match any file", () => {
    const diff = parseUnifiedDiff(DIFF);
    const out = validateFindings(
      [{ path: "missing.ts", line: 2, severity: "nit", comment: "hmm" }],
      diff.files,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.anchored).toBe(false);
  });

  it("keeps but marks unanchored when the line isn't a new-side line in the file's hunks", () => {
    const diff = parseUnifiedDiff(DIFF);
    const out = validateFindings(
      [{ path: "a.ts", line: 999, severity: "design", comment: "hmm" }],
      diff.files,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.anchored).toBe(false);
  });

  it("defaults unknown severities to nit", () => {
    const diff = parseUnifiedDiff(DIFF);
    const out = validateFindings(
      [{ path: "a.ts", line: 2, severity: "catastrophic", comment: "hmm" }],
      diff.files,
    );
    expect(out[0]!.severity).toBe("nit");
  });

  it("drops malformed entries (missing required fields)", () => {
    const diff = parseUnifiedDiff(DIFF);
    const out = validateFindings(
      [
        { path: "a.ts", line: 2 }, // no comment
        { line: 2, comment: "hmm" }, // no path
        { path: "a.ts", comment: "hmm" }, // no line
        null,
        "nope",
      ],
      diff.files,
    );
    expect(out).toHaveLength(0);
  });

  it("returns an empty array when raw isn't an array", () => {
    const diff = parseUnifiedDiff(DIFF);
    expect(validateFindings(undefined, diff.files)).toEqual([]);
    expect(validateFindings({}, diff.files)).toEqual([]);
  });

  it("keeps an optional trimmed fix, omitting it when blank", () => {
    const diff = parseUnifiedDiff(DIFF);
    const out = validateFindings(
      [
        { path: "a.ts", line: 2, severity: "nit", comment: "hmm", fix: "  do this  " },
        { path: "a.ts", line: 2, severity: "nit", comment: "hmm2", fix: "   " },
      ],
      diff.files,
    );
    expect(out[0]!.fix).toBe("do this");
    expect(out[1]!.fix).toBeUndefined();
  });
});

describe("architectReview", () => {
  it("calls claude and returns a validated review", async () => {
    const diff = parseUnifiedDiff(DIFF);
    const run: Runner = async (cmd, args) => {
      expect(cmd).toBe("claude");
      expect(args).toContain("--model");
      return {
        stdout: JSON.stringify({
          result:
            '{"verdict":"issues","summary":"1 important","findings":[{"path":"a.ts","line":2,"severity":"important","comment":"breaks at runtime","fix":"guard it"}]}',
        }),
        stderr: "",
      };
    };
    const review = await architectReview(DIFF, diff.files, "sonnet", run);
    expect(review.verdict).toBe("issues");
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]!.anchored).toBe(true);
  });

  it("defaults to a clean verdict with a default summary when claude reports no findings", async () => {
    const diff = parseUnifiedDiff(DIFF);
    const run: Runner = async () => ({
      stdout: JSON.stringify({ result: '{"verdict":"clean","findings":[]}' }),
      stderr: "",
    });
    const review = await architectReview(DIFF, diff.files, undefined, run);
    expect(review.verdict).toBe("clean");
    expect(review.summary).toBe("No blocking issues found.");
  });

  it("throws when claude returns an error envelope", async () => {
    const diff = parseUnifiedDiff(DIFF);
    const run: Runner = async () => ({
      stdout: JSON.stringify({ is_error: true }),
      stderr: "",
    });
    await expect(architectReview(DIFF, diff.files, undefined, run)).rejects.toThrow();
  });

  it("propagates errors from the runner (e.g. claude missing)", async () => {
    const diff = parseUnifiedDiff(DIFF);
    const run: Runner = async () => {
      throw new Error("claude missing");
    };
    await expect(architectReview(DIFF, diff.files, undefined, run)).rejects.toThrow(
      "claude missing",
    );
  });
});
