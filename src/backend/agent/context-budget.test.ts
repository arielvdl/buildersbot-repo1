import {
  CONTEXT_COMPACTION_BUDGET_TOKENS,
  CONTEXT_WARNING_TOKENS,
  contextCompactionShare,
  contextCompactionTokens,
} from "@buildersbot/contracts/context-budget";
import { describe, expect, it } from "vitest";

describe("the context budget", () => {
  it("compacts a window of 1 million tokens at the budget, not at 800,000", () => {
    expect(contextCompactionTokens(1_048_576)).toBe(CONTEXT_COMPACTION_BUDGET_TOKENS);
    expect(contextCompactionShare(1_000_000)).toBeCloseTo(0.5, 5);
  });

  it("keeps 80% of a window that is under 625,000 tokens", () => {
    expect(contextCompactionTokens(200_000)).toBe(160_000);
    expect(contextCompactionShare(262_144)).toBeCloseTo(0.8, 2);
  });

  it("warns before it compacts", () => {
    expect(CONTEXT_WARNING_TOKENS).toBeLessThan(CONTEXT_COMPACTION_BUDGET_TOKENS);
  });

  it("gives 80% for a window that is not known", () => {
    expect(contextCompactionShare(0)).toBe(0.8);
  });
});
