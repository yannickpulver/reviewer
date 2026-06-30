import { Check } from "lucide-react";
import type { Group, ResolvedHunk } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { blocksForRefs } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { DiffView, type CommentsApi, type ExistingLookup } from "./DiffView";

interface Props {
  section: Group;
  index: Map<string, ResolvedHunk>;
  comments: CommentsApi;
  existing: ExistingLookup;
  reviewed: boolean;
  onToggleReviewed: () => void;
}

export function SectionContent({
  section,
  index,
  comments,
  existing,
  reviewed,
  onToggleReviewed,
}: Props) {
  const blocks = blocksForRefs(section.hunks, index);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
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

      {blocks.map((block, i) => (
        <div key={`${block.path}-${i}`} className="space-y-1">
          <div className="font-mono text-xs text-muted-foreground">{block.path}</div>
          <DiffView path={block.path} hunks={block.hunks} comments={comments} existing={existing} />
        </div>
      ))}
    </div>
  );
}
