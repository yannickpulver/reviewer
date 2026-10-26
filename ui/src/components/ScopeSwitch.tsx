import { History, Loader2 } from "lucide-react";
import type { DiffScope, LastReview } from "@/types";
import { cn, timeAgo } from "@/lib/utils";

interface Props {
  scope: DiffScope;
  lastReview: LastReview;
  headSha: string;
  /** Set while a switch runs. */
  switching: boolean;
  /** Why switching is unavailable right now, if it is. */
  blocked?: string;
  error?: string | null;
  onChange: (scope: DiffScope) => void;
}

/** "All changes" vs. "Since your review", like GitHub's changes-since-last-review. */
export function ScopeSwitch({ scope, lastReview, headSha, switching, blocked, error, onChange }: Props) {
  const age = timeAgo(lastReview.submittedAt);
  if (lastReview.sha === headSha) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <History className="size-3" /> No new commits since your review {age} ago
      </p>
    );
  }

  const options: { value: DiffScope; label: string }[] = [
    { value: "full", label: "All changes" },
    { value: "since-last-review", label: `Since review · ${age}` },
  ];
  return (
    <div className="space-y-1 pt-1">
      <div className="flex rounded-md border p-0.5 text-xs" title={blocked ?? `You reviewed this ${age} ago`}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={switching || !!blocked || o.value === scope}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded px-2 py-1 transition-colors",
              o.value === scope
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground",
              (switching || blocked) && o.value !== scope && "opacity-50",
            )}
          >
            {switching && o.value !== scope && <Loader2 className="size-3 animate-spin" />}
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
