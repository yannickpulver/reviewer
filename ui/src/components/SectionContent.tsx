import { Check, ExternalLink } from "lucide-react";
import type { Group, PullMeta, ResolvedHunk } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { blocksForRefs, type FileBlock } from "@/lib/diff";
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

/** DOM id of a file block, so the sidebar can scroll to it. */
export function fileBlockId(path: string): string {
  return `file-${encodeURIComponent(path)}`;
}

interface FileBlocksProps {
  blocks: FileBlock[];
  meta: PullMeta;
  comments: CommentsApi;
  existing: ExistingLookup;
  architect: ArchitectApi;
  reactionsSupported: boolean;
}

/** The per-file diff list: a linked file header plus its hunks. */
export function FileBlocks({
  blocks,
  meta,
  comments,
  existing,
  architect,
  reactionsSupported,
}: FileBlocksProps) {
  return (
    <>
      {blocks.map((block, i) => {
        const href = fileUrl(meta, block.path);
        return (
          <div
            key={`${block.path}-${i}`}
            id={fileBlockId(block.path)}
            className="space-y-1 scroll-mt-24"
          >
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
    </>
  );
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
            title="Mark as reviewed and go to the next group (m)"
          >
            <Check className="size-4" />
            {reviewed ? "Reviewed" : "Mark as reviewed"}
          </Button>
        </div>
        {section.summary && (
          <p className="text-sm text-muted-foreground">{section.summary}</p>
        )}
      </div>

      <FileBlocks
        blocks={blocks}
        meta={meta}
        comments={comments}
        existing={existing}
        architect={architect}
        reactionsSupported={reactionsSupported}
      />
    </div>
  );
}
