import type { AgentMessage } from "@buildersbot/ui/data";
import { agentMessageKey } from "./conversation-keys";

/** How much of a conversation a window keeps when the conversation is not open. */
export const LATEST_PAGE_SIZE = 50;

/** The parts of a conversation that a trim reads and writes. */
export interface TrimmedConversation {
  messages: AgentMessage[];
  references?: Record<string, AgentMessage> | undefined;
  page?: { hasOlder: boolean; olderCursor: string | null } | undefined;
}

/**
 * Keeps the newest page of a conversation that is not open. A message that leaves the transcript
 * also loses its raw body, or the bodies of every message of the session would stay in memory.
 */
export function trimConversationToLatestPage(
  agentId: string,
  conversation: TrimmedConversation,
  messageBodies: Map<string, string>,
): void {
  if (conversation.messages.length <= LATEST_PAGE_SIZE) return;
  const kept = conversation.messages.slice(-LATEST_PAGE_SIZE);
  const removedById = new Map(
    conversation.messages.slice(0, -LATEST_PAGE_SIZE).map((message) => [message.id, message]),
  );
  // A kept reply keeps the quote of an original that the trim removes, as a page from the host gives it.
  const references: Record<string, AgentMessage> = {};
  for (const message of kept) {
    const originalId = message.replyToMessageId;
    const original = originalId ? (removedById.get(originalId) ?? conversation.references?.[originalId]) : undefined;
    if (originalId && original) references[originalId] = original;
  }
  for (const messageId of removedById.keys()) messageBodies.delete(agentMessageKey(agentId, messageId));
  conversation.messages = kept;
  conversation.references = references;
  conversation.page = { hasOlder: true, olderCursor: null };
}
