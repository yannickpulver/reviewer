#!/usr/bin/env node
import { createInterface } from "node:readline";
import open from "open";
import { parseUnifiedDiff } from "./diff/parse.js";
import { formatAge } from "./format.js";
import { groupDiff } from "./group/index.js";
import {
  hostForId,
  listOpenPulls,
  makeLocalHost,
  pullRank,
  resolveHost,
  type Host,
  type HostKind,
  type PullSummary,
} from "./host/index.js";
import { startServer, type ServerHandle } from "./server/index.js";

interface Args {
  input: string;
  port: number;
  noOpen: boolean;
  model?: string;
  local: boolean;
  base?: string;
  sinceLastReview: boolean;
  architect: boolean;
}

function parseArgs(argv: string[]): Args {
  let input = "";
  let port = 0;
  let noOpen = false;
  let model: string | undefined;
  let local = false;
  let base: string | undefined;
  let sinceLastReview = false;
  let architect = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--no-open") noOpen = true;
    else if (a === "--local") local = true;
    else if (a === "--base") base = argv[++i];
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--model") model = argv[++i];
    else if (a === "--since-last-review") sinceLastReview = true;
    else if (a === "--architect") architect = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-")) input = a;
  }
  return { input, port, noOpen, model, local, base, sinceLastReview, architect };
}

/**
 * With no argument: list open PRs/MRs and let the user pick one, plus a final
 * "review the current local branch" option for pre-PR work. Falls back to a
 * local review when there's no remote or no open PRs/MRs.
 */
async function pickOpenPull(base?: string): Promise<Host> {
  console.error("→ Listing open PRs/MRs…");
  let listing: Awaited<ReturnType<typeof listOpenPulls>>;
  try {
    listing = await listOpenPulls();
  } catch (e) {
    console.error(`  (${(e as Error).message}) — reviewing the current local branch.`);
    return makeLocalHost(base);
  }
  const { host, repo, pulls } = listing;
  if (pulls.length === 0) {
    console.error("  No open PRs/MRs — reviewing the current local branch.");
    return makeLocalHost(base);
  }
  printPullList(pulls);
  return promptChoice(pulls, host, repo, base);
}

const BUCKET_LABELS = ["Review requested from you", "Assigned to you", "Other open"];

function printPullList(pulls: PullSummary[]) {
  const localChoice = pulls.length + 1;
  const width = String(localChoice).length;
  // Only show section headers when more than one bucket is present.
  const multiBucket = new Set(pulls.map(pullRank)).size > 1;
  console.error("\nOpen PRs/MRs:");
  let prevRank = -1;
  for (const [i, p] of pulls.entries()) {
    const rank = pullRank(p);
    if (multiBucket && rank !== prevRank) {
      console.error(`\n  ${BUCKET_LABELS[rank]}:`);
      prevRank = rank;
    }
    const n = String(i + 1).padStart(width);
    const draft = p.state === "draft" ? " (draft)" : "";
    const age = `\x1b[2m· waiting ${formatAge(p.createdAt)}\x1b[0m`;
    console.error(`  ${n}. #${p.id}  ${p.title}${draft}  — ${p.author}  ${age}`);
  }
  console.error(
    `\n  ${String(localChoice).padStart(width)}. Review the current local branch (no PR/MR)`,
  );
  console.error("");
}

