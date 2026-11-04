import type { SidebarLayoutAction } from "@buildersbot/contracts/ipc";
import type { DynamicRecord } from "@buildersbot/contracts/runtime-values";
import { SIDEBAR_STYLE_CAPABILITY, SIDEBAR_STYLE_ROUTES } from "@buildersbot/contracts/team-protocol/sidebar-style-v1";
import { sourceText } from "@buildersbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseSidebarLayoutAction } from "../ipc/agent-inputs";
import type { TeamApiAgents, TeamApiSidebarLayout } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/** The wire codec bounds the action; this parser also checks what the codec does not, such as an image. */
function parseAction(body: DynamicRecord): SidebarLayoutAction {
  try {
    return parseSidebarLayoutAction(body);
  } catch {
    throw new HttpError(400, "A valid sidebar action is required.");
  }
}

/**
 * The sidebar layout with its colors, icons and markers, from a joined server. The released
 * `/v1/sidebar-layout` routes keep their five keys for every peer; a peer that negotiated
 * `sidebar-style-v1` reads and changes the whole layout here. The action is the one that the released
 * route takes, and the answer is the layout after it. A member who may not see an agent cannot name it
 * in an action, and its id is left out of the answer by the hidden-agent view. Frozen by
 * `sidebar-style-v1`.
 */
export async function routeSidebarStyle(
  context: TeamApiRequestContext,
  sidebarLayout: Pick<TeamApiSidebarLayout, "getSnapshot" | "mutate">,
  agents: Pick<TeamApiAgents, "sidebarChatIds">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST") return "unmatched";
  if (url.pathname !== SIDEBAR_STYLE_ROUTES.read && url.pathname !== SIDEBAR_STYLE_ROUTES.action) return "unmatched";
  if (!capabilities.has(SIDEBAR_STYLE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.sidebarStyleUnsupported"));
  // `readJson` has already run the body through the sidebar-style wire codec.
  const body = await readJson(request);
  if (url.pathname === SIDEBAR_STYLE_ROUTES.read) return json(200, sidebarLayout.getSnapshot());
  const action = parseAction(body);
  const named = [
    "agentId" in action ? action.agentId : undefined,
    "beforeAgentId" in action ? action.beforeAgentId : undefined,
    "beforeId" in action ? action.beforeId : undefined,
  ];
  if (named.some((id) => id && hiddenAgentIds.has(id)))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  return json(200, await runCauseEffect(sidebarLayout.mutate(action, agents.sidebarChatIds())));
}
