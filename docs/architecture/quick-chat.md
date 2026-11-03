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

## Which conversation opens

When the page opens, it opens the conversation that was open when the person left. The renderer keeps
that conversation in `localStorage` (`quick-chat-last.ts`, one record for each server). It can be a
thread of the quick chat agent or a thread of a called agent. A new conversation with no message is kept
as none. When the saved thread was deleted or archived, or its agent is gone, a new conversation opens.

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
- channels, external messaging, and `send_message` of an agent, except the answer below;
- the automation server and routines (a routine run for it is refused);
- the Dynamic Island and the resume offer.

## The answer of an agent

The quick chat agent asks other agents with `send_message`, and the answer comes back the same way. The
agent is in no list, so the router refuses any other message to it as an unknown agent. One kind passes
(`BuildersBotToolRouter.#isAnswerToQuickChat`, `MailboxStore.openRequestThread`). All of these must be true, and
the router reads each one from the mailbox, never from the renderer:

- the message has one recipient, the quick chat agent, and names a `replyToMessageId`;
- that message is a question that the quick chat agent sent to the caller, from a conversation of its own;
- the question wants an answer (`expectsReply` is not false), and the caller has not answered it yet (a
  repeat of the same tool call is not a second answer);
- the conversation that asked is still open. The answer runs in that conversation, as for any agent.

`list_agents`, `interrupt_agent`, the Team API and every other tool still find no quick chat
agent. A tool error that names the id is sent to the Team API as an `error` event, as for any unknown id.

`AgentService.listAgents()` leaves the quick chat agent out, so `agent:list`, `agents-changed`,
`agent:hidden:list`, the mention picker, the counts and the sidebar never carry it. Code that
holds an agent by id reads the whole roster (`#roster()`, `findAgent`). Restore, copy and delete
answer "unknown agent" for it.

## Model per conversation

Each conversation has its own model. The value is in `runtime_json` of `projection_agent_threads`
(`{"v":1,"provider","model","reasoningEffort"?,"fastMode"?}`). A null value means the conversation
uses the model of the agent. Migration 52 only adds the column, so an older build ignores it and runs
every conversation on the agent's model.

- **Default for new conversations:** the agent record keeps `provider`, `model`, `reasoningEffort` and
  `fastMode` as that default. It is written by `#rememberQuickChatDefault` when a model is chosen in the
  picker and when a first message starts a conversation with a model. It is written straight to the
  store: nothing is delivered, no session is retired and no `pendingRuntime` is made. A draft that is
  never sent does not change the default.
- **Draft:** the page keeps the model of the draft in its own state (`quick-chat-runtime.ts`). It starts
  from the last model chosen, and `startTask` receives it as `runtime`.
- **Creating a conversation:** `startTask` with a `runtime` checks the model (as above) and stores it in
  `runtime_json` through `#tasks.create`. Without one, the new conversation takes the default. A
  `startTask` with `runtime` for an agent that is not the quick chat agent is refused with
  `error.backend.quickChatRuntimeOnly`. `setConversationRuntime` for an agent that is not the quick chat
  agent is refused as an unknown agent.
- **Existing conversations:** `ensureQuickChat` runs `#pinQuickChatConversations` on each open. It
  gives the agent's model to every conversation whose `runtime_json` is null (`fillMissingRuntimes`).
  A conversation that has a model keeps it, so a later change of the default does not move it. A model
  that left the catalog moves only the default, and never rewrites a conversation.
- **Choosing a model:** `quickChat.setConversationRuntime` (`quick-chat:set-conversation-runtime`)
  checks the model before it writes (`#checkQuickChatRuntime`). The model must be in the list of its
  provider, else the error is `error.backend.quickChatModelUnavailable`. The provider must be on. An
  effort that the model does not take becomes the model's default, and fast mode stays only for a model
  with a fast tier. A refused check writes nothing, and the picker goes back to the real model.
