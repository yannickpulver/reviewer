import { describe, it, expect } from "vitest";
import { parseInput } from "./detect.js";

describe("parseInput", () => {
  it("parses a bare number", () => {
    expect(parseInput("42")).toEqual({ kind: "number", id: 42 });
    expect(parseInput("  7 ")).toEqual({ kind: "number", id: 7 });
  });

  it("parses a GitHub PR URL", () => {
    expect(parseInput("https://github.com/org/repo/pull/42")).toEqual({
      kind: "url",
      target: { host: "github", id: 42, repo: "org/repo" },
    });
  });

  it("qualifies a GitHub Enterprise PR URL with its host", () => {
    expect(parseInput("https://acme.ghe.com/acme/widgets/pull/1481")).toEqual({
      kind: "url",
      target: { host: "github", id: 1481, repo: "acme.ghe.com/acme/widgets" },
    });
  });

  it("parses a GitLab MR URL with subgroups", () => {
    expect(parseInput("https://gitlab.com/group/sub/repo/-/merge_requests/13")).toEqual({
      kind: "url",
      target: { host: "gitlab", id: 13, repo: "group/sub/repo" },
    });
  });

  it("recognizes self-hosted gitlab hostnames", () => {
    const r = parseInput("https://gitlab.example.com/team/app/-/merge_requests/5");
    expect(r).toEqual({
      kind: "url",
      target: { host: "gitlab", id: 5, repo: "team/app" },
    });
  });

  it("rejects unknown input", () => {
    expect(() => parseInput("not-a-thing")).toThrow();
    expect(() => parseInput("https://example.com/foo/bar")).toThrow();
    expect(() => parseInput("https://github.com/org/repo/issues/3")).toThrow();
  });
});
