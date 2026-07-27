import { describe, it, expect } from "vitest";
import { formatAge } from "./format.js";

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe("formatAge", () => {
  it("formats sub-hour ages in minutes", () => {
    expect(formatAge(ago(5 * 60_000))).toBe("5m");
    expect(formatAge(ago(0))).toBe("0m");
  });

  it("formats sub-day ages in hours", () => {
    expect(formatAge(ago(3 * 60 * 60_000))).toBe("3h");
  });

  it("formats sub-week ages in days", () => {
    expect(formatAge(ago(2 * 24 * 60 * 60_000))).toBe("2d");
  });

  it("formats ages of a week or more in weeks", () => {
    expect(formatAge(ago(21 * 24 * 60 * 60_000))).toBe("3w");
  });
});
