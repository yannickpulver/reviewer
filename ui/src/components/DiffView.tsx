import { useState } from "react";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import type { DiffLine, Hunk } from "@/types";
import { cn } from "@/lib/utils";
import { lineKey } from "@/lib/diff";
import { CommentEditor } from "./CommentEditor";

export interface CommentsApi {
  get: (path: string, line: number) => string | undefined;
  save: (path: string, line: number, body: string) => void;
  remove: (path: string, line: number) => void;
}

interface Props {
  path: string;
  hunks: Hunk[];
  comments: CommentsApi;
}

export function DiffView({ path, hunks, comments }: Props) {
  const [editing, setEditing] = useState<Set<string>>(new Set());

  const toggle = (key: string, on: boolean) =>
    setEditing((prev) => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {hunks.map((hunk, hi) => (
            <HunkRows
              key={hunk.id}
              path={path}
              hunk={hunk}
              showSep={hi > 0}
              editing={editing}
              toggleEditing={toggle}
              comments={comments}
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
  showSep,
  editing,
  toggleEditing,
  comments,
}: {
  path: string;
  hunk: Hunk;
  showSep: boolean;
  editing: Set<string>;
  toggleEditing: (key: string, on: boolean) => void;
  comments: CommentsApi;
}) {
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
          editing={editing}
          toggleEditing={toggleEditing}
          comments={comments}
        />
      ))}
    </>
  );
}

function LineRow({
  path,
  line,
  editing,
  toggleEditing,
  comments,
}: {
  path: string;
  line: DiffLine;
  editing: Set<string>;
  toggleEditing: (key: string, on: boolean) => void;
  comments: CommentsApi;
}) {
  // Comments anchor to the new (right) side; deleted lines aren't commentable.
  const commentable = line.newLineNo !== null;
  const key = commentable ? lineKey(path, line.newLineNo!) : null;
  const existing = key ? comments.get(path, line.newLineNo!) : undefined;
  const isEditing = key ? editing.has(key) : false;

  const rowBg =
    line.type === "add" ? "diff-add" : line.type === "del" ? "diff-del" : "";
  const gutterBg =
    line.type === "add" ? "diff-add-gutter" : line.type === "del" ? "diff-del-gutter" : "bg-muted/30";
  const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";

  return (
    <>
      <tr className={cn("group", rowBg)}>
        <td className={cn("w-12 select-none px-2 text-right text-muted-foreground", gutterBg)}>
          {line.oldLineNo ?? ""}
        </td>
        <td className={cn("w-12 select-none px-2 text-right text-muted-foreground", gutterBg)}>
          {line.newLineNo ?? ""}
        </td>
        <td className="w-6 select-none px-1 text-center text-muted-foreground">
          {commentable && key && !isEditing && (
            <button
              aria-label="Add comment"
              className="opacity-0 transition group-hover:opacity-100 hover:text-foreground"
              onClick={() => toggleEditing(key, true)}
            >
              <MessageSquarePlus className="size-3.5" />
            </button>
          )}
        </td>
        <td className="whitespace-pre-wrap px-2 py-0.5">
          <span className="select-none text-muted-foreground">{sign}</span>
          {line.content}
        </td>
      </tr>

      {existing && key && !isEditing && (
        <tr>
          <td colSpan={4} className="px-3 py-2">
            <div className="rounded-md border bg-muted/30 p-3 font-sans text-sm">
              <div className="flex items-start gap-2">
                <p className="flex-1 whitespace-pre-wrap">{existing}</p>
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
                initial={existing}
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
    </>
  );
}
