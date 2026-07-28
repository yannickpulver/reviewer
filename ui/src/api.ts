import type { ArchitectReview, ReviewAction, ReviewApiResponse, ReviewComment } from "./types";

export async function getReview(): Promise<ReviewApiResponse> {
  const res = await fetch("/api/review");
  if (!res.ok) throw new Error(`Failed to load review (${res.status})`);
  return res.json();
}

export async function submitReview(
  comments: ReviewComment[],
  summary: string,
  action: ReviewAction,
): Promise<{ url: string }> {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comments, summary, action }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Submit failed (${res.status})`);
  return data;
}

export async function runArchitectReview(force = false): Promise<ArchitectReview> {
  const res = await fetch(`/api/architect-review${force ? "?force=1" : ""}`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Review failed (${res.status})`);
  return data;
}

export async function askClaude(
  path: string,
  line: number,
  code: string,
  question: string,
): Promise<{ answer: string }> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, line, code, question }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Ask failed (${res.status})`);
  return data;
}
