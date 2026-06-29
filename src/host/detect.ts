import type { Target } from "./types.js";

export type ParsedInput =
  | { kind: "url"; target: Target }
  | { kind: "number"; id: number };

/**
 * Parse the CLI argument into either a fully-resolved target (from a URL) or a
 * bare number (host must be resolved from the local repo remote). Pure.
 */
export function parseInput(input: string): ParsedInput {
  const trimmed = input.trim();

  if (/^\d+$/.test(trimmed)) {
    return { kind: "number", id: Number(trimmed) };
  }

  const url = tryParseUrl(trimmed);
  if (url) return { kind: "url", target: url };

  throw new Error(
    `Could not understand "${input}". Pass a PR/MR number (run inside the repo) or a full GitHub/GitLab URL.`,
  );
}

function tryParseUrl(raw: string): Target | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);

  // GitHub (incl. Enterprise): /owner/repo/pull/42 — the /pull/ scheme is distinctive.
  const pull = parts.indexOf("pull");
  if (pull >= 2 && parts[pull + 1] && /^\d+$/.test(parts[pull + 1]!)) {
    const ownerRepo = parts.slice(0, pull).join("/");
    // gh needs the host for Enterprise: [HOST/]OWNER/REPO
    const repo =
      u.hostname.toLowerCase() === "github.com" ? ownerRepo : `${u.hostname}/${ownerRepo}`;
    return { host: "github", id: Number(parts[pull + 1]), repo };
  }

  // GitLab (incl. self-hosted): /group/(subgroups...)/repo/-/merge_requests/42
  const dash = parts.indexOf("-");
  if (dash >= 1 && parts[dash + 1] === "merge_requests" && parts[dash + 2] && /^\d+$/.test(parts[dash + 2]!)) {
    return { host: "gitlab", id: Number(parts[dash + 2]), repo: parts.slice(0, dash).join("/") };
  }
  return null;
}
