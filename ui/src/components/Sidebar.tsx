import {
  CheckCircle2,
  FileText,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type {
  ArchitectReview,
  Group,
  PullMeta,
  PullState,
  RefreshSummary,
  ReviewAction,
} from "@/types";
import type { SearchHit } from "@/lib/diff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SEVERITY_LABELS, SEVERITY_STYLES, type ArchitectFindingView } from "./DiffView";

const VERDICT_BADGES: Record<ReviewAction, { label: string; className: string }> = {
  approve: { label: "Approved", className: "border-transparent bg-emerald-500/15 text-emerald-700" },
  request_changes: { label: "Changes requested", className: "border-transparent bg-amber-500/15 text-amber-700" },
  comment: { label: "Commented", className: "border-transparent bg-zinc-500/15 text-zinc-600" },
};

const STATE_STYLES: Record<PullState, string> = {
  open: "border-transparent bg-emerald-500/15 text-emerald-700",
  draft: "border-transparent bg-zinc-500/15 text-zinc-600",
  merged: "border-transparent bg-violet-500/15 text-violet-700",
  closed: "border-transparent bg-red-500/15 text-red-700",
};

/** Client-side state machine for the "Claude review" action. */
export type ArchitectState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; review: ArchitectReview };

interface Props {
  meta: PullMeta;
  /** "All changes" vs. "Since your review", when you reviewed before. */
  scopeSwitch?: React.ReactNode;
  sections: Group[];
  /** True while Claude is still grouping and `sections` is only the fallback. */
  groupingPending: boolean;
  /** Verdict of the review submitted in this session, once there is one. */
  verdict: ReviewAction | null;
  active: number;
  counts: number[];
  existingCounts: number[];
  reviewed: Set<number>;
  onSelect: (index: number) => void;
  /** True while the overview page is shown instead of a section. */
  overview: boolean;
  onShowOverview: () => void;
  architect: ArchitectState;
  onRunArchitectReview: (force?: boolean) => void;
  liveFindings: ArchitectFindingView[];
  onSelectFinding: (finding: ArchitectFindingView) => void;
  /** Result of the last refresh, or undefined before the first one. */
  refresh?: RefreshSummary;
  refreshing: boolean;
  refreshError: string | null;
  onRefresh: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** Files matching `search`; replaces the section list while the query is set. */
  searchResults: SearchHit[];
  onSelectFile: (path: string) => void;
  searchRef: React.Ref<HTMLInputElement>;
}

