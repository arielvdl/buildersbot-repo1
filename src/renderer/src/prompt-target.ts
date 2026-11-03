import { attentionKey } from "./features/agents/agent-runtime-snapshot";

export type PromptSubject = { id: string; threadId: string | null };

/**
 * The agent that an answer goes to: the subject that a page names, else the active agent. The Quick
 * chat agent is in no roster, so the active agent is never it, and an answer that read the active
 * agent looked at another agent's prompt and went nowhere.
 */
export function answeringAgent<Agent extends PromptSubject>(
  subject: PromptSubject | undefined,
  active: Agent | undefined,
): PromptSubject | undefined {
  return subject ?? active;
}

/** The key of the prompt that waits in the agent's own chat, or in its side thread `threadId`. */
export function promptKeyOf(agent: PromptSubject, threadId?: string): string {
  return attentionKey(agent.id, threadId ?? agent.threadId);
}
