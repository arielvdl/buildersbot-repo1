import { type AgentSummary, isAgentSummary } from "./ipc-agents";
import { isBoolean, isDynamicRecord } from "./runtime-values";

/**
 * What `quickChat.ensure` answers: the agent behind the quick chat, made on the first call, and
 * whether this call changed it (it made the agent, or moved it off a model that left the catalog).
 * The agent is local-only and no list carries it, so this answer is the only way a page reads it.
 */
export interface QuickChatEnsureResult {
  agent: AgentSummary;
  changed: boolean;
}

export function isQuickChatEnsureResult(value: unknown): value is QuickChatEnsureResult {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "agent" || key === "changed") &&
    isAgentSummary(value.agent) &&
    value.agent.quickChat === true &&
    isBoolean(value.changed)
  );
}
