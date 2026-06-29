export type Importance = "high" | "medium" | "low";

export interface Group {
  title: string;
  importance: Importance;
  summary: string;
  /** Hunk refs ("file:Hn") belonging to this group */
  hunks: string[];
}

export interface Grouping {
  groups: Group[];
  /** Hunk refs not assigned to any group */
  ungrouped: string[];
}
