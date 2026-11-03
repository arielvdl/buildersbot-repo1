import { expandAttachmentReferences, stripAttachmentReferences } from "@buildersbot/contracts/attachment-references";

/** The prompt that asks for a title of a quick chat conversation. Only the title is the answer. */
export function quickChatTitlePrompt(asked: string, answered: string): string {
  // The words only: an attachment marker such as `@[image.png](attachment:id)` says nothing about the subject.
  const request = stripAttachmentReferences(asked) || expandAttachmentReferences(asked);
  return [
    "Write a title for this conversation.",
    "Rules: at most 6 words, in the language of the person's message, no quotes, no final punctuation,",
    "no markdown. Name the subject of the conversation, not the first words of the message.",
    "Answer with the title only.",
    "",
    `Person's message:\n${request.slice(0, 800)}`,
    "",
    `Answer:\n${answered.slice(0, 800)}`,
  ].join("\n");
}

/** The title that a model wrote, as one plain line, or null when nothing usable is left. */
export function cleanQuickChatTitle(text: string): string | null {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  const title = (line ?? "")
    .replace(/^(title|título)\s*:\s*/i, "")
    .replace(/^[\s"'“”‘’`*#_-]+|[\s"'“”‘’`*#_.]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return title || null;
}
