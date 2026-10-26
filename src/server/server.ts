import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { parseUnifiedDiff } from "../diff/parse.js";
import type { DiffFile } from "../diff/types.js";
import type { Grouping } from "../group/types.js";
import type { Host } from "../host/types.js";
import { refreshDiff } from "../refresh/localDiff.js";
import { buildLineMap, carryGrouping, remapExisting, remapFindings } from "../refresh/remap.js";
import { architectReview, type ArchitectReview } from "../review/architect.js";
import { askClaude, type AskInput } from "./ask.js";
import { findUiDist } from "./paths.js";
import type {
  BuildingState,
  QueueEntry,
  QueueStatus,
  ReactBody,
  ReadyState,
  RefreshResponse,
  RefreshSummary,
  ReviewApiResponse,
  ReviewPayload,
  SubmitBody,
} from "./payload.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export interface ReviewOptions {
  /** Claude model to use for the architect review; omit to use the CLI default. */
  model?: string;
}

/** Drives one review: the CLI pipeline reports into it, the UI reads from it. */
export interface SessionHandle {
  setProgress: (update: Omit<BuildingState, "status">) => void;
  /** Marks the review ready; `diffText` is stashed for the architect review. */
  setPayload: (payload: Omit<ReviewPayload, "rev">, diffText: string) => void;
  /** Swaps the real grouping in once Claude returns, unless a refresh moved on. */
  setGrouping: (grouping: Grouping) => void;
  setError: (message: string) => void;
  /** Kick off the architect review early (e.g. in parallel with grouping). */
  startArchitect: (diffText: string, files: DiffFile[]) => void;
}

export interface ServerHandle extends RunningServer {
  /** One per queued PR/MR, in queue order. */
  sessions: SessionHandle[];
}

/** A PR/MR to serve, with what the picker already knew about it. */
export interface QueueItem {
  host: Host;
  /** Shown in the queue until the review's own metadata has loaded. */
  label?: { id: number; title: string; author: string };
}

/**
 * Swap a freshly computed grouping into a ready state. `atRev` is the rev the
 * grouping was computed against: if the diff has been refreshed since — or a
 * refresh is in flight right now (`refreshInFlight`) and about to replace the
 * diff — the grouping describes hunks that may no longer exist, so it is
 * dropped and only the pending marker is cleared.
 */
export function applyGrouping(
  state: ReadyState,
  grouping: Grouping,
  atRev: number,
  refreshInFlight = false,
): { state: ReadyState; dropped: boolean } {
  const { groupingPending: _pending, ...rest } = state;
  if (refreshInFlight || state.rev !== atRev) return { state: rest, dropped: true };
  return { state: { ...rest, grouping, rev: state.rev + 1 }, dropped: false };
}

/** One row of GET /api/queue: the picker's label until the review's own meta is in. */
export function queueEntry(
  slot: number,
  label: QueueItem["label"],
  state: ReviewApiResponse,
  submitted: string | null,
): QueueEntry {
  const meta = state.status === "ready" ? state.meta : undefined;
  const status: QueueStatus =
    state.status === "building"
      ? "fetching"
      : state.status === "error"
        ? "error"
        : state.groupingPending
          ? "grouping"
          : "ready";
  return {
    slot,
    id: meta?.id ?? label?.id ?? 0,
    title: meta?.title ?? label?.title ?? "",
    author: meta?.author ?? label?.author ?? "",
    status,
    ...(submitted ? { submitted } : {}),
  };
}

/**
 * Start the local review server on a free ephemeral port (or `preferredPort`),
 * bound to 127.0.0.1. Serves the built UI and one review API per queued PR/MR
 * under `/api/s/<slot>/`. The reviews aren't known yet — the caller reports
 * progress via each session handle and hands off the payload once its
 * pipeline completes.
 */
