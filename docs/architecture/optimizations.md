# Advanced optimizations (beta)

Some changes make agents faster or lighter, but they change what the app does in a way that a person
can notice. Each of them is behind a switch of its own, in Settings › General › Advanced
optimizations (beta). Every switch is off by default, except the five that give back memory that
nothing uses (`DEFAULT_ON_OPTIMIZATION_IDS`: `idle-release-low`, `lean-idle-sessions`,
`idle-browser-tabs`, `mcp-direct-binary` and `mcp-shared-host`), which start on and which a person can turn off at any time. With a switch off,
the app does what it did before that switch existed, so a person can turn one on or off, watch, and
go back.

## The registry

`packages/contracts/src/ipc-optimizations.ts` has the closed list `OPTIMIZATION_IDS`. The order of the
list is the order of the Settings page.

| Id | What it changes when it is on |
| --- | --- |
| `queue-priority-user` | A delivery from the person can use one more place than the cap on agents, and at `low` memory one turn of the person can start on an agent whose provider session is open. See [providers.md](providers.md#memory-of-the-computer). |
| `idle-release-low` (on by default) | When the memory of the computer goes to `low`, the provider threads with no turn for more than 2 minutes close. The tab mode `memory` (Settings > Load) does the same with this switch off. See [providers.md](providers.md#memory-of-the-computer). |
| `fiscal-resume-grace` | After the computer sleeps, the task reviewer holds every task for two looks. See [task-reviewer.md](task-reviewer.md#sleep-of-the-computer). |
| `turn-start-unify` | The two security reviews before a turn become one. See [guard.md](guard.md). |
| `channel-context-spill` | Long old channel messages go to an agent cut, with a pointer to read the rest. See [channels-and-messaging.md](channels-and-messaging.md#lean-channel-context-channel-context-spill). |
| `safe-resume` | A channel task that a brief provider failure stops in the middle of a turn continues by itself in the same session, at most 3 times, only when its effect journal says that nothing can happen twice. See [agents.md](agents.md#safe-turn-resume). |
| `routing` | The routing of a channel request uses the lowest reasoning effort of the lead's model, a follow-up in Portuguese or Spanish continues the work of its tab, and only a change to the request's tab makes the lead route again (2 times at most). See [channels-and-messaging.md](channels-and-messaging.md#the-routing-optimization). |
| `streaming-checkpoints` | A reply that streams is written to the database at checkpoints, not at each frame. |
| `quick-status-reply` | When a turn has run for 5 minutes or more and the person sends another message, a second generation with no tools writes a short note about what the agent does now. See [agents.md](agents.md#quick-status-reply). |
| `lean-idle-sessions` (on by default) | In the tab mode `memory`, the memory policy (`LaneBudget.idlePolicy`) keeps at most 3 idle provider sessions open, not 8. The others close and open again from their session. See [providers.md](providers.md#memory-of-the-computer). |
| `idle-browser-tabs` (on by default) | An idle tab of an agent in the Builders Bot browser unloads its page after 30 minutes (5 minutes at low memory, for an agent with no turn) and loads it again on its next use. Off: tabs never unload. |
| `mcp-shared-host` (on by default) | One process of the WhatsApp tool server (`wazap-mcp@1.6.x`, the exact line of the Marketplace) serves every agent, behind a host on `127.0.0.1` in the main process (`SharedMcpHost`, `SharedMcpOwner`). Each agent has its own route and bearer, and its own session on the process; a process that falls or a session that the server closes is opened again by the host with the kept `initialize`. See [whatsapp-accounts.md](whatsapp-accounts.md). |
| `mcp-direct-binary` (on by default) | A stdio MCP line `npx -y <package>@<exact version> ...` for a package that was proved to start this way (`isProvenDirectPackage`: only `wazap-mcp@1.6.x`), when `npx` already holds it in its cache, starts the package's own program, with the `.bin` of the package first on its `PATH`, with no `npm exec` around it (about 50 MB less for each agent, 3 times faster start). Any other package, a range, a tag, a package that is not cached, a failure or Windows keeps the `npx` line. The test of the MCP panel always runs the stored line. |

A new switch is one line in `OPTIMIZATION_IDS`, its name and description in the `settings` catalog
(`settings.optimizations.<name>.title` and `.description`, in English and Portuguese, with the risk
in plain words), a line in `OPTIMIZATION_TEXT` of `OptimizationSettings.tsx`, a row in this table,
and the code that reads it. A check that reads a switch keeps the old behavior on the path where the
switch is off.

## The file and the port

Each host has its own file, `buildersbot-optimizations-v1.json` in its user data folder:
`{ "version": 1, "on": ["queue-priority-user"], "off": ["idle-browser-tabs"] }`. `off` records the
switches that start on and that the person turned off, so a restart does not turn them on again. A file with no
`off` (an older version wrote it) reads as the defaults. `OptimizationStore` (`src/main/optimization-store.ts`)
holds it in memory after `load`, as the other preference stores of main do.

- A file that is missing, damaged, of another version or of another shape reads as the defaults: every switch off, except the five that start on.
- An id that this version does not know stays in the file when a write changes another switch. So a
  person who goes back to an older version and changes a switch does not lose a switch of a newer one.
  The older version does not use it, and the window does not show it.
- Each change goes to the log of the host (`optimizations`): the id and the new value. At start, the
  log says which switches are on. The log has no other value.

The code that runs agents reads the switches through one port, `OptimizationPort` in
`src/backend/optimizations.ts`:

- `optimizationEnabled(id)`: a synchronous read, so a check reads it each time it decides, and a
  change applies to the next decision. Nothing restarts.
- `onOptimizationChange(listener)`: for a reader that keeps state for a switch, such as a timer. It
  comes once for each switch whose value changed, after the file is written.

`AgentService` takes the port as its option `optimizations` and gives it to its parts as
`AgentService.optimizations`. With no option, as in a test, it is `OPTIMIZATIONS_OFF`: every switch
off. Main gives the same store to the services of main that have a switch, such as the task reviewer.

## The window

`app:get-optimizations` and `app:set-optimizations` carry the state as `{ on: [ids] }`. A change is
`{ changes: [{ id, enabled }] }`, with one to nine known ids (the length of `OPTIMIZATION_IDS`), each one at most once. Main refuses any
other payload (`parseSetOptimizationsInput`). The preload leaves out an id of the answer that this
version does not know (`decodeOptimizationState`). "Turn all on" and "Turn all off" are one change
each. The switches are of the computer that runs the window, as the task reviewer is: a joined server
reads its own file, and no Team API route reads or sets it yet.

`scripts/optimizations-e2e.ts` checks the file, the event, the defaults, the parser and the decoder.
