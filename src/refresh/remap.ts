import type { DiffFile, Hunk } from "../diff/types.js";
import type { Group, Grouping } from "../group/types.js";
import type { ExistingComment } from "../host/types.js";
import type { ArchitectFinding } from "../review/architect.js";

/** path → line number in the old diff's new side → the same line in the refreshed diff. */
export type LineMap = Record<string, Record<number, number>>;

interface LineEntry {
  line: number;
  text: string;
}

/** Longest segment we'll fill greedily; anchors already carry the bulk of long files. */
const MAX_SEGMENT = 500;

/** New-side lines of a file, in ascending line order. */
function newSideLines(file: DiffFile): LineEntry[] {
  const out: LineEntry[] = [];
  for (const hunk of file.hunks) {
    for (const l of hunk.lines) {
      if (l.newLineNo !== null) out.push({ line: l.newLineNo, text: l.content });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function countByText(entries: LineEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.text, (counts.get(e.text) ?? 0) + 1);
  return counts;
}

/**
 * Align two versions of a file's new-side lines by content.
 *
 * Lines that are unique on both sides are certain anchors; everything between
 * two anchors is then matched greedily in order, which keeps a repeated line
 * (`}`, blank) from jumping across the file.
 */
function alignLines(a: LineEntry[], b: LineEntry[]): Map<number, number> {
  const out = new Map<number, number>();
  const countA = countByText(a);
  const countB = countByText(b);

  const indexInB = new Map<string, number>();
  b.forEach((e, i) => {
    if (countB.get(e.text) === 1) indexInB.set(e.text, i);
  });

  // Unique-on-both-sides anchors, kept strictly increasing on the b side.
  const anchorPairs: [number, number][] = [];
  let lastB = -1;
  a.forEach((e, i) => {
    if (countA.get(e.text) !== 1) return;
    const j = indexInB.get(e.text);
    if (j === undefined || j <= lastB) return;
    anchorPairs.push([i, j]);
    lastB = j;
  });

  let ai = 0;
  let bi = 0;
  for (const [anchorA, anchorB] of anchorPairs) {
    fillSegment(a, b, ai, anchorA, bi, anchorB, out);
    out.set(a[anchorA]!.line, b[anchorB]!.line);
    ai = anchorA + 1;
    bi = anchorB + 1;
  }
  fillSegment(a, b, ai, a.length, bi, b.length, out);
  return out;
}

/** Greedy in-order content match inside one anchor-bounded segment. */
function fillSegment(
  a: LineEntry[],
  b: LineEntry[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  out: Map<number, number>,
) {
  if (aEnd - aStart > MAX_SEGMENT || bEnd - bStart > MAX_SEGMENT) return;
  let bj = bStart;
  for (let i = aStart; i < aEnd; i++) {
    for (let k = bj; k < bEnd; k++) {
      if (b[k]!.text === a[i]!.text) {
        out.set(a[i]!.line, b[k]!.line);
        bj = k + 1;
        break;
      }
    }
  }
}

/** Map every line that survived from the reviewed diff into the refreshed one. */
export function buildLineMap(oldFiles: DiffFile[], newFiles: DiffFile[]): LineMap {
  const map: LineMap = {};
  const byPath = new Map(newFiles.map((f) => [f.path, f]));
  for (const oldFile of oldFiles) {
    const newFile = byPath.get(oldFile.path);
    if (!newFile) continue;
    const pairs = alignLines(newSideLines(oldFile), newSideLines(newFile));
    if (pairs.size > 0) map[oldFile.path] = Object.fromEntries(pairs);
  }
  return map;
}

/** Content identity of a hunk: its changed lines, ignoring position and context. */
export function hunkKey(path: string, hunk: Hunk): string {
  const changed = hunk.lines
    .filter((l) => l.type !== "context")
    .map((l) => (l.type === "add" ? "+" : "-") + l.content);
  return `${path} ${changed.join("|")}`;
}

/** Per-hunk identity + ref, with duplicates inside a file disambiguated by occurrence. */
function hunkIdentities(files: DiffFile[]): { ref: string; path: string; key: string }[] {
  const seen = new Map<string, number>();
  const out: { ref: string; path: string; key: string }[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      const base = hunkKey(file.path, hunk);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.push({ ref: `${file.path}:${hunk.id}`, path: file.path, key: `${base}#${n}` });
    }
  }
  return out;
}

const UNGROUPED = -1;
const FRESH = -2;

export interface CarryResult {
  grouping: Grouping;
  /** Hunks carried over unchanged. */
  hunksUnchanged: number;
  /** Hunks in an already-reviewed file whose content changed. */
  hunksChanged: number;
  /** Hunks in a file that wasn't part of the review. */
  hunksNew: number;
}

/**
 * Carry an existing grouping onto a refreshed diff without asking Claude again.
 *
 * A hunk that's identical keeps its exact group; one whose content changed stays
 * in the group its file already belonged to; one in a file that wasn't under
 * review lands in a fresh group titled `freshTitle`.
 */
export function carryGrouping(
  prev: Grouping,
  oldFiles: DiffFile[],
  newFiles: DiffFile[],
  freshTitle: string,
): CarryResult {
  const groupOf = new Map<string, number>();
  prev.groups.forEach((g, i) => g.hunks.forEach((ref) => groupOf.set(ref, i)));
  prev.ungrouped.forEach((ref) => groupOf.set(ref, UNGROUPED));

  const oldIdentities = hunkIdentities(oldFiles);
  const refByKey = new Map(oldIdentities.map((h) => [h.key, h.ref]));

  // Dominant group per already-reviewed file, so a rewritten hunk stays put.
  const perFile = new Map<string, Map<number, number>>();
  for (const { ref, path } of oldIdentities) {
    const target = groupOf.get(ref);
    if (target === undefined) continue;
    const tally = perFile.get(path) ?? new Map<number, number>();
    tally.set(target, (tally.get(target) ?? 0) + 1);
    perFile.set(path, tally);
  }
  const fileGroup = new Map<string, number>();
  for (const [path, tally] of perFile) {
    let best = UNGROUPED;
    let bestCount = -1;
    for (const [target, count] of tally) {
      if (count > bestCount) {
        best = target;
        bestCount = count;
      }
    }
    fileGroup.set(path, best);
  }

  const assigned = new Map<number, string[]>();
  let hunksUnchanged = 0;
  let hunksChanged = 0;
  let hunksNew = 0;

  for (const { ref, path, key } of hunkIdentities(newFiles)) {
    const oldRef = refByKey.get(key);
    let target: number;
    if (oldRef !== undefined && groupOf.has(oldRef)) {
      target = groupOf.get(oldRef)!;
      hunksUnchanged++;
    } else if (fileGroup.has(path)) {
      target = fileGroup.get(path)!;
      hunksChanged++;
    } else {
      target = FRESH;
      hunksNew++;
    }
    const list = assigned.get(target) ?? [];
    list.push(ref);
    assigned.set(target, list);
  }

  const groups: Group[] = [];

  const fresh = assigned.get(FRESH) ?? [];
  if (fresh.length > 0) {
    groups.push({
      title: freshTitle,
      importance: "medium",
      summary: "Changes that weren't part of the review yet.",
      hunks: fresh,
    });
  }

  prev.groups.forEach((g, i) => {
    const hunks = assigned.get(i) ?? [];
    if (hunks.length === 0) return;
    groups.push({ ...g, hunks });
  });

  return {
    grouping: { groups, ungrouped: assigned.get(UNGROUPED) ?? [] },
    hunksUnchanged,
    hunksChanged,
    hunksNew,
  };
}

/** Every anchorable new-side position in a diff, keyed "path:line". */
function anchorSet(files: DiffFile[]): Set<string> {
  const set = new Set<string>();
  for (const f of files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.newLineNo !== null) set.add(`${f.path}:${l.newLineNo}`);
      }
    }
  }
  return set;
}