async function promptChoice(
  pulls: PullSummary[],
  host: HostKind,
  repo: string,
  base?: string,
): Promise<Host> {
  const localChoice = pulls.length + 1;
  for (;;) {
    const ans = (await promptLine(`Pick [1-${localChoice}]: `)).trim();
    const n = Number(ans);
    if (n === localChoice) return makeLocalHost(base);
    if (Number.isInteger(n) && n >= 1 && n <= pulls.length) {
      return hostForId(host, pulls[n - 1]!.id, repo);
    }
    console.error(`  Enter a number between 1 and ${localChoice}.`);
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
  reviewer                            (pick from open PRs/MRs, or the local branch)
  reviewer <pr-or-mr-number>          (run inside the repo)
  reviewer <github-or-gitlab-url>
  reviewer --local                    (review the current branch, no PR needed)

Options:
  --local              review the current branch's changes (commits + uncommitted)
  --base <ref>         base to diff against for --local (default: origin/HEAD, else main/master)
  --since-last-review  only show changes since your last review (GitHub only)
  --architect          run the Claude architect review in parallel with grouping
  --port <n>           bind to a specific port (default: free ephemeral port)
  --model <name>       Claude model for grouping (e.g. sonnet, opus; default: CLI default)
  --no-open            don't open the browser automatically
  -h, --help           show this help`);
}

/**
 * Decide whether to fetch the full diff or just the changes since the
 * reviewer's last review. Skips the prompt (and the lookup) entirely when
 * the host doesn't support it (GitLab, local) or the flag was passed.
 */
async function resolveSinceLastReview(host: Host, flagSet: boolean): Promise<boolean> {
  if (flagSet) return true;
  const last = await host.getLastReview?.();
  if (!last) return false;
  console.error("\n  1. full diff");
  console.error(`  2. since your last review (${formatAge(last.submittedAt)} ago)`);
  const ans = (await promptLine("Pick [1]: ")).trim();
  return ans === "2";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const host = args.local
    ? (console.error("→ Reviewing local branch…"), await makeLocalHost(args.base))
    : args.input
      ? (console.error("→ Resolving PR/MR…"), await resolveHost(args.input))
      : await pickOpenPull(args.base);

  const sinceLastReview = await resolveSinceLastReview(host, args.sinceLastReview);

  const server = await startServer(host, args.port, { model: args.model });
  const openLine = args.noOpen ? `\n  Review: ${server.url}` : `\n  Opening ${server.url}`;
  console.error(`${openLine}\n  Press Ctrl-C to stop.`);

  if (!args.noOpen) await open(server.url);

  const shutdown = () => {
    server.close().finally(() => process.exit());
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  runPipeline(host, sinceLastReview, args, server).catch((err) => {
    console.error(`\n✖ ${(err as Error).message}`);
    server.setError((err as Error).message);
    process.exitCode = 1;
  });
}

async function runPipeline(
  host: Host,
  sinceLastReview: boolean,
  args: Args,
  server: ServerHandle,
) {
  console.error("→ Fetching diff…");
  server.setProgress({ step: "fetching" });
  const { meta, diffText, comments: existingComments, diffScope } = await host.fetch({
    sinceLastReview,
  });
  if (diffScope === "since-last-review") {
    console.error("  showing changes since your last review");
  }

  const diff = parseUnifiedDiff(diffText);
  const fileCount = diff.files.length;
  const label = meta.host === "local" ? `local ${meta.headRef}` : `${meta.host} #${meta.id}`;
  console.error(`  ${label}: "${meta.title}" — ${fileCount} file(s)`);

  if (args.architect) {
    console.error("→ Starting architect review (in parallel)…");
    server.startArchitect(diffText, diff.files);
  }

  console.error("→ Grouping with Claude…");
  server.setProgress({ step: "grouping" });
  const grouping = await groupDiff(diff, diffText, {
    model: args.model,
    onProgress: (batchIndex, batches) =>
      server.setProgress({ step: "grouping", batch: batchIndex + 1, batches }),
  });
  console.error(`  ${grouping.groups.length} group(s)` +
    (grouping.ungrouped.length ? `, ${grouping.ungrouped.length} ungrouped hunk(s)` : ""));

  if (existingComments.length) {
    console.error(`  ${existingComments.length} existing comment(s) from reviewers`);
  }

  server.setPayload(
    { meta, files: diff.files, grouping, existingComments, diffScope, architectStarted: args.architect },
    diffText,
  );
}

main().catch((err) => {
  console.error(`\n✖ ${(err as Error).message}`);
  process.exit(1);
});
