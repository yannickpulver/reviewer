import { Search } from "lucide-react";
import type { PullMeta, ResolvedHunk } from "@/types";
import { blocksForRefs, type SearchHit } from "@/lib/diff";
import { FileBlocks } from "./SectionContent";
import type { ArchitectApi, CommentsApi, ExistingLookup } from "./DiffView";

interface Props {
  query: string;
  results: SearchHit[];
  meta: PullMeta;
  index: Map<string, ResolvedHunk>;
  comments: CommentsApi;
  existing: ExistingLookup;
  architect: ArchitectApi;
  reactionsSupported: boolean;
}

/** Every file matching the search query, ignoring Claude's grouping. */
export function SearchContent({
  query,
  results,
  meta,
  index,
  comments,
  existing,
  architect,
  reactionsSupported,
}: Props) {
  const refs = results.flatMap((r) => r.refs);
  const blocks = blocksForRefs(refs, index);
  const lines = results.reduce((sum, r) => sum + r.matches, 0);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-6 space-y-2 border-b bg-background px-6 pb-3 pt-6">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold">“{query}”</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {results.length} file{results.length === 1 ? "" : "s"} · {lines} matching line
          {lines === 1 ? "" : "s"}
        </p>
      </div>

      {results.length === 0 ? (
        <p className="text-muted-foreground">No files match.</p>
      ) : (
        <FileBlocks
          blocks={blocks}
          meta={meta}
          comments={comments}
          existing={existing}
          architect={architect}
          reactionsSupported={reactionsSupported}
        />
      )}
    </div>
  );
}