/**
 * Re-anchor architect findings onto the refreshed diff. A finding whose line no
 * longer exists is marked stale rather than deleted — that's usually the fix you
 * just made, and it's worth seeing.
 */
export function remapFindings(
  findings: ArchitectFinding[],
  lineMap: LineMap,
  newFiles: DiffFile[],
): { findings: ArchitectFinding[]; stale: number } {
  const valid = anchorSet(newFiles);
  let stale = 0;
  const out = findings.map((f) => {
    if (!f.anchored) return { ...f, stale: false };
    const line = lineMap[f.path]?.[f.line];
    if (line !== undefined && valid.has(`${f.path}:${line}`)) {
      return { ...f, line, anchored: true, stale: false };
    }
    stale++;
    return { ...f, anchored: false, stale: true };
  });
  return { findings: out, stale };
}

/** Re-anchor comments already on the PR/MR; ones whose line is gone are dropped. */
export function remapExisting(
  comments: ExistingComment[],
  lineMap: LineMap,
): { comments: ExistingComment[]; detached: number } {
  const out: ExistingComment[] = [];
  let detached = 0;
  for (const c of comments) {
    const line = lineMap[c.path]?.[c.line];
    if (line === undefined) detached++;
    else out.push({ ...c, line });
  }
  return { comments: out, detached };
}
