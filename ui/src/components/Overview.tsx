import { ArrowRight, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import type { Group, PullMeta } from "@/types";
import { useApi } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cleanDescription, descriptionUrl } from "@/lib/links";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

interface Props {
  meta: PullMeta;
  /** "All changes" vs. "Since your review", when you reviewed before. */
  scopeSwitch?: React.ReactNode;
  sections: Group[];
  groupingPending: boolean;
  reviewed: Set<number>;
  onSelect: (index: number) => void;
}

/** First page of a review: the PR/MR description and the groups to go through. */
export function Overview({ meta, scopeSwitch, sections, groupingPending, reviewed, onSelect }: Props) {
  const api = useApi();
  const description = cleanDescription(meta.description).trim();

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-6 space-y-1 border-b bg-background px-6 pb-3 pt-6">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">{meta.title}</h2>
          {sections.length > 0 && (
            <Button size="sm" className="ml-auto shrink-0" onClick={() => onSelect(0)}>
              Start review <ArrowRight className="size-4" />
              <kbd className="ml-1 text-[10px] opacity-70">m</kbd>
            </Button>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {meta.author}
          <span>·</span>
          <span className="font-mono text-xs">
            {meta.headRef} → {meta.baseRef}
          </span>
          {meta.url && (
            <a
              href={meta.url}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              {meta.host} #{meta.id} <ExternalLink className="size-3" />
            </a>
          )}
        </p>
        {scopeSwitch && <div className="max-w-sm">{scopeSwitch}</div>}
      </div>

      {description ? (
        <Markdown
          html
          className="max-w-4xl text-sm"
          imageSrc={(src) => api.imageUrl(descriptionUrl(meta, src))}
          linkHref={(href) => (href.startsWith("#") ? href : descriptionUrl(meta, href))}
        >
          {description}
        </Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">
          {meta.host === "local" ? "Local branch — no description." : "No description provided."}
        </p>
      )}

      <div className="max-w-4xl space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Groups
          {groupingPending && (
            <span className="flex items-center gap-1 font-normal text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Grouping with Claude…
            </span>
          )}
        </h3>
        {sections.map((s, i) => (
          <button
            key={`${s.title}-${i}`}
            onClick={() => onSelect(i)}
            className={cn(
              "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/60",
              reviewed.has(i) && "opacity-50",
            )}
          >
            <Badge variant={s.importance} className="mt-0.5 shrink-0">
              {s.importance}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium", reviewed.has(i) && "line-through")}>
                {s.title}
              </div>
              {s.summary && <p className="text-xs text-muted-foreground">{s.summary}</p>}
            </div>
            {reviewed.has(i) && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
          </button>
        ))}
      </div>
    </div>
  );
}
