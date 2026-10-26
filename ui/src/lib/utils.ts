import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Coarse age of an ISO timestamp, e.g. "5m", "3h", "2d", "3w". */
export function timeAgo(iso: string): string {
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}
