import type { HubEndpointHit } from "@buildersbot/contracts/ipc";

/**
 * The text that a chosen tool leaves in the draft. It is plain text that holds the connection, the
 * title and the endpoint id, so the agent can describe and call it (the agent still asks the person
 * before it spends).
 */
export function storeToolText(hit: HubEndpointHit): string {
  return `[tool-catalog: ${hit.title} (${hit.endpointId})]`;
}
