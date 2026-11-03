import { describe, expect, it } from "vitest";
import { attentionKey } from "./features/agents/agent-runtime-snapshot";
import { answeringAgent, promptKeyOf } from "./prompt-target";

const rosterAgent = { id: "agent-roster", threadId: "thread-roster" };
const quickChatAgent = { id: "agent-quick", threadId: "thread-quick" };

describe("answeringAgent", () => {
  it("answers the Quick chat agent, not the roster's active agent", () => {
    expect(answeringAgent(quickChatAgent, rosterAgent)).toBe(quickChatAgent);
  });

  it("answers the active agent when no page names a subject", () => {
    expect(answeringAgent(undefined, rosterAgent)).toBe(rosterAgent);
  });

  it("answers nobody when there is neither", () => {
    expect(answeringAgent(undefined, undefined)).toBeUndefined();
  });
});

describe("promptKeyOf", () => {
  it("finds the prompt of the Quick chat conversation that is open", () => {
    expect(promptKeyOf(quickChatAgent, "side-thread")).toBe(attentionKey("agent-quick", "side-thread"));
  });

  it("falls back to the agent's own chat thread", () => {
    expect(promptKeyOf(quickChatAgent)).toBe(attentionKey("agent-quick", "thread-quick"));
  });
});
