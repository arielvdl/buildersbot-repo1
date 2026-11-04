# The tabs of a channel

A channel holds several conversations, one per tab, side by side. Every tab carries the same
channel memory, the same members and the same lead; a second channel would not, and that is the
reason for tabs.

## What belongs to a tab

| Kept per tab | Kept per channel |
| --- | --- |
| messages | memory |
| tasks and assignments | members and lead |
| agent session and its thread (`projection_channel_contexts`), and its line of work (tab lane) | instructions, name, title |
| rolling summary (`projection_channel_summaries`) | archived state |
| read cursor (`projection_channel_reads`) | — |

The tab is part of the primary key of the three tables that hold a conversation, so no query can
mix two tabs by accident. Messages and tasks keep their JSON and carry `topicId` inside it; the
store stamps a message or a task that arrives without one into the first tab, which is what an
older event replay and a client without tabs send.

## Where the code is

- `packages/contracts/src/ipc-chat-channels.ts`: `ChannelTopic`, the `topicId` of a message, a task
  and a page, and the `topic-create`, `topic-rename`, `topic-delete` commands. The capability is
  `channel-topics-v1`.
- `packages/contracts/src/team-protocol/channel-topics-v1.ts`: the frozen wire of the same keys and
  commands for a joined server (see [Joined servers](#joined-servers)).
- `src/backend/channel-schema.ts`: the tables, and `CHANNEL_TOPICS_MIGRATION_SQL` (migration 48).
- `src/backend/channel-store.ts`: `topics`, `firstTopic`, `topic`, `addTopic`, `renameTopic`,
  `deleteTopic`, `topicThreads`, `deleteThreads`, the tab in every query that reads a
  conversation, and the per-tab counters of the summary (`#perTopicCounts`, one grouped query each).
- `src/backend/channel-service.ts`: `#topicId`, `#topicOfTask`, `#topicChange`, `#autoNamedTopics`
  with `autoTopicName`, the tab of the parallel limit in `#waitsForWork`, and the tab on the
  `send`, `request` and `read` commands.
- `src/renderer/src/features/channels/ChannelTabs.tsx`: the tab bar in the channel header, with
  the close dialog, the working shimmer, the unread dot and drag or `Alt+Shift+Arrow` reordering.
- `src/renderer/src/features/channels/ChannelTabOverview.tsx`: the list of tabs under the channel
  title, with each tab's age, the running ones first, a search and a pin.
- `src/renderer/src/features/channels/channel-tab-overview-model.ts`: the age of a tab, the filter
  and order of the list, and the pins of this device (`buildersbot:channel-tab-pins:v1` in local
  storage).
- `src/renderer/src/features/channels/channel-tabs-model.ts`: the order the user gave the tabs on
  this device (`buildersbot:channel-tab-order:v1` in local storage) and whether closing asks first.
- `src/renderer/src/features/channels/channel-tab-reads.ts`: the open tab's unread count and the
  read marks, kept per channel and tab.
- `src/renderer/src/features/channels/channels-controller.ts`: `setTopic`, `createTopic`,
  `renameTopic`, `deleteTopic`, and the read of the open tab.
- `src/renderer/src/features/channels/channel-conversation.tsx`: the "new messages" bar and
  "Mark as read" of the open tab.
- `packages/ui/src/features/sidebar/SidebarChatTabStrip.tsx` and `stores/tab-strip-store.ts`: the
  tabs under a chat row in the sidebar. A click on the avatar or the bar opens them, never hover;
  `visibleSidebarChatTabs` lists 10 at most and keeps the open tab.

## Rules that are easy to break

- The last tab of a channel cannot be deleted; a channel without a tab cannot be opened.
- A new tab cannot take an id that any channel holds. The id is the primary key of the tab table, and
  a write with the id of another channel's tab would change that tab's name (`topicIdTaken`). A joined
  server makes this reachable, because a member chooses the id.
- The first tab's id is `buildersbot-topic-<channelId>`, so the migration is idempotent and a channel
  created by the service is written with its first tab in the same command.
- A routine, the Team API and an older client name no tab, so they land in the first one.
- A tab belongs to its channel. `open(channelId, topicId?)` in the channels controller is the one
  way in, from the sidebar, global search, a notification, the feed, or Back and Forward: it opens the
  tab given, else the open tab of the same channel, else the tab last open in that channel on this
  device (`buildersbot:channel-last-tab:v1`), else the first tab. It never carries a tab id of another
  channel. A read that names a tab which is not in the channel fails (`readTopicId`), as `send`
  does, so the renderer falls back to the first tab, but only when the channel list no longer has
  that tab: a read that fails for another reason keeps the reader on the tab with the error. An empty
  page for a foreign tab would keep the reader on it, and the first message would fail with "This
  tab of the channel no longer exists."
- Each tab keeps its own composer draft: `composerDraftKey` takes the tab (`ConversationTarget.tabId`,
  from `ConversationChannelSource.tabId`). A draft stored before this, under the channel alone, moves
  to the first tab that shows it.
- A send names its tab: `submitMessage` takes the whole target of the open composer, and the channel
  send puts `ConversationTarget.tabId` in the `send` command, else the open tab. A message that
  leaves after the reader opened another tab, such as a dictated one, still goes to its own tab.
- The microphone of the composer works in a channel as in an agent's chat (see
  [voice input](voice-input.md#the-composer-microphone)). The recording keeps its tab
  (`voiceTabId`), so its live text, its transcript and a send while recording go to that tab, also
  when the reader opens another tab before it ends.
- Deleting a tab interrupts its running turns before its sessions and threads go.
- The parallel limit of agents in one tab (`agentsPerTab`, 1 to 8, 4 by default, Settings > Load) is
  counted per tab, through the task of each assignment, and it reaches `ChannelService` through the
  hook `parallelLimit`. A request over it waits in the tab, in order. An agent has at most one active
  assignment per tab; its tabs run beside each other up to its tab limit (see
  [Tab lanes](#tab-lanes)).
- A tab that was never renamed and has no message takes a placeholder name from the first message
  a person writes in it, in the same commit: first line, spaces collapsed, 32 code points and an
  ellipsis. Beside the turn that starts, the channel model then writes the real name over it: two
  or three words in the language of the request, on the model of the member that took the request
  (else the lead's, else a member's). A rename made while the model runs wins, and a failed or
  empty answer keeps the placeholder. The first tab and a renamed tab keep their name.
- The summary counters of a tab (`unreadCount`, `activeTasks`, `openTasks`, `messageCount`) are for
  the sidebar only; the channel totals above them keep summing every tab. `updatedAt` is the newest
  message of the tab, or its creation while nobody wrote in it, and it is what the tab list ages.
- The tab list under the title is a menu: the name opens it, Escape or a click outside closes it, a
  card opens that tab. A pinned tab is always first and marked, whatever the sort is; like the tab
  order, the pins are a device preference.
- Message sequences are the channel's, not the tab's. A read mark kept per channel would skip a tab
  whose last message is older than another tab's, so the renderer keeps it per channel and tab, and
  every `read` command names its tab.
- Closing a tab with work or messages asks first; only a tab known to be empty and idle closes at
  once. The order on screen is a device preference: a routine still lands in the oldest tab.
- With the `routing` optimization off, a follow-up ("continue", "also", ...) and the routing prompt
  read the open tasks of the whole channel, and any change to the channel makes a routing answer
  stale. With it on, both read the tab of the message, and only a change to that tab (2 times at
  most) or to the channel settings makes the lead route again. See
  [the routing optimization](channels-and-messaging.md#the-routing-optimization).

## Tab lanes

Each tab of a channel is its own line of work for each agent (a tab lane). A message waits only for
the earlier messages of its own tab, never for work of another tab, while the agent has a free place.

| Rule | Where |
| --- | --- |
| One active assignment per agent and tab; the next request of the tab waits for it (`tab`) | `ChannelService.#laneWait` |
| At most `tabsPerAgent` tabs of one agent run a turn at the same time (`agent-tabs`); 1 for a provider with `concurrentTurns: false` | `#laneWait`, `#tabLimit`, hook `tabLimit` |
| With a limit above 1, a tab whose turn waits for the person (question, approval, browser takeover) takes no place | hook `waitsOnPerson`, `AttentionRegistry.waitsOnPerson` |
| With a limit above 1, a tab whose task waits for its next start try (`startRetry`) takes no place; its retry marker and its fallback hold are read for its own lane only | `#laneWait`, `MailboxStore.queuedStartRetry(agentId, taskId, tab)`, `DrainScheduler.#waitsForStartFallback` |
| The breaker of the agent's model holds every lane of the agent until the agent moves to the backup or the wait ends: the agent has one model, and a move waits until no turn of the agent runs | `StartBreakers.waits`, `AgentService.#usageLimitMove` |
| A tab whose task waits for other members has no assignment, so it takes no place | `ChannelService.complete` |
| While memory is low, an agent that works opens no second tab (`memory`); its first one waits in the drain as before | hook `memoryLow`, `MemoryHold.memoryReturned` |
| A free place goes to the tab of the agent that waited longest, in any channel | `#olderTabWaiter`, `#queuePlaces` |
| With the tab mode `memory`, `tabsPerAgent` is a ceiling and an extra tab of an agent that already works starts only while `LaneBudget` has room for one more session (`memory`); the first line of an agent is not limited. Without a memory reading the mode acts as `fixed` | hook `laneBudgetLow`, `laneStarted`, `LaneBudget` (see [providers.md](providers.md#the-memory-budget-for-tabs-and-idle-sessions)) |
| The agent's own chat is a line of its own, as a tab is: it does not hold a tab, and a tab does not hold it. Only a provider with `concurrentTurns: false` makes them wait for each other (`one-turn`), and then a message of the chat that came before a request holds new tabs | hook `busy(agentId, since)`, `queueHold` |
| Each tab lane is a drain lane, keyed by `channelTabLane(channelId, topicId)` | `channel-tab-lane.ts`, `MailboxStore.#tabOf`, `DrainScheduler` |
| The main lane (chat and messaging) waits for channel work (`channel`) only for a provider with `concurrentTurns: false`; no lane waits for the main lane any more (the `agent-chat` clause is gone) | `DrainScheduler.#heldBy`, `ChannelService.mayDrain` |
| Stop, force a message, new chat, compact and `interrupt_agent` of the chat read only the main lane, never a turn of a tab | `ConversationRuntime.mainLaneSnapshot`, `MailboxStore.hasUnfinishedMainLaneDelivery` |
| The turn of the chat gets one note (300 characters at most, names and resources only) when a tab of the same agent holds `browser` or `workspace:` | `ChannelService.linesNotice`, `channel-lines-notice.ts`, `DrainScheduler` |
| A tab compacts only its own thread, and a compaction holds only its lane | `DrainScheduler.#compactionHolds` |
| A started turn takes only the starting delivery of its own tab | `TurnLifecycle.#tabForThread`, `MailboxStore.startingDeliveriesForAgent` |
| The rows of a turn go to the assignment of the thread's tab, and the read cursor is the tab's | `ChannelService.capture`, `#tabAssignment`, `ChannelStore.acceptContext` |

`tabsPerAgent`, `tabsMode` and `agentsPerTab` are part of the agent limit preference
(`AgentLimitPreference`, Settings > Load): `tabsPerAgent` is 1 to 8; `tabsMode` is `fixed` or
`memory` (absent: `memory` where memory is read, else `fixed`); `agentsPerTab` is 1 to 8, 4 by
default. The number of tabs that applies when none is set is 4 in `memory` mode and 2 in `fixed`
mode (`defaultAgentTabs`). A build from before `tabsMode` that reads `tabsPerAgent` above 4 reads the
whole preference as the default, so after a downgrade the cap on agents is the default again; no
other data is lost.
Both apply whether the cap on agents is on or off. With `tabsPerAgent` 1 an agent works in one tab at
a time, as before tab lanes. The chat of an agent does not count as a tab, so an agent can run
`tabsPerAgent` tabs and its chat together. A changed limit wakes every channel.

`ChannelService.page` gives each queued task the reason it waits (`ChannelTask.wait`), and the
channel shows it as a quiet line (`ChannelTaskWaitNotice`). The IPC and the Team API read pages
there. The agent's own queue names the tab and the count of tabs that hold the agent
(`QueueHold.topicName`, `QueueHold.tabs`). Both fields are optional, so an older client ignores them.

The task reviewer reads a request that waits for its tab or for a place as `owner-busy` (shown as
`agent-busy`), so it does not stop or move the work of one tab because of another. Its clock of a
running turn is per tab, and the running list names the task of each turn.

Two tabs of one agent, or a tab and the agent's own chat, can change the same files of its workspace
at the same time. Builders Bot does not lock files, as for the agent's side threads. Declared
`workspace:<path>` resources still run one after the other between channel assignments. The chat
declares no resource and never waits for them. Instead, when a tab of the agent holds `browser` or a
`workspace:`, the turn of the chat starts with a note that names the channel, the tab and the
resources. The browser tab belongs to the thread, so the chat and a tab do not use the same page. Wait cycles through dependencies are refused when the agent makes them
(`channel_assign`), and the waits above wait only for work that runs or for the person, so they make
no cycle. `scripts/channel-tab-lanes-e2e.ts` checks the rules with the real services and a fake Codex.

## Joined servers

A joined server, also one on this computer that the app reaches over the Team API, has tabs when it
advertises `channel-topics-v1` (protocol 9 peers only). The wire adds `topics` and the per-tab
counters to the channel list, `topicId` to the page, its messages and its tasks, `topicId` to the
read request and to the `send` and `read` commands, and the three tab commands. See
[Channel tabs](servers.md#channel-tabs) for the shape and the host rules.

- The desktop and the web client send a tab only to a host that advertises the capability. A host
  without it sends no `topics`, so the channel has one conversation, no tab bar and no new-tab
  button, and its pages name no tab (`ChannelPage.topicId` is empty).
- A tab that a member deletes needs the admin role on the host, because the messages and the work go
  with it.
- Not on the wire: the close report (it stays on the computer that closes the tab: a tab closed on a
  joined server writes no record, and `agent.listChannelTabReports` is null there), a routine request,
  the order, the pins and the last open tab (device preferences), and the tab lane `wait` of a task.

## Merges

This is a local feature. The shared code arrives in a daily merge, so a conflict in any file above
keeps the tab side of it. A new migration of the shared schema takes the next version number after
48, never 48 itself, and `buildersbot-database-schema-history.json` keeps its record for 48.

## Close report

When a person closes a tab, Builders Bot asks how the tab ended: `done`, `not-done` or `other`.
The answer is saved as a record. The record is written with the close.

- The `topic-delete` command takes an optional `report` field: `{ outcome, note? }`. Without
  `report`, the tab closes as before.
- `ChannelStore.deleteTopic` writes the record in the same transaction as the deletes. It writes
  before the DELETE statements. If the write fails, the transaction rolls back. The tab, its
  messages and its tasks stay.
- The note and the last result pass through `redactText`. The note is not in the
  `channel.topic-deleted` event.
- The table is `channel_tab_reports`. Migration 51 creates it. It has no foreign key, so a record
  stays after its channel or tab is deleted.
- `agent.listChannelTabReports` reads the records for a period. It returns a page of 20 records, with
  a cursor. The maximum is 50. The totals by outcome come with the first page only. This endpoint is
  local. On a remote server it returns `null`.
- `agent.deleteChannelTabReport` deletes one record, by `id`.
- "Continue in a new tab" runs in the renderer only. It opens a new tab and fills the message box
  with a summary of the record. It sends no message. It does not call a new endpoint.
