import { useMemo, useState } from "react";
import {
  ChevronRight,
  MessageSquarePlus,
  Pencil,
  SmilePlus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  ArchitectFinding,
  ArchitectSeverity,
  DiffLine,
  ExistingComment,
  Hunk,
  Reaction,
} from "@/types";
import { toggleReaction } from "@/api";
import { cn } from "@/lib/utils";
import { hunkToText, lineKey } from "@/lib/diff";
import { highlightBlock, langForPath } from "@/lib/highlight";
import { Button } from "@/components/ui/button";
import { AskBox } from "./AskBox";
import { CommentEditor } from "./CommentEditor";
import { Markdown } from "./Markdown";

export interface CommentsApi {
  get: (path: string, line: number) => string | undefined;
  save: (path: string, line: number, body: string) => void;
  remove: (path: string, line: number) => void;
}

/** Read-only existing comments looked up by new-side line. */
export type ExistingLookup = (path: string, line: number) => ExistingComment[];

/** An architect finding tagged with a stable id (its index in the review). */
export interface ArchitectFindingView extends ArchitectFinding {
  id: number;
}

export interface ArchitectApi {
  get: (path: string, line: number) => ArchitectFindingView[];
  /** Turn a finding into a draft comment at its path/line, then hide the card. */
  adopt: (finding: ArchitectFindingView) => void;
  /** Hide the card without adopting it. */
  dismiss: (finding: ArchitectFindingView) => void;
}

interface Props {
  path: string;
  hunks: Hunk[];
  comments: CommentsApi;
  existing: ExistingLookup;
  architect: ArchitectApi;
  reactionsSupported: boolean;
}

function toggler(setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
  return (key: string, on: boolean) =>
    setter((prev) => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });
}

