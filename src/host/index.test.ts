import { describe, it, expect } from "vitest";
import { detectHostFromRemote, pullRank, type PullSummary } from "./index.js";
import type { Runner } from "../util/exec.js";

const noRun: Runner = async () => ({ stdout: "", stderr: "" });

describe("pullRank", () => {
  const base: PullSummary = {
    id: 1,
    title: "t",
    author: "a",
    state: "open",
    reviewRequestedFromMe: false,
    assignedToMe: false,
  };
  it("orders review-requested before assigned before other", () => {
    expect(pullRank({ ...base, reviewRequestedFromMe: true, assignedToMe: true })).toBe(0);
    expect(pullRank({ ...base, assignedToMe: true })).toBe(1);
    expect(pullRank(base)).toBe(2);
  });
});

describe("detectHostFromRemote", () => {
  it("detects github.com (ssh + https)", async () => {
    expect(await detectHostFromRemote("git@github.com:org/repo.git", noRun)).toBe("github");
    expect(await detectHostFromRemote("https://github.com/org/repo.git", noRun)).toBe("github");
  });

  it("detects GitHub Enterprise .ghe.com without probing", async () => {
    expect(
      await detectHostFromRemote("git@acme.ghe.com:acme/widgets.git", noRun),
    ).toBe("github");
  });

  it("detects github.* enterprise hostnames", async () => {
    expect(await detectHostFromRemote("git@github.acme.com:team/app.git", noRun)).toBe("github");
  });

  it("detects gitlab.com and self-hosted gitlab.*", async () => {
    expect(await detectHostFromRemote("git@gitlab.com:group/repo.git", noRun)).toBe("gitlab");
    expect(await detectHostFromRemote("https://gitlab.example.com/g/r.git", noRun)).toBe("gitlab");
  });

  it("probes the gh CLI for fully custom enterprise domains", async () => {
    const run: Runner = async (cmd) => {
      if (cmd === "gh") {
        return { stdout: "✓ Logged in to git.company.com as alice", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };
    expect(await detectHostFromRemote("git@git.company.com:team/app.git", run)).toBe("github");
  });

  it("probes the glab CLI when gh doesn't know the host", async () => {
    const run: Runner = async (cmd) => {
      if (cmd === "gh") throw new Error("not logged in");
      if (cmd === "glab") return { stdout: "code.company.com — logged in", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    expect(await detectHostFromRemote("git@code.company.com:team/app.git", run)).toBe("gitlab");
  });

  it("returns null when nothing recognizes the host", async () => {
    expect(await detectHostFromRemote("git@mystery.example:team/app.git", noRun)).toBeNull();
  });
});
