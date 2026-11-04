import { type DynamicRecord, isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES, channelRequest } from "./channels-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional channel-topics-v1 contract: the tabs of a channel. The frozen channels-v1 codec keeps
 * only the keys it lists, so a joined server showed one conversation per channel. This adds, beside
 * the frozen keys of channels-v1:
 *
 * - `topics` on each summary of `GET /v1/channels`: at most 32 tabs in the order they were made, each
 *   `{ id, channelId, name, createdAt, revision }` with the optional counters `updatedAt`,
 *   `unreadCount`, `activeTasks`, `openTasks`, `messageCount` and the optional excerpts `firstMessage`
 *   and `lastUserMessage`. The counters are of that tab only, against the reader's cursor for the tab;
 *   the totals on the summary keep counting every tab;
 * - `topicId` on each thread of a summary that channel-attention-v1 sends, so a wait on a thread
 *   opens its tab;
 * - `topicId` at the top level of the page of `POST /v1/channels/read`, and on each of its messages
 *   and tasks;
 * - `topicId` on the request of `POST /v1/channels/read`, and on the `send` and `read` commands of
 *   `POST /v1/channels/commands`. A request without it names the first tab, as before;
 * - the commands `topic-create` `{ topicId, name? }`, `topic-rename` `{ topicId, name }` and
 *   `topic-delete` `{ topicId }`. Each is answered with the channel, like every command. The last tab
 *   of a channel cannot be deleted, and deleting a tab deletes its messages and its work.
 *
 * The close report of a tab is not on the wire: its record stays on the computer that closed the tab.
 * A routine request is not a wire command, so it carries no tab here.
 *
 * A peer sends and reads these only after it negotiated the capability. A request without it is
 * decoded as channels-v1 decodes it, so an older peer keeps exactly the old wire, and a response
 * without it never carries a tab key. A host without the capability never sends them, so a client
 * accepts them whenever they are present. A present malformed value fails closed. Widening any of it
 * needs a second capability string.
 */
export const TEAM_CHANNEL_TOPICS_CAPABILITY = "channel-topics-v1";

const TOPIC_LIMIT = 32;
// 80 is the tab-name bound, written out because this file keeps IPC limits out.
const NAME_LIMIT = 80;
// A host cuts an excerpt at 2000 characters, and a character can be two UTF-16 units.
const EXCERPT_LIMIT = 4000;
const TOPIC_COMMANDS: readonly string[] = ["topic-create", "topic-rename", "topic-delete"];

function identifier(value: unknown, name: string): string {
  if (!isString(value) || !value.length || value.length > 128) throw new Error(`Invalid channel ${name}.`);
  return value;
}

function text(value: unknown, maximum: number, name: string): string {
  if (!isString(value) || value.length > maximum) throw new Error(`Invalid channel ${name}.`);
  return value;
}

