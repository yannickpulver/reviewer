import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Runs a command, capturing stdout. Optionally writes `input` to stdin. Throws on non-zero exit. */
export type Runner = (cmd: string, args: string[], input?: string) => Promise<RunResult>;

const MAX_OUTPUT = 96 * 1024 * 1024;

/** If stdout is a JSON envelope with a string `result` (claude CLI errors), extract it. */
function jsonResult(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown };
    if (typeof parsed.result === "string" && parsed.result.trim()) return parsed.result.trim();
  } catch {
    // not JSON — fall through to the raw slice
  }
  return undefined;
}

export const runCommand: Runner = (cmd, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let size = 0;

    child.stdout.on("data", (d: Buffer) => {
      size += d.length;
      if (size > MAX_OUTPUT) {
        child.kill();
        reject(new Error(`\`${cmd}\` produced too much output (>${MAX_OUTPUT} bytes)`));
        return;
      }
      out.push(d);
    });
    child.stderr.on("data", (d: Buffer) => errOut.push(d));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(`Command not found: ${cmd}. Is it installed and on PATH?`));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString();
      const stderr = Buffer.concat(errOut).toString();
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Some CLIs (e.g. `claude --output-format json`) report errors on stdout.
        const detail = stderr.trim() || jsonResult(stdout) || stdout.trim().slice(0, 500);
        reject(new Error(`\`${cmd} ${args.join(" ")}\` exited ${code}: ${detail}`));
      }
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
