import { type AgentTask, isAgentTask } from "./ipc-agent-tasks";
import { type AgentSummary, isAgentSummary } from "./ipc-agents";
import { isIdentifier } from "./ipc-bounded-values";
import { isQuickChatRuntime, type QuickChatRuntime } from "./ipc-quick-chat-runtime";
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

/** Changes the model of one quick chat conversation. It takes effect with the next message of that conversation. */
export interface SetQuickChatConversationRuntimeInput {
  agentId: string;
  taskId: string;
  runtime: QuickChatRuntime;
}

export function isSetQuickChatConversationRuntimeInput(value: unknown): value is SetQuickChatConversationRuntimeInput {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "agentId" || key === "taskId" || key === "runtime") &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.taskId) &&
    isQuickChatRuntime(value.runtime)
  );
}

/**
 * What `quickChat.setConversationRuntime` answers: the conversation with its new runtime, and the quick
 * chat agent, whose model is now the default of the next new conversation. No list carries that agent.
 */
export interface QuickChatConversationRuntimeResult {
  task: AgentTask;
  agent: AgentSummary;
}

export function isQuickChatConversationRuntimeResult(value: unknown): value is QuickChatConversationRuntimeResult {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "task" || key === "agent") &&
    isAgentTask(value.task) &&
    isAgentSummary(value.agent) &&
    value.agent.quickChat === true
  );
}
