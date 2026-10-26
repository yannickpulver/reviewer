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

/**
 * Absolute URL for an image or link in the PR/MR description. GitLab writes
 * uploads as `/uploads/…`, relative to the project rather than the host.
 */
export function descriptionUrl(meta: PullMeta, src: string): string {
  if (meta.host === "gitlab" && src.startsWith("/uploads/")) {
    return meta.url.replace(/\/-\/merge_requests\/\d+.*$/, "") + src;
  }
  try {
    return new URL(src, meta.url || undefined).href;
  } catch {
    return src;
  }
}

/** Drop GitLab's `{width=900 height=582}` image attributes, which plain markdown shows as text. */
export function cleanDescription(markdown: string): string {
  return markdown.replace(/(!\[[^\]]*\]\([^)]*\))\{[^}\n]*\}/g, "$1");
}
