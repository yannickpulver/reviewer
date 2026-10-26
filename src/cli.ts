#!/usr/bin/env node
import { createInterface } from "node:readline";
import open from "open";
import { parseUnifiedDiff } from "./diff/parse.js";
import { formatAge } from "./format.js";
import { fallbackGrouping, groupDiff } from "./group/index.js";
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
import { startServer, type QueueItem, type SessionHandle } from "./server/index.js";

interface Args {
  input: string;
  port: number;
  noOpen: boolean;
  model?: string;
  local: boolean;
  base?: string;
  architect: boolean;
  queue: boolean;
}

function parseArgs(argv: string[]): Args {
  let input = "";
  let port = 0;
  let noOpen = false;
  let model: string | undefined;
  let local = false;
  let base: string | undefined;
  let architect = false;
  let queue = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--no-open") noOpen = true;
    else if (a === "--local") local = true;
    else if (a === "--base") base = argv[++i];
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--model") model = argv[++i];
    else if (a === "--architect") architect = true;
    else if (a === "--queue") queue = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (a.startsWith("-")) {
      console.error(`Unknown option: ${a} (see --help)`);
      process.exit(1);
    } else input = a;
  }
  return { input, port, noOpen, model, local, base, architect, queue };
}

/**
 * With no argument: list open PRs/MRs and let the user pick one, plus a final
 * "review the current local branch" option for pre-PR work, and "a" to queue
 * every PR/MR waiting on the user's review. Fails when there's no remote or no
 * open PRs/MRs — reviewing the local branch stays explicit (--local or the
 * picker option).
 */
async function pickOpenPull(base?: string): Promise<QueueItem[]> {
  const { host, repo, pulls } = await listPulls();
  if (pulls.length === 0) {
    throw new Error("no open PRs/MRs — use --local to review the current branch");
  }
  printPullList(pulls);
  return promptChoice(pulls, host, repo, base);
}

/** --queue: every open PR/MR whose review is requested from the user. */
async function requestedQueue(): Promise<QueueItem[]> {
  const { host, repo, pulls } = await listPulls();
  const items = queueOf(pulls, host, repo);
  if (items.length === 0) throw new Error("no open PRs/MRs request your review");
  return items;
}

async function listPulls() {
  console.error("→ Listing open PRs/MRs…");
  try {
    return await listOpenPulls();
  } catch (e) {
    throw new Error(`${(e as Error).message} — use --local to review the current branch`);
  }
}

function queueOf(pulls: PullSummary[], host: HostKind, repo: string): QueueItem[] {
  return pulls
    .filter((p) => p.reviewRequestedFromMe)
    .map((p) => ({ host: hostForId(host, p.id, repo), label: p }));
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
    const size = formatDiffSize(p);
    console.error(`  ${n}. #${p.id}  ${p.title}${draft}  — ${p.author}${size}  ${age}`);
  }
  console.error(
    `\n  ${String(localChoice).padStart(width)}. Review the current local branch (no PR/MR)`,
  );
  const requested = pulls.filter((p) => p.reviewRequestedFromMe).length;
  if (requested > 0) {
    console.error(
      `  ${"a".padStart(width)}. Review all ${requested} requested from you, one after another`,
    );
  }
  console.error("");
}

/** Green/red line counts for the picker, or "" when the host didn't report them. */
function formatDiffSize(p: PullSummary): string {
  if (p.additions === undefined && p.deletions === undefined) return "";
  const added = `\x1b[32m+${p.additions ?? 0}\x1b[0m`;
  const removed = `\x1b[31m-${p.deletions ?? 0}\x1b[0m`;
  return `  ${added} ${removed}`;
}

