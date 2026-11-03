import type { ChannelPage } from "@buildersbot/contracts/ipc";

/** The most characters of a thought in the bubble. A longer sentence is cut at a word and ends with "…". */
const THOUGHT_LIMIT = 110;
/**
 * A sentence that is still being written shows only when it is this long, and then only its first
 * `THOUGHT_LIMIT` characters. Its head does not change as the sentence grows, so the bubble stays still.
 */
const PARTIAL_MIN = 48;
/** The end of the messages that is read for the thought of an agent. */
const MESSAGE_TAIL = 60;

const SENTENCE_END = /[.!?…:]["')\]]*$/u;

/** The words of the reasoning without its markdown, on one line. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[*_`#>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function clipped(sentence: string): string {
  if (sentence.length <= THOUGHT_LIMIT) return sentence;
  const cut = sentence.slice(0, THOUGHT_LIMIT - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > THOUGHT_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/u, "")}…`;
}

/**
 * The line of a thought for the speech bubble: the last sentence that the agent finished writing, as
 * it wrote it. A thought with no finished sentence yet shows its head, once it is long enough, cut
 * where the bubble ends. Both stay the same while the agent writes on, so the bubble changes once for
 * each sentence and not once for each token. `null`: nothing worth a bubble yet.
 */
export function stageThoughtLine(text: string): string | null {
  const words = plain(text);
  if (!words) return null;
  // A sentence ends at a stop followed by a space. A stop with no space after it (a file name, a number) does not.
  const sentences = words.split(/(?<=[.!?…:])\s+/u).filter((sentence) => sentence.length > 0);
  const finished = SENTENCE_END.test(words) ? sentences : sentences.slice(0, -1);
  const last = finished.at(-1);
  if (last && last.length > 2) return clipped(last);
  const partial = sentences.at(-1) ?? "";
  return partial.length >= PARTIAL_MIN ? clipped(partial) : null;
}

/**
 * What an agent thinks now: its newest thinking or narration in the tail of the page, from the turn
 * that it works on. It is the text that the chat shows under "Thinking", so the bubble says what the agent really thinks.
 */
export function agentThoughtLine(page: ChannelPage, agentId: string, turnId: string | undefined): string | null {
  const start = Math.max(0, page.messages.length - MESSAGE_TAIL);
  for (let index = page.messages.length - 1; index >= start; index -= 1) {
    const entry = page.messages[index];
    if (!entry || entry.author.id !== agentId || entry.message.itemType !== "commentary") continue;
    if (turnId && entry.message.turnId && entry.message.turnId !== turnId) return null;
    const line = stageThoughtLine(entry.message.text);
    if (line) return line;
  }
  return null;
}
