import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { DiffFile } from "../diff/types.js";
import type { Host } from "../host/types.js";
import { architectReview, type ArchitectReview } from "../review/architect.js";
import { askClaude, type AskInput } from "./ask.js";
import { findUiDist } from "./paths.js";
import type { BuildingState, ReviewApiResponse, ReviewPayload, SubmitBody } from "./payload.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export interface ReviewOptions {
  /** Claude model to use for the architect review; omit to use the CLI default. */
  model?: string;
}

export interface ServerHandle extends RunningServer {
  setProgress: (update: Omit<BuildingState, "status">) => void;
  /** Marks the review ready; `diffText` is stashed for the architect review. */
  setPayload: (payload: ReviewPayload, diffText: string) => void;
  setError: (message: string) => void;
  /** Kick off the architect review early (e.g. in parallel with grouping). */
  startArchitect: (diffText: string, files: DiffFile[]) => void;
}

/**
 * Start the local review server on a free ephemeral port (or `preferredPort`),
 * bound to 127.0.0.1. Serves the built UI and the review API. The review
 * payload isn't known yet — the caller reports progress via the returned
 * handle and hands off the finished payload once the pipeline completes.
 */
export function startServer(
  host: Host,
  preferredPort = 0,
  reviewOptions: ReviewOptions = {},
): Promise<ServerHandle> {
  const uiDist = findUiDist();
  const app = new Hono();

  let state: ReviewApiResponse = { status: "building", step: "fetching" };
  let diffText = "";

  // Cache the architect review in memory (a promise, so concurrent clicks dedupe);
  // `?force=1` clears it and reruns.
  let architectPromise: Promise<ArchitectReview> | null = null;

  const launchArchitect = (dt: string, files: DiffFile[]) => {
    architectPromise = architectReview(dt, files, reviewOptions.model).catch((err) => {
      architectPromise = null; // don't cache failures — let the next click retry
      throw err;
    });
    return architectPromise;
  };

  app.get("/api/review", (c) => c.json(state));

  app.post("/api/review", async (c) => {
    if (state.status !== "ready") return c.json({ error: "Review not ready yet" }, 409);
    const body = (await c.req.json()) as SubmitBody;
    if (!Array.isArray(body.comments)) {
      return c.json({ error: "comments must be an array" }, 400);
    }
    try {
      const action = body.action ?? "comment";
      const result = await host.postReview(body.comments, body.summary ?? "", action);
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post("/api/ask", async (c) => {
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

  app.post("/api/architect-review", async (c) => {
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
          setProgress: (update) => {
            if (state.status === "error") return;
            state = { status: "building", ...update };
          },
          setPayload: (payload, dt) => {
            diffText = dt;
            state = { status: "ready", ...payload };
          },
          setError: (message) => {
            state = { status: "error", message };
          },
          startArchitect: (dt, files) => {
            diffText = dt;
            if (!architectPromise) launchArchitect(dt, files);
          },
        });
      },
    );
  });
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