export function DiffView({
  path,
  hunks,
  comments,
  existing,
  architect,
  reactionsSupported,
}: Props) {
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<Set<string>>(new Set());

  const toggleEditing = toggler(setEditing);
  const toggleAsking = toggler(setAsking);
  const lang = useMemo(() => langForPath(path), [path]);

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {hunks.map((hunk, hi) => (
            <HunkRows
              key={hunk.id}
              path={path}
              hunk={hunk}
              lang={lang}
              showSep={hi > 0}
              editing={editing}
              toggleEditing={toggleEditing}
              asking={asking}
              toggleAsking={toggleAsking}
              comments={comments}
              existing={existing}
              architect={architect}
              reactionsSupported={reactionsSupported}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HunkRows({
  path,
  hunk,
  lang,
  showSep,
  editing,
  toggleEditing,
  asking,
  toggleAsking,
  comments,
  existing,
  architect,
  reactionsSupported,
}: {
  path: string;
  hunk: Hunk;
  lang: string | null;
  showSep: boolean;
  editing: Set<string>;
  toggleEditing: (key: string, on: boolean) => void;
  asking: Set<string>;
  toggleAsking: (key: string, on: boolean) => void;
  comments: CommentsApi;
  existing: ExistingLookup;
  architect: ArchitectApi;
  reactionsSupported: boolean;
}) {
  const hunkText = hunkToText(hunk);
  const htmlLines = useMemo(
    () => highlightBlock(hunk.lines.map((l) => l.content).join("\n"), lang),
    [hunk, lang],
  );
  return (
    <>
      <tr className={cn("text-muted-foreground", showSep && "border-t")}>
        <td colSpan={4} className="bg-muted/40 px-3 py-1 select-none">
          {hunk.header}
        </td>
      </tr>
      {hunk.lines.map((line, i) => (
        <LineRow
          key={i}
          path={path}
          line={line}
          html={htmlLines[i] ?? ""}
          hunkText={hunkText}
          editing={editing}
          toggleEditing={toggleEditing}
          asking={asking}
          toggleAsking={toggleAsking}
          comments={comments}
          existing={existing}
          architect={architect}
          reactionsSupported={reactionsSupported}
        />
      ))}
    </>
  );
}

function LineRow({
  path,
  line,
  html,
  hunkText,
  editing,
  toggleEditing,
  asking,
  toggleAsking,
  comments,
  existing,
  architect,
  reactionsSupported,
}: {
  path: string;
  line: DiffLine;
  html: string;
  hunkText: string;
  editing: Set<string>;
  toggleEditing: (key: string, on: boolean) => void;
  asking: Set<string>;
  toggleAsking: (key: string, on: boolean) => void;
  comments: CommentsApi;
  existing: ExistingLookup;
  architect: ArchitectApi;
  reactionsSupported: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  // Comments anchor to the new (right) side; deleted lines aren't commentable.
  const commentable = line.newLineNo !== null;
  const key = commentable ? lineKey(path, line.newLineNo!) : null;
  const draft = key ? comments.get(path, line.newLineNo!) : undefined;
  const priorComments = commentable ? existing(path, line.newLineNo!) : [];
  const findings = commentable ? architect.get(path, line.newLineNo!) : [];
  const isEditing = key ? editing.has(key) : false;
  const isAsking = key ? asking.has(key) : false;

  const rowBg =
    line.type === "add" ? "diff-add" : line.type === "del" ? "diff-del" : "";
  const gutterBg =
    line.type === "add" ? "diff-add-gutter" : line.type === "del" ? "diff-del-gutter" : "bg-muted/30";
  const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";

  return (
    <>
      <tr
        className={rowBg}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <td className={cn("w-12 select-none px-2 text-right text-muted-foreground", gutterBg)}>
          {line.oldLineNo ?? ""}
        </td>
        <td className={cn("w-12 select-none px-2 text-right text-muted-foreground", gutterBg)}>
          {line.newLineNo ?? ""}
        </td>
        <td className="w-10 select-none px-1 text-center text-muted-foreground">
          {commentable && key && hovered && (
            <div className="flex items-center justify-center gap-1">
              {!isEditing && (
                <button
                  aria-label="Add comment"
                  className="hover:text-foreground"
                  onClick={() => {
                    setHovered(false);
                    toggleEditing(key, true);
                  }}
                >
                  <MessageSquarePlus className="size-3.5" />
                </button>
              )}
              {!isAsking && (
                <button
                  aria-label="Ask Claude"
                  className="hover:text-foreground"
                  onClick={() => {
                    setHovered(false);
                    toggleAsking(key, true);
                  }}
                >
                  <Sparkles className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </td>
        <td className="whitespace-pre-wrap px-2 py-0.5">
          <span className="select-none text-muted-foreground">{sign}</span>
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </td>
      </tr>

      {priorComments.length > 0 && (
        <tr>
          <td colSpan={4} className="px-3 py-2">
            <div className="space-y-2 font-sans text-sm">
              {priorComments.filter((c) => !c.resolved).map((c, i) => (
                <ExistingCommentCard key={c.id ?? i} comment={c} reactions={reactionsSupported} />
              ))}
              <ResolvedComments
                comments={priorComments.filter((c) => c.resolved)}
                reactions={reactionsSupported}
              />
            </div>
          </td>
        </tr>
      )}

      {findings.length > 0 && (
        <tr>
          <td colSpan={4} className="px-3 py-2">
            <div className="space-y-2 font-sans text-sm">
              {findings.map((f) => (
                <ArchitectFindingCard
                  key={f.id}
                  finding={f}
                  onAdopt={() => architect.adopt(f)}
                  onDismiss={() => architect.dismiss(f)}
                />
              ))}
            </div>
          </td>
        </tr>
      )}

      {draft && key && !isEditing && (
        <tr>
          <td colSpan={4} className="px-3 py-2">
            <div className="rounded-md border bg-muted/30 p-3 font-sans text-sm">
              <div className="flex items-start gap-2">
                <Markdown className="flex-1">{draft}</Markdown>
                <button
                  aria-label="Edit comment"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => toggleEditing(key, true)}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  aria-label="Delete comment"
                  className="text-muted-foreground hover:text-red-400"
                  onClick={() => comments.remove(path, line.newLineNo!)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {isEditing && key && (
        <tr>
          <td colSpan={4}>
            <div className="border-y bg-muted/20 font-sans">
              <CommentEditor
                initial={draft}
                onSave={(body) => {
                  comments.save(path, line.newLineNo!, body);
                  toggleEditing(key, false);
                }}
                onCancel={() => toggleEditing(key, false)}
              />
            </div>
          </td>
        </tr>
      )}

      {isAsking && key && (
        <tr>
          <td colSpan={4}>
            <div className="border-y bg-muted/20">
              <AskBox
                path={path}
                line={line.newLineNo!}
                code={hunkText}
                onClose={() => toggleAsking(key, false)}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Severity → border/background classes. Shared with Sidebar's findings list. */
export const SEVERITY_STYLES: Record<ArchitectSeverity, string> = {
  important: "border-red-500/30 bg-red-500/10",
  design: "border-purple-500/30 bg-purple-500/10",
  nit: "border-zinc-500/30 bg-zinc-500/10",
  "pre-existing": "border-amber-500/30 bg-amber-500/10",
};

/** Severity → display label. Shared with Sidebar's findings list. */
export const SEVERITY_LABELS: Record<ArchitectSeverity, string> = {
  important: "Important",
  design: "Design",
  nit: "Nit",
  "pre-existing": "Pre-existing",
};

export function ArchitectFindingCard({
  finding,
  onAdopt,
  onDismiss,
}: {
  finding: ArchitectFindingView;
  onAdopt: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      id={`finding-${finding.id}`}
      className={cn(
        "space-y-2 rounded-md border p-3 transition-shadow duration-700",
        SEVERITY_STYLES[finding.severity],
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded border border-foreground/10 bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {SEVERITY_LABELS[finding.severity]}
        </span>
        <div className="flex-1 space-y-1">
          <p>{finding.comment}</p>
          {finding.fix && (
            <p className="text-muted-foreground">
              <span className="font-medium">Fix: </span>
              {finding.fix}
            </p>
          )}
        </div>
        <button
          aria-label="Dismiss finding"
          className="text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onAdopt}>
          <Sparkles className="size-3.5" /> Add to review
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function ExistingCommentCard({
  comment,
  reactions,
  muted,
}: {
  comment: ExistingComment;
  reactions: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed bg-muted/20 p-3",
        muted && "opacity-70",
      )}
    >
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {comment.author}
      </div>
      <Markdown>{comment.body}</Markdown>
      {reactions && <ReactionBar comment={comment} />}
    </div>
  );
}

function ResolvedComments({
  comments,
  reactions,
}: {
  comments: ExistingComment[];
  reactions: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (comments.length === 0) return null;
  return (
    <div className="space-y-2">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {comments.length} resolved comment{comments.length === 1 ? "" : "s"}
      </button>
      {open &&
        comments.map((c, i) => (
          <ExistingCommentCard key={c.id ?? i} comment={c} reactions={reactions} muted />
        ))}
    </div>
  );
}

/** The eight reactions GitHub/GitLab both support, in GitHub's order. */
const REACTION_EMOJI: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

function ReactionBar({ comment }: { comment: ExistingComment }) {
  const [reactions, setReactions] = useState<Reaction[]>(comment.reactions ?? []);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const toggle = async (content: string) => {
    if (busy) return;
    const existing = reactions.find((r) => r.content === content);
    const remove = !!existing?.viewerReacted;
    const before = reactions;
    setReactions(optimistic(before, content, remove));
    setBusy(true);
    setPicking(false);
    try {
      setReactions(await toggleReaction(comment.id, content, remove));
    } catch {
      setReactions(before);
    } finally {
      setBusy(false);
    }
  };

  const shown = reactions.filter((r) => r.count > 0);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {shown.map((r) => (
        <button
          key={r.content}
          disabled={busy}
          onClick={() => toggle(r.content)}
          title={r.content}
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:opacity-50",
            r.viewerReacted
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          <span>{REACTION_EMOJI[r.content] ?? r.content}</span>
          <span className="text-muted-foreground">{r.count}</span>
        </button>
      ))}
      <button
        aria-label="Add reaction"
        disabled={busy}
        onClick={() => setPicking((p) => !p)}
        className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <SmilePlus className="size-3.5" />
      </button>
      {picking && (
        <div className="flex items-center gap-0.5 rounded-full border bg-background px-1 py-0.5">
          {Object.entries(REACTION_EMOJI).map(([content, emoji]) => (
            <button
              key={content}
              disabled={busy}
              title={content}
              onClick={() => toggle(content)}
              className="rounded-full px-1 text-sm hover:bg-muted disabled:opacity-50"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Local tally update applied before the server confirms. */
function optimistic(reactions: Reaction[], content: string, remove: boolean): Reaction[] {
  const existing = reactions.find((r) => r.content === content);
  if (!existing) return [...reactions, { content, count: 1, viewerReacted: true }];
  return reactions
    .map((r) =>
      r.content === content
        ? { ...r, count: r.count + (remove ? -1 : 1), viewerReacted: !remove }
        : r,
    )
    .filter((r) => r.count > 0);
}
