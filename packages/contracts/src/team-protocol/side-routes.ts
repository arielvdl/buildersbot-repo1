// The optional side protocols that every Team API version shares: channels, MCP servers, storage and
// the admin routes in `optional-routes.ts`.
// Each has its own frozen codec, and a route that belongs to one of them never reaches the adapter of
// the negotiated protocol. Every transport, HTTP and WebRTC, client and host, asks here, so a new side
// protocol cannot be added to one of them and left out of another.
//
// The route sets compare `url.pathname` for equality and share no path, so the order of the checks
// below does not change which codec a route gets.
import { withAgentTaskUiBlocks } from "./agent-task-ui-blocks-v1";
import { isChannelAttentionRoute, withChannelAttention } from "./channel-attention-v1";
import { channelTopicsRequest, isChannelTopicsRoute, withChannelTopics } from "./channel-topics-v1";
import { channelRequest, channelResponse, isChannelRoute } from "./channels-v1";
import { isChannelHistoryExtentRoute, withChannelHistoryExtent } from "./history-extent-v1";
import { isMcpRoute, mcpRequest, mcpResponse } from "./mcp-v1";
import { optionalRouteCodec } from "./optional-routes";
import { isStorageRoute, storageRequest, storageResponse } from "./storage-v1";
import type { TeamProtocolV2Json } from "./v2";

export interface TeamSideRouteOptions {
  /**
   * history-extent-v1: a channel page keeps its unloaded length. A host passes the negotiated
   * capability; a client passes `true`, because a host sends the extent only when it was negotiated.
   */
  historyExtent?: boolean;
  /**
   * channel-attention-v1: a channel summary keeps its threads and preview author, and a channel page
   * keeps its UI blocks. A host passes the negotiated capability; a client passes `true`, as above.
   */
  channelAttention?: boolean;
  /** agent-task-ui-blocks-v1: a task conversation keeps its UI blocks. Passed as `channelAttention` is. */
  agentTaskUiBlocks?: boolean;
  /** channel-topics-v1: a channel summary, page, message and task keep their tab. Passed as `channelAttention` is. */
  channelTopics?: boolean;
}

export interface TeamSideRequestOptions {
  /**
   * channel-topics-v1: a channel request keeps its tab, and the tab commands are accepted. A host
   * passes the negotiated capability; a client passes it only for a host that advertises it, so an
   * older host receives exactly the old wire.
   */
  channelTopics?: boolean;
}

export interface TeamSideRouteCodec {
  request(path: string, value: unknown, options?: TeamSideRequestOptions): TeamProtocolV2Json;
  response(path: string, status: number, value: unknown, options?: TeamSideRouteOptions): TeamProtocolV2Json;
}

const CHANNEL_CODEC: TeamSideRouteCodec = {
  request: (path, value, options) =>
    options?.channelTopics ? channelTopicsRequest(path, value) : channelRequest(path, value),
  response: (path, status, value, options) => {
    const projected = channelResponse(path, status, value);
    const extended =
      options?.historyExtent && status < 400 && isChannelHistoryExtentRoute(path)
        ? withChannelHistoryExtent(projected, value)
        : projected;
    const attended =
      options?.channelAttention && status < 400 && isChannelAttentionRoute(path)
        ? withChannelAttention(path, extended, value)
        : extended;
    // After the attention fields: the tab of a thread is added to the threads that they carry.
    return options?.channelTopics && status < 400 && isChannelTopicsRoute(path)
      ? withChannelTopics(path, attended, value)
      : attended;
  },
};
const MCP_CODEC: TeamSideRouteCodec = { request: mcpRequest, response: mcpResponse };
const STORAGE_CODEC: TeamSideRouteCodec = { request: storageRequest, response: storageResponse };

/** The side-protocol codec that owns `path`, or `null` when the negotiated protocol's adapter does. */
export function teamSideRouteCodec(path: string): TeamSideRouteCodec | null {
  if (isChannelRoute(path)) return CHANNEL_CODEC;
  if (isMcpRoute(path)) return MCP_CODEC;
  if (isStorageRoute(path)) return STORAGE_CODEC;
  const admin = optionalRouteCodec(path);
  return admin
    ? {
        request: (_path, value) => admin.request(value),
        response: (path, status, value, options) => {
          const projected = admin.response(status, value);
          return options?.agentTaskUiBlocks && status < 400 ? withAgentTaskUiBlocks(path, projected, value) : projected;
        },
      }
    : null;
}
