import { GitPullRequest, MessageSquare } from "lucide-react";
import type { Group, PullMeta } from "@/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  meta: PullMeta;
  sections: Group[];
  active: number;
  counts: number[];
  existingCounts: number[];
  onSelect: (index: number) => void;
}

export function Sidebar({ meta, sections, active, counts, existingCounts, onSelect }: Props) {
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
        </div>
        <h1 className="text-sm font-semibold leading-snug">{meta.title}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {meta.headRef} → {meta.baseRef}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {sections.map((s, i) => (
          <button
            key={`${s.title}-${i}`}
            onClick={() => onSelect(i)}
            className={cn(
              "mb-1 w-full rounded-md px-3 py-2 text-left transition-colors",
              i === active ? "bg-muted" : "hover:bg-muted/60",
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
              </div>
            </div>
            <div className="mt-1 truncate text-sm font-medium">{s.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {s.hunks.length} hunk{s.hunks.length === 1 ? "" : "s"}
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
