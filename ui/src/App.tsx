import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import type { Group, ReviewAction, ReviewComment, ReviewPayload } from "./types";
import { getReview, submitReview } from "./api";
import { indexHunks, lineKey } from "./lib/diff";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sidebar } from "./components/Sidebar";
import { SectionContent } from "./components/SectionContent";
import type { CommentsApi, ExistingLookup } from "./components/DiffView";

export function App() {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, ReviewComment>>({});
  const [active, setActive] = useState(0);
  const [summary, setSummary] = useState("");
  const [action, setAction] = useState<ReviewAction>("comment");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    getReview().then(setPayload).catch((e) => setError(e.message));
  }, []);

  const commentsApi: CommentsApi = useMemo(
    () => ({
      get: (path, line) => comments[lineKey(path, line)]?.body,
      save: (path, line, body) =>
        setComments((prev) => ({ ...prev, [lineKey(path, line)]: { path, line, body } })),
      remove: (path, line) =>
        setComments((prev) => {
          const next = { ...prev };
          delete next[lineKey(path, line)];
          return next;
        }),
    }),
    [comments],
  );

  const index = useMemo(() => (payload ? indexHunks(payload.files) : new Map()), [payload]);

  const existingByLine = useMemo(() => {
    const m = new Map<string, ReviewPayload["existingComments"]>();
    for (const c of payload?.existingComments ?? []) {
      const k = lineKey(c.path, c.line);
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return m;
  }, [payload]);

  const existingLookup: ExistingLookup = (path, line) =>
    existingByLine.get(lineKey(path, line)) ?? [];

  const sections: Group[] = useMemo(() => {
    if (!payload) return [];
    const list = [...payload.grouping.groups];
    if (payload.grouping.ungrouped.length > 0) {
      list.push({
        title: "Ungrouped",
        importance: "low",
        summary: "Changes not assigned to a group.",
        hunks: payload.grouping.ungrouped,
      });
    }
    return list;
  }, [payload]);

  const commentList = Object.values(comments);

  const sectionKeys = useMemo(
    () =>
      sections.map((s) => {
        const keys = new Set<string>();
        for (const ref of s.hunks) {
          const resolved = index.get(ref);
          if (!resolved) continue;
          for (const l of resolved.hunk.lines) {
            if (l.newLineNo !== null) keys.add(lineKey(resolved.path, l.newLineNo));
          }
        }
        return keys;
      }),
    [sections, index],
  );

  const counts = sectionKeys.map(
    (keys) => commentList.filter((c) => keys.has(lineKey(c.path, c.line))).length,
  );

  const existingCounts = useMemo(
    () =>
      sectionKeys.map(
        (keys) =>
          (payload?.existingComments ?? []).filter((c) => keys.has(lineKey(c.path, c.line))).length,
      ),
    [sectionKeys, payload],
  );

  async function doSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { url } = await submitReview(commentList, summary, action);
      setSubmitted(url);
      setConfirming(false);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!payload) {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin" /> Loading review…
      </Centered>
    );
  }

  const current = sections[active];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        meta={payload.meta}
        sections={sections}
        active={active}
        counts={counts}
        existingCounts={existingCounts}
        onSelect={setActive}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {current ? (
            <SectionContent
              section={current}
              index={index}
              comments={commentsApi}
              existing={existingLookup}
            />
          ) : (
            <p className="text-muted-foreground">No changes.</p>
          )}
        </div>

        <SubmitBar
          count={commentList.length}
          onSubmit={() => setConfirming(true)}
          submitted={submitted}
        />
      </main>

      {confirming && (
        <ConfirmDialog
          count={commentList.length}
          summary={summary}
          setSummary={setSummary}
          action={action}
          setAction={setAction}
          submitting={submitting}
          error={submitError}
          onConfirm={doSubmit}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function SubmitBar({
  count,
  onSubmit,
  submitted,
}: {
  count: number;
  onSubmit: () => void;
  submitted: string | null;
}) {
  return (
    <div className="border-t bg-background/95 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        {submitted ? (
          <a
            href={submitted}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-emerald-600 hover:underline"
          >
            <CheckCircle2 className="size-4" /> Review submitted — view on host
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              {count} pending comment{count === 1 ? "" : "s"}
            </span>
            <Button className="ml-auto" onClick={onSubmit}>
              Submit review
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const ACTIONS: { value: ReviewAction; label: string; hint: string }[] = [
  { value: "comment", label: "Comment", hint: "Leave feedback without an explicit verdict." },
  { value: "approve", label: "Approve", hint: "Approve the changes." },
  { value: "request_changes", label: "Request changes", hint: "Ask for changes before merge." },
];

function ConfirmDialog({
  count,
  summary,
  setSummary,
  action,
  setAction,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  count: number;
  summary: string;
  setSummary: (s: string) => void;
  action: ReviewAction;
  setAction: (a: ReviewAction) => void;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // A plain "comment" review needs at least one comment or a summary.
  const blocked = action === "comment" && count === 0 && !summary.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Submit review</h2>
        <p className="text-sm text-muted-foreground">
          {count} inline comment{count === 1 ? "" : "s"} will be posted as a single review.
        </p>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Verdict</label>
          <div className="grid grid-cols-3 gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.value}
                onClick={() => setAction(a.value)}
                className={cn(
                  "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                  action === a.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {ACTIONS.find((a) => a.value === action)!.hint}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Overall summary (optional)</label>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Summary comment for the whole review…"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting || blocked}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {ACTIONS.find((a) => a.value === action)!.label}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
      {children}
    </div>
  );
}
