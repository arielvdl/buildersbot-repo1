import { isAgentEvent } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";

const base = { type: "turn-progress", agentId: "a1", threadId: "t1", turnId: "u1", detail: "Checking the work…" };

describe("turn-progress kind", () => {
  it("is optional", () => {
    expect(isAgentEvent(base)).toBe(true);
  });

  it("accepts each named kind", () => {
    for (const kind of ["read", "search", "check", "write", "coordinate", "other"]) {
      expect(isAgentEvent({ ...base, kind })).toBe(true);
    }
  });

  it("rejects an unknown or malformed kind", () => {
    expect(isAgentEvent({ ...base, kind: "rm -rf" })).toBe(false);
    expect(isAgentEvent({ ...base, kind: 3 })).toBe(false);
  });
});