export function Sidebar({
  meta,
  scopeSwitch,
  sections,
  groupingPending,
  verdict,
  active,
  counts,
  existingCounts,
  reviewed,
  onSelect,
  overview,
  onShowOverview,
  architect,
  onRunArchitectReview,
  liveFindings,
  onSelectFinding,
  refresh,
  refreshing,
  refreshError,
  onRefresh,
  search,
  onSearchChange,
  searchResults,
  onSelectFile,
  searchRef,
}: Props) {
  const searching = search.trim().length > 0;
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r bg-card">
      <div className="space-y-1 border-b px-4 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitPullRequest className="size-3.5" />
          {meta.host === "local" ? (
            <span>local</span>
          ) : (
            <a href={meta.url} target="_blank" rel="noreferrer" className="hover:underline">
              {meta.host} #{meta.id}
            </a>
          )}
          <span>·</span>
          <span>{meta.author}</span>
          <Badge className={cn("ml-auto capitalize", STATE_STYLES[meta.state])}>
            {meta.host === "local" ? "branch" : meta.state}
          </Badge>
          {verdict && (
            <Badge className={VERDICT_BADGES[verdict].className}>
              {VERDICT_BADGES[verdict].label}
            </Badge>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Pull in changes made since this review started (r)"
            className="-mr-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
        <h1 className="text-sm font-semibold leading-snug">{meta.title}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {meta.headRef} → {meta.baseRef}
        </p>
        {scopeSwitch}
        {refreshError ? (
          <p className="text-xs text-red-600">{refreshError}</p>
        ) : (
          refresh && <p className="text-xs text-muted-foreground">{describeRefresh(refresh)}</p>
        )}
      </div>

      <div className="space-y-2 border-b px-2 py-2">
        <ArchitectReviewButton state={architect} onRun={onRunArchitectReview} />
        {architect.status === "done" && architect.review.verdict === "issues" && (
          liveFindings.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">All findings handled.</p>
          ) : (
            <div className="space-y-1.5">
              {liveFindings.map((f) => (
                <FindingRow
                  key={f.id}
                  finding={f}
                  onClick={f.anchored ? () => onSelectFinding(f) : undefined}
                />
              ))}
            </div>
          )
        )}
      </div>

      <div className="border-b px-2 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              onSearchChange("");
              e.currentTarget.blur();
            }}
            placeholder="Search files and changes…"
            className="h-8 w-full rounded-md border bg-background pl-7 pr-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              title="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {searching ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>
          ) : (
            searchResults.map((hit) => (
              <button
                key={hit.path}
                onClick={() => onSelectFile(hit.path)}
                className="mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60"
              >
                <span className="truncate font-mono text-xs" title={hit.path}>
                  {hit.path}
                </span>
                <Badge variant="outline" className="ml-auto shrink-0">
                  {hit.matches > 0 ? hit.matches : "path"}
                </Badge>
              </button>
            ))
          )
        ) : (
          <>
            <button
              onClick={onShowOverview}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                overview ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <FileText className="size-3.5 text-muted-foreground" />
              Overview
            </button>
            {groupingPending && (
              <div className="mb-1 flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                Grouping with Claude…
              </div>
            )}
            {sections.map((s, i) => {
              const isReviewed = reviewed.has(i);
              return (
                <button
                  key={`${s.title}-${i}`}
                  onClick={() => onSelect(i)}
                  className={cn(
                    "mb-1 w-full rounded-md px-3 py-2 text-left transition-colors",
                    i === active && !overview ? "bg-muted" : "hover:bg-muted/60",
                    isReviewed && (i !== active || overview) && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={s.importance}>{s.importance}</Badge>
                    <div className="ml-auto flex items-center gap-1.5">
                      {existingCounts[i]! > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <MessageSquare className="size-3" />
                          {existingCounts[i]}
                        </span>
                      )}
                      {counts[i]! > 0 && <Badge variant="outline">{counts[i]}</Badge>}
                      {isReviewed && <CheckCircle2 className="size-3.5 text-emerald-600" />}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "mt-1 truncate text-sm font-medium",
                      isReviewed && "line-through",
                    )}
                  >
                    {s.title}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.hunks.length} hunk{s.hunks.length === 1 ? "" : "s"}
                  </div>
                </button>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}

/** One line summarising what the last refresh brought in. */
function describeRefresh(r: RefreshSummary): string {
  const parts: string[] = [
    r.source === "local"
      ? r.ahead > 0
        ? `local worktree, ${r.ahead} unpushed commit${r.ahead === 1 ? "" : "s"}`
        : "local worktree"
      : "from host",
  ];
  if (r.hunksChanged > 0) parts.push(`${r.hunksChanged} hunk${r.hunksChanged === 1 ? "" : "s"} updated`);
  if (r.hunksNew > 0) parts.push(`${r.hunksNew} new`);
  if (r.findingsStale > 0) parts.push(`${r.findingsStale} finding${r.findingsStale === 1 ? "" : "s"} likely fixed`);
  if (r.hunksChanged === 0 && r.hunksNew === 0) parts.push("no changes");
  return parts.join(" · ");
}

function FindingRow({
  finding,
  onClick,
}: {
  finding: ArchitectFindingView;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={cn(
        "w-full space-y-1 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
        clickable ? "hover:bg-muted/60" : "cursor-default opacity-70",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "shrink-0 rounded border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            SEVERITY_STYLES[finding.severity],
          )}
        >
          {SEVERITY_LABELS[finding.severity]}
        </span>
        <span className="truncate font-mono text-muted-foreground">
          {finding.path}:{finding.line}
        </span>
      </div>
      <p className={cn("line-clamp-2 text-foreground/90", finding.stale && "line-through")}>
        {finding.comment}
      </p>
      {finding.stale ? (
        <p className="text-[10px] text-emerald-700">code changed — may be fixed</p>
      ) : (
        !finding.anchored && <p className="text-[10px] text-muted-foreground">not in diff</p>
      )}
    </button>
  );
}

function ArchitectReviewButton({
  state,
  onRun,
}: {
  state: ArchitectState;
  onRun: (force?: boolean) => void;
}) {
  if (state.status === "loading") {
    return (
      <Button variant="outline" size="sm" disabled className="w-full justify-start gap-2">
        <Loader2 className="size-4 animate-spin" /> Reviewing…
      </Button>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-1.5">
        <p className="px-1 text-xs text-red-600">{state.message}</p>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onRun()}
        >
          <Sparkles className="size-4" /> Retry Claude review
        </Button>
      </div>
    );
  }

  if (state.status === "done") {
    const clean = state.review.verdict === "clean";
    return (
      <div className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm">
        {clean ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : (
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", clean && "text-emerald-700")}>
          {clean ? "No issues found" : state.review.summary}
        </span>
        <Button
          variant="ghost"
          size="icon"
          title="Re-run review"
          className="ml-auto size-6 shrink-0"
          onClick={() => onRun(true)}
        >
          <RotateCw className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onRun()}>
      <Sparkles className="size-4" /> Claude review
    </Button>
  );
}
