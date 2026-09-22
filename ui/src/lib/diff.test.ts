import { describe, it, expect } from "vitest";
import type { DiffFile, DiffLine, LineType } from "../types";
import { searchFiles } from "./diff";

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
