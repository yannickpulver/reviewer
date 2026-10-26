import { describe, it, expect } from "vitest";
import type { PullMeta } from "../types";
import { cleanDescription, descriptionUrl } from "./links";

function meta(host: PullMeta["host"], url: string): PullMeta {
  return {
    host, id: 1, title: "", author: "", url, baseRef: "main", headRef: "x",
    headSha: "abc", state: "open", description: "",
  };
}

describe("descriptionUrl", () => {
  it("resolves GitLab uploads against the project, not the host", () => {
    const m = meta("gitlab", "https://gitlab.example.com/group/repo/-/merge_requests/95");
    expect(descriptionUrl(m, "/uploads/abc/shot.png")).toBe(
      "https://gitlab.example.com/group/repo/uploads/abc/shot.png",
    );
  });

  it("keeps absolute URLs", () => {
    const m = meta("github", "https://github.com/o/r/pull/1");
    const src = "https://github.com/user-attachments/assets/123";
    expect(descriptionUrl(m, src)).toBe(src);
  });
});

describe("cleanDescription", () => {
  it("drops GitLab image attributes", () => {
    expect(cleanDescription("![a](/uploads/x/a.png){width=900 height=582} after")).toBe(
      "![a](/uploads/x/a.png) after",
    );
  });
});
