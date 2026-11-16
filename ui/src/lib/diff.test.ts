import { describe, it, expect } from "vitest";
import type { DiffFile, DiffLine, LineType } from "../types";
import { gapsAround, revealedLines, searchFiles } from "./diff";

function line(type: LineType, content: string, no: number): DiffLine {
  return { type, content, oldLineNo: type === "add" ? null : no, newLineNo: type === "del" ? null : no };
}

function file(path: string, contents: string[], binary = false): DiffFile {
  return {
    path,
    oldPath: path,
    status: "modified",
    binary,
    hunks: contents.map((c, i) => ({
      id: `H${i + 1}`,
      header: `@@ -1,1 +1,1 @@`,
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [line("add", c, 1)],
    })),
  };
}

const FILES: DiffFile[] = [
  file("src/auth.ts", ["const token = 1;", "return token;"]),
  file("src/ui/Button.tsx", ["export function Button() {}"]),
  file("assets/token.png", ["binary token blob"], true),
  file("assets/blob.bin", ["token inside a binary hunk"], true),
];

describe("searchFiles", () => {
  it("returns nothing for an empty query", () => {
    expect(searchFiles(FILES, "")).toEqual([]);
    expect(searchFiles(FILES, "   ")).toEqual([]);
  });

  it("matches line content case-insensitively and counts matching lines", () => {
    const hits = searchFiles(FILES, "TOKEN");
    expect(hits.map((h) => h.path)).toEqual(["src/auth.ts", "assets/token.png"]);
    expect(hits[0]!.matches).toBe(2);
  });

  it("returns every hunk ref of a matching file, not only the matching hunks", () => {
    const hits = searchFiles(FILES, "return token");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.refs).toEqual(["src/auth.ts:H1", "src/auth.ts:H2"]);
    expect(hits[0]!.matches).toBe(1);
  });

  it("matches on the path alone with zero matching lines", () => {
    const hits = searchFiles(FILES, "src/ui/");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      path: "src/ui/Button.tsx",
      refs: ["src/ui/Button.tsx:H1"],
      matches: 0,
    });
  });

  it("skips the hunk scan for binary files but still matches their path", () => {
    expect(searchFiles(FILES, "assets/token")).toEqual([
      { path: "assets/token.png", refs: ["assets/token.png:H1"], matches: 0 },
    ]);
    // "blob.bin" only matches inside a binary hunk, which is never scanned.
    expect(searchFiles(FILES, "token inside")).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchFiles(FILES, "zzzz")).toEqual([]);
  });
});

const r = (oldStart: number, oldLines: number, newStart: number, newLines: number) => ({
  oldStart,
  oldLines,
  newStart,
  newLines,
});

describe("gapsAround", () => {
  // 100-line file. Hunk A covers new 10-15 (old 10-13: +2 lines), B covers new 40-45, C new 70-72.
  const A = r(10, 4, 10, 6);
  const B = r(38, 6, 40, 6);
  const C = r(68, 3, 70, 3);

  it("finds the unchanged lines around shown hunks, with old line offsets", () => {
    const [before, mid, after] = gapsAround([A, B], [A, B], 100);
    expect(before).toEqual({ down: null, up: { start: 1, end: 9, delta: 0 }, split: false });
    expect(mid).toEqual({
      down: { start: 16, end: 39, delta: -2 },
      up: { start: 16, end: 39, delta: -2 },
      split: false,
    });
    expect(after).toEqual({ down: { start: 46, end: 100, delta: -2 }, up: null, split: false });
  });

  it("stops at hunks shown elsewhere", () => {
    const [, mid, after] = gapsAround([A, C], [A, B, C], 100);
    expect(mid).toEqual({
      down: { start: 16, end: 39, delta: -2 },
      up: { start: 46, end: 69, delta: -2 },
      split: true,
    });
    expect(after!.down).toEqual({ start: 73, end: 100, delta: -2 });
  });

  it("handles hunks without new lines", () => {
    // Lines old 5-7 deleted; new line 4 is right before them, new 5 is old 8.
    const [, after] = gapsAround([r(5, 3, 4, 0)], [r(5, 3, 4, 0)], 20);
    expect(after!.down).toEqual({ start: 5, end: 20, delta: 3 });
  });
});

describe("revealedLines", () => {
  const gap = { down: { start: 16, end: 39, delta: 0 }, up: { start: 16, end: 39, delta: 0 }, split: false };

  it("reveals from both ends without overlap", () => {
    const res = revealedLines(gap, { down: 20, up: 20 });
    expect(res.top).toHaveLength(20);
    expect(res.bottom).toEqual([36, 37, 38, 39]);
    expect(res.hidden).toBe(0);
  });

  it("counts what is still hidden", () => {
    const res = revealedLines(gap, { down: 0, up: 3 });
    expect(res.top).toEqual([]);
    expect(res.bottom).toEqual([37, 38, 39]);
    expect(res.hidden).toBe(21);
  });
});
