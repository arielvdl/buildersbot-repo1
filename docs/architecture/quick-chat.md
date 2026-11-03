# Quick chat

The quick chat is a chat with one agent and no setup. The ⚡ button, first in the main rail, opens a
page with a list of conversations and a chat. It has no channel: a channel belongs to the Agents
button.

## What it is

- One local agent per computer, the **quick chat agent**. It is stored as a hidden agent
  (`hiddenAt`) with `quickChat: true` in `agent_json`. No migration is needed.
- Each conversation is a side thread of that agent (`projection_agent_threads`), so the title,
  the preview, archive, delete with Undo, the model picker, the microphone and streaming are the
  ones of any agent.
- The agent has the default access (`full`), no provider account of its own, 3 tasks at a time, no
  automation and no early acknowledgement. It never uses "Workspace only", which would start a
  confined process for it.
- A message that opens with `@agent` starts the conversation in that agent, which then owns it. The
  history of the quick chat agent does not go with it.

## How it is made

`quickChat.ensure` (`quick-chat:ensure`) runs each time the page opens. It has no payload and
answers `{ agent, changed }`.

1. No quick chat agent yet: `AgentStore.createQuickChatAgent` makes one in a single write, hidden
   from birth, under the creation queue. Calls at once make one agent. No model is called.
2. The agent exists and its model is still in the catalog: it answers `changed: false`.
3. Its model left the catalog: the agent moves to the default model and answers `changed: true`.
4. No provider can run: it fails with `error.provider.noneReady`, and the page shows its sign-in state.

The default model is `quickChatDefaultModel` in `packages/contracts/src/quick-chat-model.ts`. It
goes through the providers in picker order and skips the ones that are not available. On Cultura
Builder it takes `cultura-builder/builder-fast`, else the first model of the list. On another provider
it takes that provider's default model, else its first. The effort is the lowest the model accepts,
and none for a model with no effort setting. `fastMode` is on only for a model with a fast tier.

The catalog of a Cultura Builder account is read when the provider client starts, and only on a
server with a model policy. A new or removed model shows after that start.

## Where a message goes in

Only the page. The local IPC handlers of `src/main/ipc/agent-handlers.ts` pass `via: "quick-chat"`
to `sendMessage`, `startTask`, `steerQueuedMessage` and `forceQueuedMessage`.
`AgentService.#requireNotHidden` lets a hidden agent through only when `via` is `"quick-chat"` and
the agent is the quick chat one. For any other hidden agent the answer is still
`error.backend.recipientHidden`.

The drain (`drain-scheduler.ts`) and the routine scheduler do not hold the queue of this agent as
hidden.

## Where a message does not go in

Each of these is refused as for any hidden agent, because none of them passes `via`:

- the Team API, for every role, the owner too (`TeamApiServer.hiddenAgentIds` and the blocked set:
  no list, no id route, no event, no push, no live activity);
- channels, `send_message` of an agent, and external messaging;
- the automation server and routines (a routine run for it is refused);
- the Dynamic Island and the resume offer.

`AgentService.listAgents()` leaves the quick chat agent out, so `agent:list`, `agents-changed`,
`agent:hidden:list`, the mention picker, the counts and the sidebar never carry it. Code that
holds an agent by id reads the whole roster (`#roster()`, `findAgent`). Restore, copy and delete
answer "unknown agent" for it.

## Model per conversation

Each conversation has its own model. The value is in `runtime_json` of `projection_agent_threads`
(`{"v":1,"provider","model","reasoningEffort"?,"fastMode"?}`). A null value means the conversation
uses the model of the agent. Migration 52 only adds the column, so an older build ignores it and runs
every conversation on the agent's model.

- **New conversation:** the draft starts with the model of the last conversation used. The agent keeps
  that model as the default for new conversations, in its own `provider`, `model`, `reasoningEffort`
  and `fastMode` fields. The first message writes `runtime_json` in the same transaction that creates
  the conversation. A model chosen in a draft that is never sent does not become the default.
