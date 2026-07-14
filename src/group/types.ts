export type Importance = "high" | "medium" | "low";

export type FlagSeverity = "warning" | "danger";

/** A reviewer hint anchored to one hunk: something that may be wrong or needs attention. */
export interface Flag {
  /** Hunk ref ("file:Hn") this hint points at; must be one of the group's hunks. */
  hunk: string;
  severity: FlagSeverity;
  /** One sentence on what to look at and why. */
  note: string;
}

export interface Group {
  title: string;
  importance: Importance;
  summary: string;
  /** Hunk refs ("file:Hn") belonging to this group */
  hunks: string[];
  /** Reviewer-generated attention hints anchored to hunks in this group. */
  flags: Flag[];
}

export interface Grouping {
  groups: Group[];
  /** Hunk refs not assigned to any group */
  ungrouped: string[];
}
