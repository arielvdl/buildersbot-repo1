// The bundled Builders CLI (`opencode acp`) of part 4 of `quick-chat-core-e2e.ts`. One copy runs as the
// Cultura Builder provider and as the OpenCode provider, as the real one does, and each lists two models. It
// keeps the model of each session (`session/set_model`) and writes it to the log with every prompt, so a test
// can tell which provider, session and model a turn really ran on. A prompt with SLOW in it answers late.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("99.0.0\n");
  process.exit(0);
}

// The driver of Cultura Builder writes its provider into the config of the process; OpenCode has none.
const role = process.env.OPENCODE_CONFIG_CONTENT?.includes('"cultura-builder"') ? "cultura-builder" : "opencode";
const models =
  role === "cultura-builder"
    ? [
        { modelId: "cultura-builder/builder-fast", name: "Builder Fast" },
        { modelId: "cultura-builder/builder-auto", name: "Builder Auto" },
      ]
    : [
        { modelId: "opencode/flint-40b-free", name: "OpenCode/Flint 40B Free" },
        { modelId: "opencode/big-pickle", name: "OpenCode/Big Pickle" },
      ];
logEntry({ event: "spawn", role, pid: process.pid, models: models.map((model) => model.modelId) });

const current = new Map<string, string>();
const setup = (sessionId: string | undefined) => ({
  sessionId,
  models: { availableModels: models, currentModelId: current.get(sessionId ?? "") ?? models[0]?.modelId ?? null },
});

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    const sessionId = `s-${role}-${process.pid}-${count}`;
    current.set(sessionId, models[0]?.modelId ?? "");
    logEntry({ event: "session", role, sessionId });
    peer.reply(request, setup(sessionId));
  },
  "session/load": (request, peer) => {
    logEntry({ event: "load", role, sessionId: request.params.sessionId });
    peer.reply(request, setup(request.params.sessionId));
  },
  "session/set_model": (request, peer) => {
    const params = request.params;
    if (params.sessionId && params.modelId) current.set(params.sessionId, params.modelId);
    logEntry({ event: "set_model", role, sessionId: params.sessionId, modelId: params.modelId });
    peer.reply(request, {});
  },
  "session/prompt": (request, peer) => {
    const text = (request.params.prompt ?? []).map((part) => part.text ?? "").join("");
    const model = current.get(request.params.sessionId ?? "") ?? null;
    logEntry({ event: "prompt", role, sessionId: request.params.sessionId, model, text });
    const finish = () => {
      peer.say(request.params.sessionId, `Done from ${role}.`);
      peer.reply(request, { stopReason: "end_turn" });
    };
    if (text.includes("SLOW")) setTimeout(finish, 2_500);
    else finish();
  },
});
