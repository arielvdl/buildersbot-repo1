// The bundled Builders CLI (`opencode acp`) of `quick-chat-core-e2e.ts`, as the Cultura Builder driver
// starts it. Like `cultura-builder.ts`, but it also answers a prompt: one line of text, then the end of
// the turn. It writes each prompt to the log, so a test can tell that a turn really reached the provider.
//
// A prompt can hold lines of the form `@@tool {"name":"send_message","arguments":{...}}`. The turn then calls
// that tool of the `buildersbot` MCP server that the app gave the session, in order, before it ends, and
// logs each answer as `{ event: "tool", name, isError, text }`. This is how a check makes an agent use a tool.
// A line `@@answer <text>` makes the turn answer the teammate that sent the prompt, as the prompt tells an agent
// to: `send_message` with the `recipientAgentIds` and the `replyToMessageId` of its reply protocol.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";
import { callMcpTool, type McpServerEntry } from "../mcp-call";

if (process.argv.includes("--version")) {
  process.stdout.write("99.0.0\n");
  process.exit(0);
}

const MODEL = "cultura-builder/builder-auto";
const DIRECTIVE = "@@tool ";
logEntry({ event: "spawn" });
const setup = (sessionId: string | undefined) => ({
  sessionId,
  models: { availableModels: [{ modelId: MODEL, name: "Cultura Builder" }], currentModelId: MODEL },
});

/** The `buildersbot` MCP server that each session was given. */
const servers = new Map<string, McpServerEntry>();
const keepServer = (sessionId: string | undefined, mcpServers: McpServerEntry[] | undefined) => {
  const server = mcpServers?.find((entry) => entry.name === "buildersbot");
  if (sessionId && server) servers.set(sessionId, server);
};

/** The reply protocol that the prompt of a teammate message names: who to answer, and the message to name. */
const REPLY_PROTOCOL = /recipientAgentIds \["([^"]+)"\], replyToMessageId "([^"]+)"/;
const ANSWER = "@@answer ";

/** The tool calls that a prompt asks for. A line that is not valid JSON is skipped. */
function directives(prompt: string): { name: string; arguments: unknown }[] {
  const calls: { name: string; arguments: unknown }[] = [];
  // The developer instructions come first, glued to the message: only what follows them is the message.
  const text = prompt.replace(
    /^<buildersbot-developer-instructions>[\s\S]*?<\/buildersbot-developer-instructions>/,
    "",
  );
  const protocol = REPLY_PROTOCOL.exec(text);
  for (const line of text.split("\n")) {
    if (line.startsWith(ANSWER) && protocol) {
      calls.push({
        name: "send_message",
        arguments: {
          recipientAgentIds: [protocol[1]],
          replyToMessageId: protocol[2],
          text: line.slice(ANSWER.length),
          expectsReply: false,
        },
      });
      continue;
    }
    if (!line.startsWith(DIRECTIVE)) continue;
    try {
      const value = JSON.parse(line.slice(DIRECTIVE.length));
      if (typeof value === "object" && value !== null && "name" in value && typeof value.name === "string")
        calls.push({ name: value.name, arguments: "arguments" in value ? value.arguments : {} });
    } catch {
      // Not a directive.
    }
  }
  return calls;
}

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    const sessionId = `s-${process.pid}-${count}`;
    keepServer(sessionId, request.params.mcpServers);
    logEntry({ event: "session", cwd: request.params.cwd });
    peer.reply(request, setup(sessionId));
  },
  "session/load": (request, peer) => {
    keepServer(request.params.sessionId, request.params.mcpServers);
    peer.reply(request, setup(request.params.sessionId));
  },
  "session/prompt": (request, peer) => {
    const text = (request.params.prompt ?? []).map((part) => part.text ?? "").join("");
    logEntry({ event: "prompt", sessionId: request.params.sessionId, text });
    const run = async () => {
      // A session with no `buildersbot` server, such as the one that writes a title, runs no directive.
      const server = request.params.sessionId ? servers.get(request.params.sessionId) : undefined;
      for (const call of server ? directives(text) : []) {
        if (!server) break;
        const answer = await callMcpTool(server, call.name, call.arguments);
        logEntry({
          event: "tool",
          sessionId: request.params.sessionId,
          name: call.name,
          isError: answer.isError,
          text: answer.text,
        });
      }
      peer.say(request.params.sessionId, "Done.");
      peer.reply(request, { stopReason: "end_turn" });
    };
    void run();
  },
});
