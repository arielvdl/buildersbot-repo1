import { isAgentProvider } from "./agent-providers";
import { type AgentModelId, type AgentReasoningEffort, isAgentModel, isReasoningEffort } from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";
import { isBoolean, isDynamicRecord } from "./runtime-values";

/**
 * The model of one quick chat conversation. A conversation with no runtime runs on the model of the quick
 * chat agent. There is no account: the conversation uses the account of the agent (see the spec's D4).
 */
export interface QuickChatRuntime {
  provider: AgentProviderId;
  model: AgentModelId;
  /** Absent for a model that has no effort level. */
  reasoningEffort?: AgentReasoningEffort;
  /** Only the Codex provider has a fast tier. */
  fastMode?: boolean;
}

export function isQuickChatRuntime(value: unknown): value is QuickChatRuntime {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => ["provider", "model", "reasoningEffort", "fastMode"].includes(key)) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    (value.reasoningEffort === undefined || isReasoningEffort(value.reasoningEffort)) &&
    (value.fastMode === undefined || isBoolean(value.fastMode))
  );
}
