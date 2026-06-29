# Reviewer — grouped code-review CLI

A local CLI that fetches a GitHub PR / GitLab MR diff, asks your local Claude Code
instance to group related changes (downranking chores/strings), and serves an
interactive review UI in your browser. You draft inline comments and submit them
back as a single review via `gh` / `glab`.

## Goals

- Make large diffs reviewable by grouping related hunks and surfacing what matters.
- Push low-signal changes (string tweaks, chores, lockfiles, formatting) out of the way.
- Let the reviewer leave inline comments and submit them to the PR/MR.
- Run entirely locally, reusing the tools already installed and authed (`gh`/`glab`/`claude`).

## Non-goals (YAGNI)

- No cloud deployment, no database, no accounts, no persistence across runs.
- No multi-user / collaboration.
- No local-git-ref reviewing (PR/MR only, for now).
- No group-level comments (inline line comments only, for now).
- No "post each comment immediately" mode (batched single review only).

## Architecture

```
$ reviewer 42                      # or full PR/MR URL, run inside the repo

CLI (Node/TS)
 ├─ 1. detect host (github/gitlab) from URL or repo remote
 ├─ 2. fetch diff & metadata via gh / glab
 ├─ 3. parse unified diff → typed File/Hunk/Line model
 ├─ 4. claude -p --output-format json  (diff + strict schema in prompt)
 │       → groups: {title, importance, summary, hunks[]}
 │       (chunk by file & merge for very large diffs)
 ├─ 5. boot local server on 127.0.0.1:<port>, embed grouped diff
 └─ 6. open browser to it

Browser UI ── localhost ──> CLI server
 ├─ renders groups (high/medium expanded, low collapsed)
 ├─ inline line comments (select line → comment box), drafted client-side
 └─ "Submit review" → POST /review → server posts batched review via gh / glab
```

Single ephemeral local process: the same CLI generates the review and handles
comment submission. Closing it (Ctrl-C) discards all state.

### "Runs locally" — what that means

- CLI, HTTP server, and browser UI all run on the user's machine, bound to `127.0.0.1`
  only (not exposed on the LAN).
- Claude runs through the local `claude` CLI (existing logged-in instance). No
  separate cloud service of ours.
- No database, no persistence: the grouped review lives in process memory; comments
  are drafted in the browser tab until Submit.
- The only outbound network calls are `gh`/`glab` fetching the diff and posting the
  review back to GitHub/GitLab — the same calls the user already makes by hand.

## Tech stack

- **CLI + server:** Node + TypeScript, distributed via `npx`. Minimal HTTP server
  using **Hono** (tiny; static serving + JSON routes). Ephemeral process.
- **Frontend:** Vite + React, bundled into static assets served by the CLI server.
- **UI components:** Tailwind CSS + shadcn/ui (components copied into
  `ui/components/ui`, themeable).
  - Collapsible groups: Accordion / Collapsible
  - Comment editor: Popover + Textarea
  - Importance tags: Badge
  - Submit bar: Button
- **Diff rendering:** custom lightweight renderer (not diff2html) — we must slice
  hunks into Claude's groups, collapse low-importance ones, and attach comment boxes
  to lines, which off-the-shelf viewers don't support.

## Modules

Each module has one purpose, a defined interface, and is independently testable.

| Module    | Responsibility                                                        | Depends on            |
|-----------|----------------------------------------------------------------------|-----------------------|
| `host/`   | detect github/gitlab; fetch diff + metadata; post review             | `gh`, `glab` CLIs     |
| `diff/`   | parse unified diff → typed `File/Hunk/Line`; map hunk refs ↔ lines   | nothing (pure)        |
| `group/`  | build Claude prompt + schema, invoke `claude -p`, validate, merge    | `claude` CLI, `diff/` |
| `server/` | serve UI; `GET /review` (data) + `POST /review` (submit)             | `host/`, all above    |
| `ui/`     | React app: render groups, draft comments, submit                    | server endpoints      |

`host/` is the single abstraction point — github vs gitlab differ only behind its
interface.

## Data flow & the Claude contract

`claude -p` returns a strict, validated JSON object. Claude emits **references**
only, never diff content — the renderer pulls actual lines from the parsed model, so
displayed code is always exactly what git produced.

```jsonc
{
  "groups": [
    {
      "title": "Auth refactor",
      "importance": "high",                 // high | medium | low
      "summary": "Swaps JWT lib, adds refresh-token rotation.",
      "hunks": ["src/auth.ts:H1", "src/token.ts:H0"]  // refs into parsed model
    }
  ],
  "ungrouped": ["README.md:H0"]             // safety net for anything Claude misses
}
```

Rules:

- Every hunk must appear in exactly one group or in `ungrouped` — validated. On
  mismatch, surface a warning and dump leftovers into `ungrouped` rather than
  dropping changes.
- `low` importance (strings, chores, lockfiles, formatting) renders collapsed by
  default; `high`/`medium` expanded.
- For very large diffs, chunk the prompt by file and merge the returned groups.

## Error handling

- `gh`/`glab` missing or unauthed → clear actionable message.
- `claude` missing → clear message.
- Claude returns invalid JSON → one retry, then fall back to a single "Ungrouped"
  view so the tool still works.
- Hunk-reference mismatch → warning + leftovers into `ungrouped`.

## CLI surface

```
$ reviewer <pr-number>                       # uses repo's remote to resolve host
$ reviewer https://github.com/org/repo/pull/42
$ reviewer https://gitlab.com/org/repo/-/merge_requests/42
```

Options (initial): `--port`, `--no-open`.

## Implementation phases

1. **Scaffold** — Node/TS monorepo-ish layout (CLI + Vite UI), Tailwind + shadcn init.
2. **`diff/`** — unified-diff parser → typed model + hunk-ref mapping. Pure, unit-tested.
3. **`host/`** — host detection + `gh`/`glab` fetch (diff + metadata). Mock the CLIs in tests.
4. **`group/`** — prompt + schema, `claude -p` invocation, validation, chunk/merge, fallback.
5. **`server/`** — Hono server, `GET /review`, static UI serving, browser auto-open.
6. **`ui/`** — render groups (collapsible, importance badges, summaries), custom diff lines.
7. **Inline comments** — line selection, comment drafting (client-side state).
8. **Submit** — `POST /review` → batched review via `gh`/`glab` (host abstraction).
9. **Polish** — error states, large-diff handling, README.

## Resolved decisions

- **Port:** always grab a free ephemeral port (no fixed default to clash). `--port`
  still allowed to override.
- **Submit:** the UI (drafted comments visible in context) is the preview — clicking
  "Submit review" posts the batched review directly via `gh`/`glab`. A small confirm
  step shows the comment count before it goes out; no separate preview screen.
- **Chunking:** trigger by **estimated token budget**, not raw file count. Estimate
  tokens ≈ characters / 4. If the diff prompt exceeds a budget (target ~100k tokens,
  well within model context), pack whole files into batches that each stay under
  budget, run `claude -p` per batch, then merge returned groups by title (same title
  ⇒ merged group, importance = max). Never split a file across batches — keeps hunk
  refs and grouping coherent.
```
