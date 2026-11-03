// The bundled Builders CLI (`opencode acp`) of `thread-queue-force-e2e.ts`, as the Cultura Builder driver
// starts it. A prompt with HOLD in it stays open until the client cancels it (`session/cancel`), as a long
// turn does; any other prompt answers at once. Every prompt, set-model and cancel goes to the log, so a test
// can tell which turns started, in which order, and which one the client stopped. `steer` is "deferred" for
// this provider, so a queued message can only start after a turn ends or is stopped.
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

const waiting = new Map<string, () => void>();
let count = 0;
serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
    "session/new": (request, peer) => {
      count += 1;
      const sessionId = `s-${process.pid}-${count}`;
      logEntry({ event: "session", sessionId });
      peer.reply(request, setup(sessionId));
    },
    "session/load": (request, peer) => peer.reply(request, setup(request.params.sessionId)),
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = (request.params.prompt ?? []).map((part) => part.text ?? "").join("");
      logEntry({ event: "prompt", sessionId, text });
      if (text.includes("HOLD")) {
        waiting.set(sessionId, () => peer.reply(request, { stopReason: "cancelled" }));
        return;
      }
      peer.say(sessionId, "Done.");
      peer.reply(request, { stopReason: "end_turn" });
    },
  },
  {
    onNotification: (method, params) => {
      if (method !== "session/cancel") return;
      const sessionId = params.sessionId ?? "";
      logEntry({ event: "cancel", sessionId });
      waiting.get(sessionId)?.();
      waiting.delete(sessionId);
    },
  },
);
