import type { ParsedDiff } from "../diff/types.js";
import type { Group, Grouping, Importance } from "./types.js";

const IMPORTANCE_RANK: Record<Importance, number> = { low: 0, medium: 1, high: 2 };

function isImportance(v: unknown): v is Importance {
  return v === "high" || v === "medium" || v === "low";
}

/**
 * Validate raw model output into a Grouping, reconciled against the set of real
 * hunk refs. Unknown refs are dropped; any real ref the model omitted lands in
 * `ungrouped`. Each real ref appears exactly once across the result.
 */
export function reconcileGrouping(raw: unknown, knownRefs: string[]): Grouping {
  const known = new Set(knownRefs);
  const assigned = new Set<string>();
  const groups: Group[] = [];

  const obj = (raw ?? {}) as { groups?: unknown; ungrouped?: unknown };
  const rawGroups = Array.isArray(obj.groups) ? obj.groups : [];

  for (const g of rawGroups) {
    const gg = (g ?? {}) as Partial<Group> & { hunks?: unknown };
    const hunks: string[] = [];
    const rawHunks = Array.isArray(gg.hunks) ? gg.hunks : [];
    for (const h of rawHunks) {
      if (typeof h === "string" && known.has(h) && !assigned.has(h)) {
        assigned.add(h);
        hunks.push(h);
      }
    }
    if (hunks.length === 0) continue; // skip empty/hallucinated groups
    groups.push({
      title: typeof gg.title === "string" && gg.title.trim() ? gg.title.trim() : "Changes",
      importance: isImportance(gg.importance) ? gg.importance : "medium",
      summary: typeof gg.summary === "string" ? gg.summary.trim() : "",
      hunks,
    });
  }

  // Everything the model never placed (or placed in unknown refs) becomes ungrouped.
  const ungrouped = knownRefs.filter((r) => !assigned.has(r));
  return { groups, ungrouped };
}

/**
 * Merge groupings from multiple chunks. Groups with the same (case-insensitive)
 * title are combined; importance is the max, summaries are joined.
 */
export function mergeGroupings(parts: Grouping[]): Grouping {
  const byTitle = new Map<string, Group>();
  const order: string[] = [];

  for (const part of parts) {
    for (const g of part.groups) {
      const key = g.title.toLowerCase();
      const existing = byTitle.get(key);
      if (existing) {
        existing.hunks.push(...g.hunks);
        if (IMPORTANCE_RANK[g.importance] > IMPORTANCE_RANK[existing.importance]) {
          existing.importance = g.importance;
        }
        if (g.summary && !existing.summary.includes(g.summary)) {
          existing.summary = existing.summary ? `${existing.summary} ${g.summary}` : g.summary;
        }
      } else {
        byTitle.set(key, { ...g, hunks: [...g.hunks] });
        order.push(key);
      }
    }
  }

  const ungrouped = parts.flatMap((p) => p.ungrouped);
  return { groups: order.map((k) => byTitle.get(k)!), ungrouped };
}

/** Sort groups high→low importance, preserving order within a tier. */
export function sortByImportance(grouping: Grouping): Grouping {
  const groups = [...grouping.groups].sort(
    (a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance],
  );
  return { groups, ungrouped: grouping.ungrouped };
}

/** Fallback grouping when Claude is unavailable: one group holding everything. */
export function fallbackGrouping(diff: ParsedDiff): Grouping {
  const hunks: string[] = [];
  for (const f of diff.files) for (const h of f.hunks) hunks.push(`${f.path}:${h.id}`);
  return {
    groups: [
      {
        title: "All changes",
        importance: "medium",
        summary: "Automatic grouping was unavailable; showing all changes together.",
        hunks,
      },
    ],
    ungrouped: [],
  };
}
