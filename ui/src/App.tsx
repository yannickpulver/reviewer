import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { QueueEntry } from "./types";
import { getQueue } from "./api";
import { cn } from "@/lib/utils";
import { Centered, Review } from "./Review";

/**
 * The queued reviews. The server preloads them in the background; a review
 * mounts on first visit and stays mounted, so drafts survive switching.
 */
export function App() {
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [visited, setVisited] = useState<number[]>([0]);

  // A queue keeps polling so the bar shows the reviews loading in the background.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const q = await getQueue();
        if (cancelled) return;
        setQueue(q);
        if (q.length > 1) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  function show(slot: number) {
    setCurrent(slot);
    setVisited((prev) => (prev.includes(slot) ? prev : [...prev, slot]));
  }

  /** The next review still waiting for a verdict, wrapping around the queue. */
  function nextAfter(slot: number): QueueEntry | undefined {
    const open = (queue ?? []).filter((e) => !e.submitted && e.slot !== slot);
    return open.find((e) => e.slot > slot) ?? open[0];
  }

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!queue) {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin" /> Loading review…
      </Centered>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {queue.length > 1 && <QueueBar queue={queue} current={current} onSelect={show} />}
      <div className="min-h-0 flex-1">
        {visited.map((slot) => {
          const next = nextAfter(slot);
          return (
            <div key={slot} className={slot === current ? "h-full" : "hidden"}>
              <Review
                slot={slot}
                visible={slot === current}
                onSubmitted={() => getQueue().then(setQueue, () => {})}
                onNext={next ? () => show(next.slot) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QueueBar({
  queue,
  current,
  onSelect,
}: {
  queue: QueueEntry[];
  current: number;
  onSelect: (slot: number) => void;
}) {
  const done = queue.filter((e) => e.submitted).length;
  return (
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-2 py-1.5">
      <span className="shrink-0 px-2 text-xs text-muted-foreground">
        {done}/{queue.length} reviewed
      </span>
      {queue.map((e) => (
        <button
          key={e.slot}
          type="button"
          onClick={() => onSelect(e.slot)}
          title={`${e.title} — ${e.author}`}
          className={cn(
            "flex max-w-64 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
            e.slot === current
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <QueueStatusIcon entry={e} />
          <span className="shrink-0">#{e.id}</span>
          <span className="truncate">{e.title}</span>
        </button>
      ))}
    </nav>
  );
}

function QueueStatusIcon({ entry }: { entry: QueueEntry }) {
  if (entry.submitted) return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />;
  switch (entry.status) {
    case "fetching":
      return <Loader2 className="size-3.5 shrink-0 animate-spin" />;
    case "grouping":
      return <Loader2 className="size-3.5 shrink-0 animate-spin opacity-50" />;
    case "error":
      return <AlertTriangle className="size-3.5 shrink-0 text-red-600" />;
    case "ready":
      return <Circle className="size-3.5 shrink-0" />;
  }
}
