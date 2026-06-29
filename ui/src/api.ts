import type { ReviewComment, ReviewPayload } from "./types";

export async function getReview(): Promise<ReviewPayload> {
  const res = await fetch("/api/review");
  if (!res.ok) throw new Error(`Failed to load review (${res.status})`);
  return res.json();
}

export async function submitReview(
  comments: ReviewComment[],
  summary: string,
): Promise<{ url: string }> {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comments, summary }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Submit failed (${res.status})`);
  return data;
}