- **Existing conversations:** `ensureQuickChat` fills `runtime_json` with the agent's model in each
  conversation that is still null. It does this once, in a transaction, so a later change of the
  default does not change an old conversation. A model that left the catalog moves only the default,
  and it never rewrites a conversation.
- **Choosing a model:** `quickChat.setConversationRuntime` checks that the model is listed for the
  provider, that the provider is on, and that the effort is accepted. If a check fails, nothing is
  written, the picker goes back to the real model, and the error shows as `error.backend.quickChatModelUnavailable`.
- **When it applies:** the next message in that conversation uses the new model. A reply that is
  already running is not stopped. A message already queued in that conversation uses the new model,
  because the model is read when the turn starts. Other conversations are not changed.
- **Provider change in a stopped conversation:** the provider sessions of the conversation are closed
  when the choice is made. A change while the conversation runs is applied at the start of its next
  turn, in its lane.
- **Locked conversations:** a conversation that starts with `@agent` runs on that agent's model. Its
  picker is disabled with `quick.model.ownedByAgent`, because a change would alter that agent's own chats.
- **Refused writes:** `updateAgent` refuses runtime fields for the quick chat agent with
  `error.backend.quickChatRuntimeByConversation`, so no `pendingRuntime` is created on it. On open,
  `ensureQuickChat` moves an existing `pendingRuntime` into the default for new conversations and clears it.
- **Errors are visible:** a refused choice shows an error toast, and the picker goes back to the real
  model. A failed send shows its error in the conversation, and the message can be sent again. The model
  never changes by itself.

## Warm-up

`quickChat.warm` (`quick-chat:warm`) starts the provider process of the agent when it is stopped,
by the same call that the first message makes (`ensureAgentClient`). The page calls it once, on the
first key. It opens no session, makes no conversation and calls no model. It does nothing before the
first `ensure`, while the memory is not `ok`, while another warm runs, or when the process runs. It has
no timer, and a failure is only logged.

## The limit of 50

An agent has at most 50 open conversations (`INPUT_LIMITS.agentTasks`). When a quick chat
conversation starts at the limit, the oldest idle one is archived first. Nothing is deleted. A
conversation that runs or waits is left alone, and with none idle nothing is archived. It runs only
when a conversation starts, with no timer.

## Voice

The microphone, Read aloud and the spoken reply to a dictated message work in a conversation of the
quick chat as in any side thread. See `voice-input.md`.

## Main files

| Part | File |
| --- | --- |
| Model rule | `packages/contracts/src/quick-chat-model.ts` |
| Result and field | `packages/contracts/src/ipc-quick-chat.ts`, `quickChat` in `ipc-agents.ts` |
| Endpoints | `quickChat` group in `packages/contracts/src/ipc-endpoints.ts` |
| Store | `AgentStore.createQuickChatAgent`, `quickChatAgent`, `isQuickChat` (`src/backend/agent-store.ts`) |
| Service | `ensureQuickChat`, `warmQuickChat`, `#quickChatAccess`, `#makeRoomInQuickChat` (`src/backend/agent-service.ts`) |
| IPC | `src/main/ipc/quick-chat-handlers.ts`, `src/preload/quick-chat-decoding.ts` |
| Preview | `quickChat` in `src/renderer/src/preview/mock-buildersbot.ts` |
| Page | `src/renderer/src/features/quick-chat/`, `packages/ui/src/features/quick-chat/` |
| Text | `packages/i18n/src/messages/*/quick.ts` |

## Check

`bun run test:quick-chat-core` (`scripts/quick-chat-core-e2e.ts`) runs the real service on a temporary
profile and a fake bundled CLI (`scripts/provider-fakes/agents/cultura-builder-turn.ts`). It checks the
model rule, `ensure`, the hidden birth, that no list or Team API frame carries the agent, the refusals,
the way in, the 51st conversation and `warm`. It writes `.buildersbot-build/quick-chat-core-e2e/report.json`.
