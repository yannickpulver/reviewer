import type { PullMeta } from "@/types";

/** URL to view a file on the host at the PR/MR head commit, or null if not derivable. */
export function fileUrl(meta: PullMeta, path: string): string | null {
  if (!meta.headSha) return null;
  if (meta.host === "github") {
    const base = meta.url.replace(/\/pull\/\d+.*$/, "");
    return `${base}/blob/${meta.headSha}/${path}`;
  }
  if (meta.host === "gitlab") {
    const base = meta.url.replace(/\/-\/merge_requests\/\d+.*$/, "");
    return `${base}/-/blob/${meta.headSha}/${path}`;
  }
  return null;
}
