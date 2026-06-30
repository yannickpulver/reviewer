import { CheckCircle2, GitPullRequest, MessageSquare } from "lucide-react";
import type { Group, PullMeta, PullState } from "@/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<PullState, string> = {
  open: "border-transparent bg-emerald-500/15 text-emerald-700",
  draft: "border-transparent bg-zinc-500/15 text-zinc-600",
  merged: "border-transparent bg-violet-500/15 text-violet-700",
  closed: "border-transparent bg-red-500/15 text-red-700",
};

interface Props {
  meta: PullMeta;
  sections: Group[];
  active: number;
  counts: number[];
  existingCounts: number[];
  reviewed: Set<number>;
  onSelect: (index: number) => void;
}

export function Sidebar({
  meta,
  sections,
  active,
  counts,
  existingCounts,
  reviewed,
  onSelect,
}: Props) {
  return (
    <aside className="flex h-screen w-80 shrink-0 flex-col border-r bg-card">
      <div className="space-y-1 border-b px-4 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitPullRequest className="size-3.5" />
          <a href={meta.url} target="_blank" rel="noreferrer" className="hover:underline">
            {meta.host} #{meta.id}
          </a>
          <span>·</span>
          <span>{meta.author}</span>
          <Badge className={cn("ml-auto capitalize", STATE_STYLES[meta.state])}>
            {meta.state}
          </Badge>
        </div>
        <h1 className="text-sm font-semibold leading-snug">{meta.title}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {meta.headRef} → {meta.baseRef}
        </p>
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
      </nav>
    </aside>
  );
}
