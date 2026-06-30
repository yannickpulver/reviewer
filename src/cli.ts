#!/usr/bin/env node
import { createInterface } from "node:readline";
import open from "open";
import { parseUnifiedDiff } from "./diff/parse.js";
import { groupDiff } from "./group/index.js";
import {
  hostForId,
  listOpenPulls,
  resolveHost,
  type Host,
  type PullSummary,
} from "./host/index.js";
import { startServer } from "./server/index.js";

interface Args {
  input: string;
  port: number;
  noOpen: boolean;
  model?: string;
}

function parseArgs(argv: string[]): Args {
  let input = "";
  let port = 0;
  let noOpen = false;
  let model: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--no-open") noOpen = true;
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--model") model = argv[++i];
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-")) input = a;
  }
  return { input, port, noOpen, model };
}

/** With no argument: list open PRs/MRs and let the user pick one. */
async function pickOpenPull(): Promise<Host> {
  console.error("→ Listing open PRs/MRs…");
  const { host, repo, pulls } = await listOpenPulls();
  if (pulls.length === 0) throw new Error("No open PRs/MRs found for this repo.");
  if (pulls.length === 1) {
    const only = pulls[0]!;
    console.error(`  Only one open: #${only.id} "${only.title}" — opening it.`);
    return hostForId(host, only.id, repo);
  }
  printPullList(pulls);
  const id = await promptChoice(pulls);
  return hostForId(host, id, repo);
}

function printPullList(pulls: PullSummary[]) {
  const width = String(pulls.length).length;
  console.error("\nOpen PRs/MRs:");
  for (const [i, p] of pulls.entries()) {
    const n = String(i + 1).padStart(width);
    const draft = p.state === "draft" ? " (draft)" : "";
    console.error(`  ${n}. #${p.id}  ${p.title}${draft}  — ${p.author}`);
  }
  console.error("");
}

async function promptChoice(pulls: PullSummary[]): Promise<number> {
  for (;;) {
    const ans = (await promptLine(`Pick a PR/MR [1-${pulls.length}]: `)).trim();
    const n = Number(ans);
    if (Number.isInteger(n) && n >= 1 && n <= pulls.length) return pulls[n - 1]!.id;
    console.error(`  Enter a number between 1 and ${pulls.length}.`);
  }
}

function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

function printHelp() {
  console.log(`reviewer — grouped PR/MR review with Claude Code

Usage:
  reviewer                            (pick from open PRs/MRs in the repo)
  reviewer <pr-or-mr-number>          (run inside the repo)
  reviewer <github-or-gitlab-url>

Options:
  --port <n>     bind to a specific port (default: free ephemeral port)
  --model <name> Claude model for grouping (e.g. sonnet, opus; default: CLI default)
  --no-open      don't open the browser automatically
  -h, --help     show this help`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const host = args.input
    ? (console.error("→ Resolving PR/MR…"), await resolveHost(args.input))
    : await pickOpenPull();

  console.error("→ Fetching diff…");
  const { meta, diffText, comments: existingComments } = await host.fetch();
  const diff = parseUnifiedDiff(diffText);
  const fileCount = diff.files.length;
  console.error(`  ${meta.host} #${meta.id}: "${meta.title}" — ${fileCount} file(s)`);

  console.error("→ Grouping with Claude…");
  const grouping = await groupDiff(diff, diffText, { model: args.model });
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
