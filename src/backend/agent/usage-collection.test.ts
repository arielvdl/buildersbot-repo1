// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cacheHitRate } from "./usage-collection";

describe("cacheHitRate", () => {
  it("is the share of prompt tokens that the cache served", () => {
    expect(cacheHitRate({ uncachedInput: 100, cachedInput: 800, cacheCreation: 100, output: 50 })).toBe(0.8);
  });

  it("is null when no prompt token was counted", () => {
    expect(cacheHitRate({ uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 5 })).toBeNull();
  });

  it("is null when a count is unknown", () => {
    expect(cacheHitRate({ uncachedInput: 10, cachedInput: null, cacheCreation: 0, output: 1 })).toBeNull();
  });
});
