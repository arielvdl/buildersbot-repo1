import type { HubEndpointHit } from "@buildersbot/contracts/ipc";

/**
 * The text that a chosen tool leaves in the draft. It is plain text that holds the connection, the
 * title and the endpoint id, so the agent can describe and call it (the agent still asks the person
 * before it spends).
 */
export function storeToolText(hit: Pick<HubEndpointHit, "title" | "endpointId">): string {
  return `[tool-catalog: ${storeToolTitle(hit.title)} (${hit.endpointId})]`;
}

/** The title as the draft holds it: no brackets or line breaks, so the text reads back as the same chip. */
export function storeToolTitle(title: string): string {
  return title
    .replace(/[\][\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
}

/**
 * A store tool in a draft: the title (no brackets or line breaks) and the endpoint id (the Hub's id rule).
 * The editor shows it as a chip and sends the same text, so a saved draft or a sent message holds the text only.
 */
export const STORE_TOOL_PATTERN = /\[tool-catalog: ([^\][\n]{1,200}) \(([a-z0-9][a-z0-9._-]{0,127})\)\]/gu;

/** The words after a `/` or `$` that may go to the store's search: they read as words, never as a path or a price. */
export function isStoreQuery(query: string): boolean {
  return query.length >= 3 && /^\p{L}[\p{L}\p{N} _-]*$/u.test(query);
}