function count(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid channel ${name}.`);
  return value;
}

/** The two channel routes whose responses carry the tab keys: the list of summaries and the page. */
export function isChannelTopicsRoute(path: string): boolean {
  const pathname = new URL(path, "http://buildersbot.invalid").pathname;
  return pathname === CHANNEL_ROUTES.list || pathname === CHANNEL_ROUTES.read;
}

function withTopicId(base: TeamProtocolV2Json, value: DynamicRecord): TeamProtocolV2Json {
  if (value.topicId === undefined || !isDynamicRecord(base)) return base;
  return { ...base, topicId: identifier(value.topicId, "tab") };
}

function topicCommand(value: DynamicRecord): TeamProtocolV2Json {
  const common = {
    type: text(value.type, 32, "command"),
    operationId: identifier(value.operationId, "operation"),
    channelId: identifier(value.channelId, "identifier"),
    topicId: identifier(value.topicId, "tab"),
  };
  if (value.type === "topic-rename") return { ...common, name: text(value.name, NAME_LIMIT, "tab name") };
  if (value.type === "topic-create" && value.name !== undefined)
    return { ...common, name: text(value.name, NAME_LIMIT, "tab name") };
  return common;
}

/**
 * The request of a peer that negotiated the capability: what channels-v1 decodes, plus the tab of a
 * read, of a `send` and of a `read` command, and the three tab commands.
 */
export function channelTopicsRequest(path: string, value: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://buildersbot.invalid").pathname;
  if ((pathname !== CHANNEL_ROUTES.read && pathname !== CHANNEL_ROUTES.command) || !isDynamicRecord(value))
    return channelRequest(path, value);
  if (pathname === CHANNEL_ROUTES.read) return withTopicId(channelRequest(path, value), value);
  if (isString(value.type) && TOPIC_COMMANDS.includes(value.type)) return topicCommand(value);
  const base = channelRequest(path, value);
  return value.type === "send" || value.type === "read" ? withTopicId(base, value) : base;
}

function topic(value: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(value)) throw new Error("Invalid channel tab.");
  const result: { [key: string]: TeamProtocolV2Json } = {
    id: identifier(value.id, "tab"),
    channelId: identifier(value.channelId, "identifier"),
    name: text(value.name, NAME_LIMIT, "tab name"),
    createdAt: text(value.createdAt, 80, "tab date"),
    revision: count(value.revision, "tab revision"),
  };
  if (value.updatedAt !== undefined) result.updatedAt = text(value.updatedAt, 80, "tab date");
  for (const key of ["unreadCount", "activeTasks", "openTasks", "messageCount"]) {
    if (value[key] !== undefined) result[key] = count(value[key], "tab count");
  }
  for (const key of ["firstMessage", "lastUserMessage"]) {
    if (value[key] !== undefined) result[key] = text(value[key], EXCERPT_LIMIT, "tab excerpt");
  }
  return result;
}

function topics(value: unknown): TeamProtocolV2Json[] {
  if (!Array.isArray(value) || value.length > TOPIC_LIMIT) throw new Error("Invalid channel tabs.");
  return value.map(topic);
}

function withSummaryTopics(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const result: { [key: string]: TeamProtocolV2Json } = { ...projected };
  if (source.topics !== undefined) result.topics = topics(source.topics);
  if (Array.isArray(result.threads) && Array.isArray(source.threads)) {
    const threads = source.threads;
    result.threads = result.threads.map((thread, index) => {
      const topicId = isDynamicRecord(threads[index]) ? threads[index].topicId : undefined;
      return topicId === undefined || !isDynamicRecord(thread)
        ? thread
        : { ...thread, topicId: identifier(topicId, "tab") };
    });
  }
  return result;
}

/** `entries` with the tab of the entry of `source` at the same place, when `source` names one. */
function withEntryTopics(entries: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!Array.isArray(entries) || !Array.isArray(source)) return entries;
  return entries.map((entry, index) => {
    const topicId = isDynamicRecord(source[index]) ? source[index].topicId : undefined;
    return topicId === undefined || !isDynamicRecord(entry) ? entry : { ...entry, topicId: identifier(topicId, "tab") };
  });
}

function withPageTopics(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const result: { [key: string]: TeamProtocolV2Json } = { ...projected };
  if (source.topicId !== undefined) result.topicId = identifier(source.topicId, "tab");
  if (result.messages !== undefined) result.messages = withEntryTopics(result.messages, source.messages);
  if (result.tasks !== undefined) result.tasks = withEntryTopics(result.tasks, source.tasks);
  return result;
}

/** `projected` with the tab keys of `source` that the channels-v1 codec dropped. */
export function withChannelTopics(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://buildersbot.invalid").pathname;
  if (pathname === CHANNEL_ROUTES.read) return withPageTopics(projected, source);
  if (pathname !== CHANNEL_ROUTES.list || !Array.isArray(projected) || !Array.isArray(source)) return projected;
  return projected.map((summary, index) => withSummaryTopics(summary, source[index]));
}
