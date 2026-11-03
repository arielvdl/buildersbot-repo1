import { leadingAddress } from "@buildersbot/contracts/chat-tag-references";

/**
 * The agent that a message of the Quick chat calls, when it opens with an `@` tag, and the text without
 * the tags that call. A tag after the first word is a reference in the text and calls no one. A message
 * that has only the tag has no text to send.
 */
export function calledAgent(text: string): { agentId: string; text: string } | null {
  const { mentions } = leadingAddress(text);
  const first = mentions[0];
  const last = mentions.at(-1);
  if (!first || !last) return null;
  return {
    agentId: first.id,
    text: text
      .slice(last.end)
      .replace(/^[\s,]+/u, "")
      .trim(),
  };
}
