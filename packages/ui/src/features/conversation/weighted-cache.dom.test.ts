import { describe, expect, it } from "vitest";
import { createWeightedCache } from "./weighted-cache";

describe("createWeightedCache", () => {
  it("drops the oldest entries when the count is over the limit", () => {
    const cache = createWeightedCache<number>(2, 100);
    cache.set("a", 1, 1);
    cache.set("b", 2, 1);
    cache.set("c", 3, 1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("drops the oldest entries when the weight is over the budget", () => {
    const cache = createWeightedCache<string>(10, 100);
    cache.set("a", "a", 60);
    cache.set("b", "b", 30);
    cache.set("c", "c", 30);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.weight).toBe(60);
    expect(cache.size).toBe(2);
  });

  it("does not keep an entry that weighs more than the budget", () => {
    const cache = createWeightedCache<string>(10, 100);
    cache.set("a", "a", 10);
    cache.set("big", "big", 101);
    expect(cache.get("big")).toBeUndefined();
    expect(cache.get("a")).toBe("a");
  });

  it("counts a replaced key once", () => {
    const cache = createWeightedCache<number>(10, 100);
    cache.set("a", 1, 40);
    cache.set("a", 2, 50);
    expect(cache.get("a")).toBe(2);
    expect(cache.weight).toBe(50);
    expect(cache.size).toBe(1);
  });
});
