// The bundled Builders CLI (`opencode acp`) of `quick-chat-core-e2e.ts`, as the Cultura Builder driver
// starts it. Like `cultura-builder.ts`, but it also answers a prompt: one line of text, then the end of
// the turn. It writes each prompt to the log, so a test can tell that a turn really reached the provider.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("99.0.0\n");
  process.exit(0);
}

const MODEL = "cultura-builder/builder-auto";
logEntry({ event: "spawn" });
const setup = (sessionId: string | undefined) => ({
  sessionId,
  models: { availableModels: [{ modelId: MODEL, name: "Cultura Builder" }], currentModelId: MODEL },
});

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    logEntry({ event: "session", cwd: request.params.cwd });
    peer.reply(request, setup(`s-${process.pid}-${count}`));
  },
  "session/load": (request, peer) => peer.reply(request, setup(request.params.sessionId)),
  "session/prompt": (request, peer) => {
    const text = (request.params.prompt ?? []).map((part) => part.text ?? "").join("");
    logEntry({ event: "prompt", sessionId: request.params.sessionId, text });
    peer.say(request.params.sessionId, "Done.");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
