/** The most characters of the notice that a chat turn gets about the other lines of its agent. */
const LINES_NOTICE_LIMIT = 300;
/** The first words of the notice. A reader of provider history uses them to find the notice. */
export const LINES_NOTICE_START = "Builders Bot note: other lines of this agent work now:";
const LINES_NOTICE_END = "Do not change the same files there without a reason.";
const NAME_LIMIT = 40;
const RESOURCE_LIMIT = 80;

/** A channel tab where the agent works with a resource that it reserved. */
export interface LineNoticeEntry {
  channelName: string;
  topicName: string | null;
  /** The reserved resources: `browser` or `workspace:<path>`. */
  resources: readonly string[];
}

/**
 * A name or a path as one short line of plain text: no line break, no control or format character
 * (a tab name comes from the conversation, so it is untrusted), no double quote, at most `limit`
 * characters.
 */
function oneLine(text: string, limit: number): string {
  const flat = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/"/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = [...flat];
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : flat;
}

/** A name between double quotes, so it reads as a name and never as an instruction. */
function quoted(text: string): string {
  return `"${oneLine(text, NAME_LIMIT)}"`;
}

/**
 * One short note for the chat turn of an agent that works in channel tabs with a reserved `browser` or
 * `workspace:`. It has the channel and tab names and the resources, never text of the conversation.
 * Null when no tab reserved a resource, so a turn without a possible conflict costs no tokens.
 */
export function linesNotice(entries: readonly LineNoticeEntry[]): string | null {
  const shown = entries.filter((entry) => entry.resources.length > 0);
  if (!shown.length) return null;
  const items = shown.map((entry) => {
    const place = [entry.channelName, entry.topicName].filter(Boolean).map((name) => quoted(name ?? ""));
    return `${place.join(" / ")} (${entry.resources.map((resource) => oneLine(resource, RESOURCE_LIMIT)).join(", ")})`;
  });
  const fixed = `${LINES_NOTICE_START}  ${LINES_NOTICE_END}`.length;
  let body = "";
  for (const [index, item] of items.entries()) {
    const next = body ? `${body}; ${item}` : item;
    const more = items.length - index - 1;
    const tail = more > 0 ? `; +${more} more` : "";
    if (fixed + next.length + tail.length > LINES_NOTICE_LIMIT) {
      body = body ? `${body}; +${items.length - index} more` : oneLine(item, LINES_NOTICE_LIMIT - fixed);
      break;
    }
    body = next;
  }
  return `${LINES_NOTICE_START} ${body}. ${LINES_NOTICE_END}`;
}
