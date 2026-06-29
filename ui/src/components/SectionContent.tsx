import type { Group, ResolvedHunk } from "@/types";
import { Badge } from "@/components/ui/badge";
import { blocksForRefs } from "@/lib/diff";
import { DiffView, type CommentsApi, type ExistingLookup } from "./DiffView";

interface Props {
  section: Group;
  index: Map<string, ResolvedHunk>;
  comments: CommentsApi;
  existing: ExistingLookup;
}

export function SectionContent({ section, index, comments, existing }: Props) {
  const blocks = blocksForRefs(section.hunks, index);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant={section.importance}>{section.importance}</Badge>
          <h2 className="text-xl font-semibold">{section.title}</h2>
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
