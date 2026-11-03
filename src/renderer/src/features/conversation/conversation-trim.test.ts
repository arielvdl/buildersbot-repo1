import type { AgentMessage } from "@buildersbot/ui/data";
import { describe, expect, it } from "vitest";
import { agentMessageKey } from "./conversation-keys";
import { LATEST_PAGE_SIZE, trimConversationToLatestPage } from "./conversation-trim";

function message(id: string, replyToMessageId: string | null = null): AgentMessage {
  return { id, author: "agent", body: `text of ${id}`, time: "", replyToMessageId };
}

function bodiesOf(agentId: string, messages: readonly AgentMessage[]): Map<string, string> {
  return new Map(messages.map((entry) => [agentMessageKey(agentId, entry.id), entry.body]));
}

describe("the trim of a conversation that is not open", () => {
  it("keeps the newest page and drops the raw bodies of the messages it removes", () => {
    const messages = Array.from({ length: LATEST_PAGE_SIZE + 10 }, (_, index) => message(`m${index}`));
    const bodies = bodiesOf("agent-1", messages);
    const conversation = { messages: [...messages] };

    trimConversationToLatestPage("agent-1", conversation, bodies);

    expect(conversation.messages).toHaveLength(LATEST_PAGE_SIZE);
    expect(conversation.messages[0]?.id).toBe("m10");
    expect(bodies.has(agentMessageKey("agent-1", "m9"))).toBe(false);
    expect(bodies.has(agentMessageKey("agent-1", "m10"))).toBe(true);
    expect(bodies.size).toBe(LATEST_PAGE_SIZE);
  });

  it("keeps the body of another agent, and the quote of a removed message", () => {
    const messages = Array.from({ length: LATEST_PAGE_SIZE + 2 }, (_, index) => message(`m${index}`));
    const quoted = message("m1");
    messages[messages.length - 1] = message("last", "m1");
    const bodies = bodiesOf("agent-1", messages);
    bodies.set(agentMessageKey("agent-2", "m1"), "other agent");
    const conversation: { messages: AgentMessage[]; references?: Record<string, AgentMessage> } = {
      messages: [...messages],
    };

    trimConversationToLatestPage("agent-1", conversation, bodies);

    expect(bodies.get(agentMessageKey("agent-2", "m1"))).toBe("other agent");
    expect(bodies.has(agentMessageKey("agent-1", "m1"))).toBe(false);
    expect(conversation.references?.m1).toEqual(quoted);
  });

  it("leaves a page that already fits untouched", () => {
    const messages = Array.from({ length: LATEST_PAGE_SIZE }, (_, index) => message(`m${index}`));
    const bodies = bodiesOf("agent-1", messages);
    const conversation = { messages: [...messages] };

    trimConversationToLatestPage("agent-1", conversation, bodies);

    expect(conversation.messages).toHaveLength(LATEST_PAGE_SIZE);
    expect(bodies.size).toBe(LATEST_PAGE_SIZE);
  });
});