export function startServer(
  items: QueueItem[],
  preferredPort = 0,
  reviewOptions: ReviewOptions = {},
): Promise<ServerHandle> {
  const uiDist = findUiDist();
  const app = new Hono();

  const sessions = items.map((item) => createSession(item.host, reviewOptions));
  sessions.forEach((s, slot) => app.route(`/api/s/${slot}`, s.app));

  app.get("/api/queue", (c) =>
    c.json(
      sessions.map((s, slot) => queueEntry(slot, items[slot]!.label, s.state(), s.submitted())),
    ),
  );

  app.get("/*", async (c) => {
    const res = await serveAsset(uiDist, c.req.path);
    if (!res) return c.notFound();
    return c.newResponse(new Uint8Array(res.body), 200, { "Content-Type": res.type });
  });

  return new Promise((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: preferredPort, hostname: "127.0.0.1" },
      (info) => {
        resolve({
          url: `http://127.0.0.1:${info.port}`,
          close: () =>
            new Promise<void>((res, rej) =>
              server.close((e) => (e ? rej(e) : res())),
            ),
          sessions: sessions.map((s) => s.handle),
        });
      },
    );
  });
}

/** The review API and pipeline handle for one PR/MR. */
function createSession(host: Host, reviewOptions: ReviewOptions) {
  const app = new Hono();

  let state: ReviewApiResponse = { status: "building", step: "fetching" };
  let diffText = "";
  // URL of the review posted from this session, once there is one.
  let submitted: string | null = null;

  // Cache the architect review in memory (a promise, so concurrent clicks dedupe);
  // `?force=1` clears it and reruns.
  let architectPromise: Promise<ArchitectReview> | null = null;
  // The settled review, kept so a refresh can re-anchor its findings in place.
  let architectResult: ArchitectReview | null = null;
  let refreshing: Promise<RefreshResponse> | null = null;

  const launchArchitect = (dt: string, files: DiffFile[]) => {
    architectPromise = architectReview(dt, files, reviewOptions.model)
      .then((review) => {
        architectResult = review;
        return review;
      })
      .catch((err) => {
        architectPromise = null; // don't cache failures — let the next click retry
        throw err;
      });
    return architectPromise;
  };

  // The rev the pending grouping was computed against; a refresh past it makes
  // the grouping stale.
  let groupingRev = 0;

  /**
   * Re-fetch the diff and carry the current review onto it: groups, existing
   * comments and architect findings all move to their new positions instead of
   * being recomputed. No Claude call.
   */
  async function doRefresh(prev: ReadyState): Promise<RefreshResponse> {
    const refreshed = await refreshDiff(host, prev.meta);
    const diff = parseUnifiedDiff(refreshed.diffText);
    const lineMap = buildLineMap(prev.files, diff.files);
    const freshTitle = refreshed.source === "local" ? "Local changes" : "New commits";
    const carried = carryGrouping(prev.grouping, prev.files, diff.files, freshTitle);
    // The remote path refetches comments; the local one re-anchors what we have.
    const existing = refreshed.comments
      ? { comments: refreshed.comments, detached: 0 }
      : remapExisting(prev.existingComments, lineMap);

    let findingsStale = 0;
    if (architectResult) {
      const remapped = remapFindings(architectResult.findings, lineMap, diff.files);
      findingsStale = remapped.stale;
      architectResult = { ...architectResult, findings: remapped.findings };
      architectPromise = Promise.resolve(architectResult);
    }

    const summary: RefreshSummary = {
      source: refreshed.source,
      ahead: refreshed.ahead,
      hunksUnchanged: carried.hunksUnchanged,
      hunksChanged: carried.hunksChanged,
      hunksNew: carried.hunksNew,
      findingsStale,
      existingDetached: existing.detached,
    };

    const { status: _status, groupingPending: _wasPending, ...rest } = prev;
    // A grouping that landed mid-refresh was dropped, but it cleared the pending
    // marker on the live state — honour that rather than the snapshot we started
    // from, or the spinner would never go away.
    const pending = state.status === "ready" ? state.groupingPending : prev.groupingPending;
    const payload: ReviewPayload = {
      ...rest,
      ...(pending ? { groupingPending: true } : {}),
      files: diff.files,
      grouping: carried.grouping,
      existingComments: existing.comments,
      rev: prev.rev + 1,
      refresh: summary,
    };

    diffText = refreshed.diffText;
    state = { status: "ready", ...payload };
    return { payload, lineMap, summary };
  }

  app.get("/review", (c) => c.json(state));

  app.post("/review", async (c) => {
    if (state.status !== "ready") return c.json({ error: "Review not ready yet" }, 409);
    const body = (await c.req.json()) as SubmitBody;
    if (!Array.isArray(body.comments)) {
      return c.json({ error: "comments must be an array" }, 400);
    }
    try {
      const action = body.action ?? "comment";
      const result = await host.postReview(body.comments, body.summary ?? "", action);
      submitted = result.url;
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  // Description images, fetched with the host CLI's credentials so private
  // attachments load. Anything the host doesn't serve is a plain redirect.
  app.get("/image", async (c) => {
    const url = c.req.query("url") ?? "";
    if (!/^https?:\/\//.test(url)) return c.json({ error: "url must be http(s)" }, 400);
    try {
      const img = await host.fetchImage?.(url);
      if (!img) return c.redirect(url);
      const ext = "." + (new URL(url).pathname.split(".").pop() ?? "").toLowerCase();
      const type =
        img.type && img.type !== "application/octet-stream"
          ? img.type
          : (MIME[ext] ?? "application/octet-stream");
      return c.newResponse(new Uint8Array(img.body), 200, {
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post("/react", async (c) => {
    if (state.status !== "ready") return c.json({ error: "Review not ready yet" }, 409);
    if (!host.toggleReaction) return c.json({ error: "Reactions not supported" }, 501);
    const body = (await c.req.json()) as Partial<ReactBody>;
    if (typeof body.commentId !== "string" || typeof body.content !== "string") {
      return c.json({ error: "commentId and content are required" }, 400);
    }
    try {
      const reactions = await host.toggleReaction(body.commentId, body.content, !!body.remove);
      return c.json({ reactions });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post("/ask", async (c) => {
    if (state.status !== "ready") return c.json({ error: "Review not ready yet" }, 409);
    const body = (await c.req.json()) as Partial<AskInput>;
    if (typeof body.question !== "string" || !body.question.trim()) {
      return c.json({ error: "question is required" }, 400);
    }
    try {
      const answer = await askClaude({
        path: body.path ?? "",
        line: typeof body.line === "number" ? body.line : 0,
        code: body.code ?? "",
        question: body.question,
      });
      return c.json({ answer });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post("/architect-review", async (c) => {
    if (state.status !== "ready") return c.json({ error: "Review not ready yet" }, 409);
    const force = c.req.query("force") === "1";
    const promise =
      force || !architectPromise ? launchArchitect(diffText, state.files) : architectPromise;
    try {
      const result = await promise;
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post("/refresh", async (c) => {
    if (state.status !== "ready") return c.json({ error: "Review not ready yet" }, 409);
    // Concurrent clicks share one run — refreshing twice would fight over `state`.
    refreshing ??= doRefresh(state).finally(() => {
      refreshing = null;
    });
    try {
      return c.json(await refreshing);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  const handle: SessionHandle = {
    setProgress: (update) => {
      if (state.status === "error") return;
      state = { status: "building", ...update };
    },
    setPayload: (payload, dt) => {
      diffText = dt;
      state = { status: "ready", rev: 0, ...payload };
      groupingRev = 0;
    },
    setGrouping: (grouping) => {
      if (state.status !== "ready") return;
      const result = applyGrouping(state, grouping, groupingRev, refreshing !== null);
      if (result.dropped) {
        console.error("grouping discarded: diff refreshed meanwhile");
      }
      state = result.state;
    },
    setError: (message) => {
      state = { status: "error", message };
    },
    startArchitect: (dt, files) => {
      diffText = dt;
      if (!architectPromise) launchArchitect(dt, files);
    },
  };

  return { app, handle, state: () => state, submitted: () => submitted };
}

async function serveAsset(
  root: string,
  urlPath: string,
): Promise<{ body: Buffer; type: string } | null> {
  // SPA: serve real files; fall back to index.html for app routes.
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const full = join(root, safe);
  if (!full.startsWith(root)) return null; // path traversal guard

  const ext = "." + (safe.split(".").pop() ?? "");
  try {
    const body = await readFile(full);
    return { body, type: MIME[ext] ?? "application/octet-stream" };
  } catch {
    if (safe === "index.html") return null;
    const body = await readFile(join(root, "index.html")).catch(() => null);
    return body ? { body, type: MIME[".html"]! } : null;
  }
}