async function promptChoice(
  pulls: PullSummary[],
  host: HostKind,
  repo: string,
  base?: string,
): Promise<QueueItem[]> {
  const localChoice = pulls.length + 1;
  const queue = queueOf(pulls, host, repo);
  const range = `1-${localChoice}${queue.length ? ", a" : ""}`;
  for (;;) {
    const ans = (await promptLine(`Pick [${range}]: `)).trim();
    if (ans.toLowerCase() === "a" && queue.length) return queue;
    const n = Number(ans);
    if (n === localChoice) return [{ host: await makeLocalHost(base) }];
    if (Number.isInteger(n) && n >= 1 && n <= pulls.length) {
      return [{ host: hostForId(host, pulls[n - 1]!.id, repo) }];
    }
    console.error(`  Enter ${range.replace(", a", " or a")}.`);
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
  reviewer --queue                    (all PRs/MRs requesting your review, one after another)

Options:
  --local              review the current branch's changes (commits + uncommitted)
  --base <ref>         base to diff against for --local (default: origin/HEAD, else main/master)
  --queue              open every PR/MR requesting your review; the next ones load
                       in the background while you review the current one
  --architect          run the Claude architect review in parallel with grouping
  --port <n>           bind to a specific port (default: free ephemeral port)
  --model <name>       Claude model for grouping (e.g. sonnet, opus; default: sonnet)
  --no-open            don't open the browser automatically
  -h, --help           show this help`);
}

/** How many reviews fetch + group at once; the rest wait their turn. */
const PRELOAD_CONCURRENCY = 2;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const items: QueueItem[] = args.local
    ? (console.error("→ Reviewing local branch…"), [{ host: await makeLocalHost(args.base) }])
    : args.queue
      ? await requestedQueue()
      : args.input
        ? (console.error("→ Resolving PR/MR…"), [{ host: await resolveHost(args.input) }])
        : await pickOpenPull(args.base);

  const server = await startServer(items, args.port, { model: args.model });
  const openLine = args.noOpen ? `\n  Review: ${server.url}` : `\n  Opening ${server.url}`;
  console.error(`${openLine}\n  Press Ctrl-C to stop.`);

  if (!args.noOpen) await open(server.url);

  const shutdown = () => {
    server.close().finally(() => process.exit());
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Queue order: the first review is the one on screen, the next ones preload.
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const slot = next++;
      const session = server.sessions[slot]!;
      const log = items.length > 1 ? prefixed(`[${slot + 1}/${items.length}]`) : console.error;
      await runPipeline(items[slot]!.host, args, session, log).catch((err) => {
        log(`\n✖ ${(err as Error).message}`);
        session.setError((err as Error).message);
        if (items.length === 1) process.exitCode = 1;
      });
    }
  };
  await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
}

function prefixed(prefix: string): (msg: string) => void {
  return (msg) => console.error(msg.replace(/^(\n*)/, `$1${prefix} `));
}

async function runPipeline(
  host: Host,
  args: Args,
  server: SessionHandle,
  log: (msg: string) => void,
) {
  log("→ Fetching diff…");
  server.setProgress({ step: "fetching" });
  // The last review only offers "changes since your last review" in the UI —
  // never block the review on it.
  const [{ meta, diffText, comments: existingComments }, lastReview] = await Promise.all([
    host.fetch(),
    host.getLastReview?.().catch(() => null) ?? null,
  ]);

  const diff = parseUnifiedDiff(diffText);
  const fileCount = diff.files.length;
  const label = meta.host === "local" ? `local ${meta.headRef}` : `${meta.host} #${meta.id}`;
  log(`  ${label}: "${meta.title}" — ${fileCount} file(s)`);

  if (args.architect) {
    log("→ Starting architect review (in parallel)…");
    server.startArchitect(diffText, diff.files);
  }

  if (existingComments.length) {
    log(`  ${existingComments.length} existing comment(s) from reviewers`);
  }

  // Show the diff immediately with a single catch-all group; the real grouping
  // swaps in below once Claude answers.
  server.setPayload(
    {
      meta,
      files: diff.files,
      grouping: fallbackGrouping(diff, "Claude is still grouping the changes."),
      existingComments,
      diffScope: "full",
      ...(lastReview ? { lastReview } : {}),
      reactionsSupported: !!host.toggleReaction,
      architectStarted: args.architect,
      groupingPending: true,
    },
    diffText,
  );

  log("→ Grouping with Claude…");
  const grouping = await groupDiff(diff, diffText, {
    model: args.model,
    onProgress: (completed, batches) => {
      if (batches > 1) log(`  batch ${completed}/${batches}`);
    },
  });
  log(`  ${grouping.groups.length} group(s)` +
    (grouping.ungrouped.length ? `, ${grouping.ungrouped.length} ungrouped hunk(s)` : ""));

  server.setGrouping(grouping);
}

main().catch((err) => {
  console.error(`\n✖ ${(err as Error).message}`);
  process.exit(1);
});
