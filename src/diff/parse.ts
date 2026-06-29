import type { DiffFile, DiffLine, Hunk, ParsedDiff } from "./types.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified git diff (output of `git diff` / `gh pr diff` / `glab mr diff`)
 * into a typed model. Pure — no IO.
 */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const lines = text.split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const closeHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const closeFile = () => {
    closeHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const oldPath = m ? m[1]! : "";
      const path = m ? m[2]! : "";
      current = { path, oldPath, status: "modified", binary: false, hunks: [] };
      continue;
    }
    if (!current) continue;

    if (line.startsWith("new file mode")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.slice("rename from ".length);
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = line.slice("rename to ".length);
      continue;
    }
    if (line.startsWith("Binary files")) {
      closeHunk();
      current.binary = true;
      continue;
    }
    // Resolve real paths from --- / +++ markers (handles odd names better than the header).
    if (line.startsWith("--- ")) {
      const p = stripDiffPath(line.slice(4));
      if (p !== null && current.status !== "renamed") current.oldPath = p;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = stripDiffPath(line.slice(4));
      if (p !== null && current.status !== "renamed") current.path = p;
      continue;
    }
    if (line.startsWith("index ") || line.startsWith("similarity index ") || line.startsWith("\\ ")) {
      continue;
    }

    const hm = line.match(HUNK_HEADER);
    if (hm) {
      closeHunk();
      const oldStart = Number(hm[1]);
      const oldLines = hm[2] === undefined ? 1 : Number(hm[2]);
      const newStart = Number(hm[3]);
      const newLines = hm[4] === undefined ? 1 : Number(hm[4]);
      hunk = {
        id: `H${current.hunks.length}`,
        header: line,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      };
      oldNo = oldStart;
      newNo = newStart;
      continue;
    }

    if (hunk) {
      const marker = line[0];
      if (marker === "+") {
        hunk.lines.push(mkLine("add", line.slice(1), null, newNo));
        newNo++;
      } else if (marker === "-") {
        hunk.lines.push(mkLine("del", line.slice(1), oldNo, null));
        oldNo++;
      } else if (marker === " " || line === "") {
        hunk.lines.push(mkLine("context", line.slice(1), oldNo, newNo));
        oldNo++;
        newNo++;
      }
      // anything else (e.g. "\ No newline at end of file") is ignored
    }
  }
  closeFile();
  return { files };
}

function mkLine(
  type: DiffLine["type"],
  content: string,
  oldLineNo: number | null,
  newLineNo: number | null,
): DiffLine {
  return { type, content, oldLineNo, newLineNo };
}

function stripDiffPath(raw: string): string | null {
  const p = raw.trim();
  if (p === "/dev/null") return null;
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

/** All hunk refs in document order, e.g. ["src/a.ts:H0", "src/a.ts:H1", ...]. */
export function allHunkRefs(diff: ParsedDiff): string[] {
  const refs: string[] = [];
  for (const f of diff.files) for (const h of f.hunks) refs.push(`${f.path}:${h.id}`);
  return refs;
}
