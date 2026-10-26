import { createContext, useContext } from "react";
import type {
  ArchitectReview,
  QueueEntry,
  Reaction,
  RefreshResponse,
  ReviewAction,
  ReviewApiResponse,
  ReviewComment,
} from "./types";

export async function getQueue(): Promise<QueueEntry[]> {
  const res = await fetch("/api/queue");
  if (!res.ok) throw new Error(`Failed to load reviews (${res.status})`);
  return res.json();
}

/** The API of one queued review, served under `/api/s/<slot>/`. */
export function createApi(slot: number) {
  const base = `/api/s/${slot}`;

  async function post<T>(path: string, label: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `${label} failed (${res.status})`);
    return data;
  }

  return {
    /** Load a description image through the server, with the host CLI's credentials. */
    imageUrl: (url: string) => `${base}/image?url=${encodeURIComponent(url)}`,

    async getReview(): Promise<ReviewApiResponse> {
      const res = await fetch(`${base}/review`);
      if (!res.ok) throw new Error(`Failed to load review (${res.status})`);
      return res.json();
    },

    submitReview: (
      comments: ReviewComment[],
      summary: string,
      action: ReviewAction,
    ): Promise<{ url: string }> => post("/review", "Submit", { comments, summary, action }),

    refreshReview: (): Promise<RefreshResponse> => post("/refresh", "Refresh"),

    runArchitectReview: (force = false): Promise<ArchitectReview> =>
      post(`/architect-review${force ? "?force=1" : ""}`, "Review"),

    toggleReaction: async (
      commentId: string,
      content: string,
      remove: boolean,
    ): Promise<Reaction[]> =>
      (await post<{ reactions: Reaction[] }>("/react", "Reaction", { commentId, content, remove }))
        .reactions,

    askClaude: (
      path: string,
      line: number,
      code: string,
      question: string,
    ): Promise<{ answer: string }> => post("/ask", "Ask", { path, line, code, question }),
  };
}

export type Api = ReturnType<typeof createApi>;

/** The API of the review a component is rendered in. */
export const ApiContext = createContext<Api>(createApi(0));

export const useApi = () => useContext(ApiContext);
