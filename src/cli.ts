#!/usr/bin/env node
import open from "open";
import { parseUnifiedDiff } from "./diff/parse.js";
import { groupDiff } from "./group/index.js";
import { resolveCurrentBranchHost, resolveHost } from "./host/index.js";
import { startServer } from "./server/index.js";

interface Args {
  input: string;
  port: number;
  noOpen: boolean;
}

function parseArgs(argv: string[]): Args {
  let input = "";
  let port = 0;
  let noOpen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--no-open") noOpen = true;
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-")) input = a;
  }
  return { input, port, noOpen };
}

function printHelp() {
  console.log(`reviewer — grouped PR/MR review with Claude Code

Usage:
  reviewer                            (open PR/MR for the current branch)
  reviewer <pr-or-mr-number>          (run inside the repo)
  reviewer <github-or-gitlab-url>

Options:
  --port <n>   bind to a specific port (default: free ephemeral port)
  --no-open    don't open the browser automatically
  -h, --help   show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.error(
    args.input ? "→ Resolving PR/MR…" : "→ Resolving PR/MR for the current branch…",
  );
  const host = args.input
    ? await resolveHost(args.input)
    : await resolveCurrentBranchHost();

  console.error("→ Fetching diff…");
  const { meta, diffText, comments: existingComments } = await host.fetch();
  const diff = parseUnifiedDiff(diffText);
  const fileCount = diff.files.length;
  console.error(`  ${meta.host} #${meta.id}: "${meta.title}" — ${fileCount} file(s)`);

  console.error("→ Grouping with Claude…");
  const grouping = await groupDiff(diff, diffText);
  console.error(`  ${grouping.groups.length} group(s)` +
    (grouping.ungrouped.length ? `, ${grouping.ungrouped.length} ungrouped hunk(s)` : ""));

  if (existingComments.length) {
    console.error(`  ${existingComments.length} existing comment(s) from reviewers`);
  }

  const server = await startServer(
    { meta, files: diff.files, grouping, existingComments },
    host,
    args.port,
  );
  console.error(`\n  Review ready: ${server.url}\n  Press Ctrl-C to stop.`);

  if (!args.noOpen) await open(server.url);

  const shutdown = () => {
    server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`\n✖ ${(err as Error).message}`);
  process.exit(1);
});
