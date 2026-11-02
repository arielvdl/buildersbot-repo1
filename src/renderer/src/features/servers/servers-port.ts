import type { BuildersBotDesktopApi, ServerSummary } from "@buildersbot/contracts/ipc";

/**
 * What the servers domain reaches in main: the server list and selection, the account changes, the local host, the
 * settings of one server, the name, logo and update of a joined server's host, the servers that
 * run on this computer, and the remote desktop setup of a server.
 */
export interface ServersPort {
  agent: Pick<
    BuildersBotDesktopApi["agent"],
    | "getStatus"
    | "listAgents"
    | "listConversationReads"
    | "listHiddenAgents"
    | "listMcpServers"
    | "listModels"
    | "removeMcpServer"
    | "saveMcpServer"
    | "setMcpServerEnabled"
    | "testMcpServer"
    | "signInMcpServer"
    | "mcpSignInPage"
    | "mcpSignInRelay"
    | "openMcpSignInRelay"
    | "completeMcpSignInRelay"
    | "cancelMcpSignIn"
    | "signOutMcpServer"
    | "listMcpSignIns"
    | "mcpSignInApp"
    | "saveMcpSignInApp"
    | "removeMcpSignInApp"
  >;
  events: BuildersBotDesktopApi["events"];
  auth: Pick<BuildersBotDesktopApi["auth"], "onEvent">;
  browser: Pick<BuildersBotDesktopApi["browser"], "setVisible">;
  hostAdmin: Pick<
    BuildersBotDesktopApi["hostAdmin"],
    "cancelUpdate" | "getUpdateStatus" | "startUpdate" | "updateIdentity"
  >;
  hostedServers: Pick<BuildersBotDesktopApi["hostedServers"], "list" | "restart" | "wake">;
  localServers: BuildersBotDesktopApi["localServers"];
  host: Pick<
    BuildersBotDesktopApi["host"],
    | "configure"
    | "getStatus"
    | "onEvent"
    | "recheckScreenRecording"
    | "rotateIdentityKey"
    | "start"
    | "stop"
    | "updateIdentity"
  >;
  notifications: Pick<BuildersBotDesktopApi["notifications"], "onOpened">;
  remoteDesktop: Pick<
    BuildersBotDesktopApi["remoteDesktop"],
    "checkSetup" | "connect" | "disconnect" | "list" | "openSetup" | "test"
  >;
  servers: Pick<
    BuildersBotDesktopApi["servers"],
    | "getPresenceFor"
    | "join"
    | "list"
    | "onEvent"
    | "onPresence"
    | "refreshIdentity"
    | "remove"
    | "reorder"
    | "retryConnection"
    | "select"
    | "setMuted"
    | "setNotificationLevel"
  >;
}

/** Read on each call: tests and stories replace `window.buildersbot` per case. */
export function serversPort(): ServersPort {
  return window.buildersbot;
}

/**
 * The member and invite calls for one server. This computer answers them for the local server
 * through `host`; a remote server answers them through `servers`, addressed by its id.
 */
export type ServerAdminPort = Pick<
  BuildersBotDesktopApi["host"],
  "getPresence" | "listMembers" | "listInvites" | "createInvite" | "updateMember" | "removeMember" | "revokeInvite"
>;

export function serverAdminPort(server: Pick<ServerSummary, "id" | "kind">): ServerAdminPort {
  if (server.kind === "local") return window.buildersbot.host;
  const serverId = server.id;
  return {
    getPresence: () => window.buildersbot.servers.getPresenceFor(serverId),
    listMembers: () => window.buildersbot.servers.listMembers(serverId),
    listInvites: () => window.buildersbot.servers.listInvites(serverId),
    createInvite: (input) => window.buildersbot.servers.createInvite(input, serverId),
    updateMember: (input) => window.buildersbot.servers.updateMember(input, serverId),
    removeMember: (memberId) => window.buildersbot.servers.removeMember(memberId, serverId),
    revokeInvite: (inviteId) => window.buildersbot.servers.revokeInvite(inviteId, serverId),
  };
}

/** The server main marks active. A test teardown can remove the bridge while a join is pending. */
export async function activeServerId(): Promise<string> {
  if (!window.buildersbot) return "local";
  return (await window.buildersbot.servers.list()).find((item) => item.active)?.id ?? "local";
}