- **Provider change:** if the conversation is at rest, the choice reconciles its provider sessions at
  once (`reconcileThreadRuntime`), so a provider that is off shows in the picker. If it runs or waits, the
  reconcile runs at the start of its next turn, in its lane. The sessions of another provider are retired
  and their work steps are kept, so the next turn starts a session on the new provider with the history.
- **When it applies:** the next turn of that conversation uses the new model. A turn that runs is not
  stopped and ends on the model it began with. A message already queued in that conversation uses the
  new model, because the model is read when its turn starts (`ThreadRuntimes.forTask`). Other
  conversations are not changed.
- **Locked conversations:** a conversation that a message opens with `@agent` belongs to that agent and
  runs on its model. The picker is disabled with `quick.model.ownedByAgent` and the name of the agent,
  because a change would alter that agent's own chats.
- **Refused writes:** `updateAgent` refuses any runtime field (`provider`, `model`, `reasoningEffort`,
  `providerAccountId`, `fastMode`) for the quick chat agent with `error.backend.quickChatRuntimeByConversation`,
  so no `pendingRuntime` is made on it. On open, `ensureQuickChat` moves an existing `pendingRuntime`
  into the default and clears it.
- **Errors are visible:** a failed choice shows an error toast with the backend text, or
  `quick.model.changeFailed` when there is no text, and the picker goes back to the real model. The model
  never changes by itself.

## The agent strip

The strip above a conversation shows the agents that the conversation called (`QuickChatAgentStripHost`). It reads
the rows of the waiting block (`agentAwaitingReplies`), which come from the outgoing exchange rows of the
conversation: one row for each message that the quick chat agent sent, with the state of each delivery.

A request that an agent sends from a side thread stays out of its own chat, and the thread keeps no row of it. For
the quick chat agent only, `AgentTasks.#withOutgoing` adds these rows when the conversation is read and when it is
sent to the renderer (`MailboxStore.taskOutgoingMessages`). The rows are never stored, so a restart cannot leave one
that says an agent still works. The router tells `AgentTasks.outgoingSent` when the conversation sends a message,
and `MailboxSync.emitQueue` calls `AgentTasks.outgoingTouched` with the agent whose queue changed. `AgentTasks` keeps
which Quick chat tasks asked each agent, so a queue change of any other agent is a lookup and reads nothing of the
mailbox (`scripts/mailbox-sync-cost-e2e.ts` counts the reads). The conversation goes out again only when its rows
changed. The tasks of every other agent are returned as they were.

The conversation does not draw these rows (`AgentThreadView` leaves them out). The strip counts an ended delivery as
an agent that answered (`keepEnded`), for the questions that came after the last message of the person, because the
conversation of a side thread has no queue that carries the answers. It shows while an agent has the request, says that
all are done for a moment, and goes.

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
| Model of a conversation: reads and reconcile | `src/backend/agent/thread-runtime.ts` (`effectiveRuntime`, `ThreadRuntimes`, `reconcileThreadRuntime`) |
| Model of a conversation: stored form and store | `src/backend/agent-threads/thread-runtime-json.ts`, `agent-thread-store.ts` (`fillMissingRuntimes`), migration 52 in `buildersbot-database-schema.ts` |
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

`bun run test:quick-chat-replies` (`scripts/quick-chat-replies-e2e.ts`) runs the same service, the tool router and
the MCP bridge. A fake CLI turn calls `send_message` as an agent does. It checks the answer, each message that stays
unknown, `list_agents` and `interrupt_agent`, and the Team API. It writes
`.buildersbot-build/quick-chat-replies-e2e/report.json`.

`bun run test:mailbox-sync-cost` (`scripts/mailbox-sync-cost-e2e.ts`) seeds 10,000 deliveries between 40 agents, and checks
that a queue change reads the queue and the senders of its agent once each, and tells the Quick chat tasks once with the
agent whose queue changed. It writes the time of a queue change to `.buildersbot-build/mailbox-sync-cost-e2e/report.json`.
