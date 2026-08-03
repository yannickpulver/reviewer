import { AlertTriangle, Check, ExternalLink } from "lucide-react";
import type { Flag, Group, PullMeta, ResolvedHunk } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { blocksForRefs } from "@/lib/diff";
import { fileUrl } from "@/lib/links";
import { cn } from "@/lib/utils";
import { DiffView, type ArchitectApi, type CommentsApi, type ExistingLookup } from "./DiffView";

interface Props {
  section: Group;
  meta: PullMeta;
  index: Map<string, ResolvedHunk>;
  comments: CommentsApi;
  existing: ExistingLookup;
  architect: ArchitectApi;
  reactionsSupported: boolean;
  reviewed: boolean;
  onToggleReviewed: () => void;
}

export function SectionContent({
  section,
  meta,
  index,
  comments,
  existing,
  architect,
  reactionsSupported,
  reviewed,
  onToggleReviewed,
}: Props) {
  const blocks = blocksForRefs(section.hunks, index);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-6 space-y-2 border-b bg-background px-6 pb-3 pt-6">
        <div className="flex items-center gap-2">
          <Badge variant={section.importance}>{section.importance}</Badge>
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <Button
            variant={reviewed ? "default" : "outline"}
            size="sm"
            className={cn("ml-auto", reviewed && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={onToggleReviewed}
          >
            <Check className="size-4" />
            {reviewed ? "Reviewed" : "Mark as reviewed"}
          </Button>
        </div>
        {section.summary && (
          <p className="text-sm text-muted-foreground">{section.summary}</p>
        )}
      </div>

      {blocks.map((block, i) => {
        const href = fileUrl(meta, block.path);
        const blockRefs = new Set(block.hunks.map((h) => `${block.path}:${h.id}`));
        const flags = section.flags.filter((f) => blockRefs.has(f.hunk));
        return (
          <div key={`${block.path}-${i}`} className="space-y-1">
            {flags.length > 0 && <FlagCallout flags={flags} />}
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {block.path}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <div className="font-mono text-xs text-muted-foreground">{block.path}</div>
            )}
            <DiffView
              path={block.path}
              hunks={block.hunks}
              comments={comments}
              existing={existing}
              architect={architect}
              reactionsSupported={reactionsSupported}
            />
          </div>
        );
      })}
    </div>
  );
}

function FlagCallout({ flags }: { flags: Flag[] }) {
  const danger = flags.some((f) => f.severity === "danger");
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        danger
          ? "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200"
          : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
        <AlertTriangle className="size-3.5" />
        Reviewer flag{flags.length > 1 ? "s" : ""}
      </div>
      <ul className="space-y-0.5">
        {flags.map((f, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden>{f.severity === "danger" ? "🔴" : "🟡"}</span>
            <span>{f.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
