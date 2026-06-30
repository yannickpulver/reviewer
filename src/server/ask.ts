import { runCommand, type Runner } from "../util/exec.js";

interface ClaudeEnvelope {
  result?: string;
  is_error?: boolean;
}

export interface AskInput {
  path: string;
  /** New-file line number the question is focused on. */
  line: number;
  /** Unified-diff hunk text providing context. */
  code: string;
  question: string;
}

/** Ask the local `claude` CLI a free-form question about a diff line. */
export async function askClaude(input: AskInput, run: Runner = runCommand): Promise<string> {
  const { stdout } = await run("claude", ["-p", "--output-format", "json"], buildAskPrompt(input));
  const env = JSON.parse(stdout) as ClaudeEnvelope;
  if (env.is_error || typeof env.result !== "string") {
    throw new Error("claude returned an error envelope");
  }
  return env.result.trim();
}

function buildAskPrompt({ path, line, code, question }: AskInput): string {
  return `You are helping a developer review a pull request. Answer their question about the code below. Be concise and specific, refer to the actual code, and respond in Markdown.

File: ${path}
The reader is focused on line ${line} (new-file line number).

Relevant hunk (unified diff):
${code}

Question: ${question}`;
}
