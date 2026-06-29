# reviewer

A local CLI that makes code reviews easier to digest. It fetches a GitHub PR or
GitLab MR diff, asks your **local Claude Code** instance to group related changes
together (pushing chores, string tweaks, and lockfile noise out of the way), and
serves an interactive review UI in your browser. You leave inline comments and
submit them back as a single review.

Everything runs locally. The only network calls are the ones `gh`/`glab` already
make on your behalf.

## How it works

```
reviewer 42
 ├─ fetch diff + metadata via gh / glab
 ├─ parse the unified diff into a typed model
 ├─ claude -p  →  groups {title, importance, summary, hunks[]}  (chunked for big diffs)
 ├─ serve a local UI on a free 127.0.0.1 port + open the browser
 └─ "Submit review"  →  posts batched inline comments via gh / glab
```

## Requirements

- Node 20+
- [`gh`](https://cli.github.com/) and/or [`glab`](https://gitlab.com/gitlab-org/cli),
  installed and authenticated
- [`claude`](https://claude.com/claude-code) CLI, logged in

## Install / build

```bash
pnpm install
pnpm --dir ui install
pnpm build          # builds the UI then the CLI
```

## Usage

Run inside the repo with no argument to review the open PR/MR for the current
branch, pass a PR/MR number, or pass a full URL from anywhere:

```bash
reviewer                                              # current branch's PR/MR
reviewer 42
reviewer https://github.com/org/repo/pull/42
reviewer https://gitlab.com/group/sub/repo/-/merge_requests/13
```

Options:

| Flag         | Description                                  |
|--------------|----------------------------------------------|
| `--port <n>` | Bind a specific port (default: free port)    |
| `--no-open`  | Don't open the browser automatically         |
| `-h`         | Help                                         |

In the browser: high/medium-importance groups are expanded, low-importance ones
collapsed. Hover a line and click the comment icon to leave an inline note. Click
**Submit review** to post all comments at once (with an optional overall summary).

## Development

```bash
pnpm test           # unit tests (diff parser, host detection, grouping)
pnpm typecheck

# Run the UI against a running reviewer server with hot reload:
pnpm dev <pr>       # terminal 1 — starts CLI + API
pnpm --dir ui dev   # terminal 2 — Vite dev server, proxies /api to the CLI
```

## Architecture

| Module    | Responsibility                                                   |
|-----------|------------------------------------------------------------------|
| `diff/`   | parse a unified diff into a typed `File/Hunk/Line` model (pure)  |
| `host/`   | detect github/gitlab; fetch diff + metadata; post the review     |
| `group/`  | build the prompt, call `claude -p`, validate, chunk + merge      |
| `server/` | Hono server: `GET/POST /api/review`, serve the built UI          |
| `ui/`     | React + Tailwind + shadcn review interface                       |

If Claude is unavailable or returns unusable output, the tool falls back to a
single "All changes" group so it still works.

See [PLAN.md](./PLAN.md) for the full design.
