import { CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX } from "@buildersbot/contracts/ipc";

/**
 * The messages a person sees in a tab: no plan, subagent step, activity marker or thinking. The SQL
 * has one `?` placeholder, for `${CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX}%`; `VISIBLE_MESSAGE_PARAMETER`
 * is that value.
 */
export const VISIBLE_MESSAGE_FILTER = (column: string) =>
  `COALESCE(json_extract(${column}, '$.message.itemType'), '') NOT IN
     ('plan', 'subagents', 'channel-change', 'commentary')
   AND COALESCE(json_extract(${column}, '$.message.itemType'), '') NOT LIKE ?`;

export const VISIBLE_MESSAGE_PARAMETER = `${CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX}%`;
