import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Host } from "../host/types.js";
import { architectReview, type ArchitectReview } from "../review/architect.js";
import { askClaude, type AskInput } from "./ask.js";
import { findUiDist } from "./paths.js";
import type { ReviewPayload, SubmitBody } from "./payload.js";

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
  /** Raw unified diff text, needed for the independent architect review. */
  diffText: string;
  /** Claude model to use for the architect review; omit to use the CLI default. */
  model?: string;
}

/**
 * Start the local review server on a free ephemeral port (or `preferredPort`),
 * bound to 127.0.0.1. Serves the built UI and the review API.
 */
export function startServer(
  payload: ReviewPayload,
  host: Host,
  preferredPort = 0,
  reviewOptions: ReviewOptions = { diffText: "" },
): Promise<RunningServer> {
  const uiDist = findUiDist();
  const app = new Hono();

  // Cache the architect review in memory (a promise, so concurrent clicks dedupe);
  // `?force=1` clears it and reruns.
  let architectPromise: Promise<ArchitectReview> | null = null;

  app.get("/api/review", (c) => c.json(payload));

  app.post("/api/review", async (c) => {
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
    const force = c.req.query("force") === "1";
    if (force || !architectPromise) {
      architectPromise = architectReview(
        reviewOptions.diffText,
        payload.files,
        reviewOptions.model,
      ).catch((err) => {
        architectPromise = null; // don't cache failures — let the next click retry
        throw err;
      });
    }
    try {
      const result = await architectPromise;
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
