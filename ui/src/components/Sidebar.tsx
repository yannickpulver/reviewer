import { CheckCircle2, GitPullRequest, History, Loader2, MessageSquare, Sparkles } from "lucide-react";
import type { ArchitectReview, DiffScope, Group, PullMeta, PullState } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArchitectFindingView } from "./DiffView";

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
  diffScope: DiffScope;
  sections: Group[];
  active: number;
  counts: number[];
  existingCounts: number[];
  reviewed: Set<number>;
  onSelect: (index: number) => void;
  architect: ArchitectState;
  onRunArchitectReview: (force?: boolean) => void;
  unanchoredFindings: ArchitectFindingView[];
}

export function Sidebar({
  meta,
  diffScope,
  sections,
  active,
  counts,
  existingCounts,
  reviewed,
  onSelect,
  architect,
  onRunArchitectReview,
  unanchoredFindings,
}: Props) {
  return (
    <aside className="flex h-screen w-80 shrink-0 flex-col border-r bg-card">
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
        </div>
        <h1 className="text-sm font-semibold leading-snug">{meta.title}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {meta.headRef} → {meta.baseRef}
        </p>
        {diffScope === "since-last-review" && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <History className="size-3" /> since your last review
          </p>
        )}
      </div>

      <div className="border-b px-2 py-2">
        <ArchitectReviewButton state={architect} onRun={onRunArchitectReview} />
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {sections.map((s, i) => {
          const isReviewed = reviewed.has(i);
          return (
            <button
              key={`${s.title}-${i}`}
              onClick={() => onSelect(i)}
              className={cn(
                "mb-1 w-full rounded-md px-3 py-2 text-left transition-colors",
                i === active ? "bg-muted" : "hover:bg-muted/60",
                isReviewed && i !== active && "opacity-50",
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

        {unanchoredFindings.length > 0 && (
          <div className="mt-2 space-y-1 border-t px-1 pt-2">
            <p className="px-2 text-xs font-medium text-muted-foreground">
              Other findings (couldn't anchor to a diff line)
            </p>
            {unanchoredFindings.map((f) => (
              <div key={f.id} className="rounded-md border bg-muted/20 px-2 py-1.5 text-xs">
                <div className="font-mono text-muted-foreground">
                  {f.path}:{f.line}
                </div>
                <div>{f.comment}</div>
              </div>
            ))}
          </div>
        )}
      </nav>
    </aside>
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
      <button
        onClick={() => onRun(true)}
        title="Click to re-run"
        className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
      >
        {clean ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : (
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", clean && "text-emerald-700")}>
          {clean ? "No issues found" : state.review.summary}
        </span>
      </button>
    );
  }

  return (
    <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onRun()}>
      <Sparkles className="size-4" /> Claude review
    </Button>
  );
}
