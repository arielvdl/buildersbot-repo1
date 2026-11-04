# Hub connections

Hub connections are paid third-party APIs that Cultura Builder offers through its Hub. The vendor
key stays in the Hub vault. The app and the agent never hold it. The first connection is
`tool-catalog` (the treg.to tool catalog, option A+ of the treg design). The wire contract for the
Hub team is [hub-connections-contract.md](hub-connections-contract.md).

## Parts

| Part | Where | What it does |
| --- | --- | --- |
| Contract | `packages/contracts/src/hub-connections.ts` | Paths, limits, error codes and strict decoders of every Hub answer. A decoder keeps only the fields it knows and refuses markup, bad ids and unsafe amounts. |
| Hub client | `src/backend/hub-connections/hub-connection-client.ts` | Main process only. Reads `/session`, asks for proxy tokens (`cbp_…`, one per organization, memory only, at most 5 minutes), reads the catalog and runs `search`, `describe`, `call` and `usage`. 25-second timeout, `redirect: "error"`, a byte ceiling on each answer. No method returns a token and no error carries one. |
| Input checks | `hub-connection-input.ts` | The first lock before anything goes to the Hub (below). |
| Payer rule | `hub-connection-payer.ts` | Which organization pays. The agent has no field for it. |
| Tools | `hub-connection-tools.ts`, `hub-connection-tool-definitions.ts` | `buildersbot_connections.list` and `buildersbot_connections.call`: access, limits per turn and per hour, cost and payer cards, the untrusted envelope, masking. |
| Delegate and host | `hub-connection-port.ts`, `hub-delegate-client.ts`, `hub-delegate-host.ts`, `hub-delegate-protocol.ts` | The Hub client of a local server that the app runs as its own child process. The child holds no session: it asks the app, which holds it ([Local servers](#local-servers)). |
| Router | `src/backend/agent/buildersbot-tool-router.ts` | Runs the two tools with the Guard before (outbound) and after (inbound), and shows the cards through `AttentionRegistry.awaitToolApproval` (owner only, always asks). |
| Catalog | `src/backend/agent/tool-catalog.ts` | The two tools are deferred tools of a gated namespace. They are in `tool_search`, `tool_describe` and `tool_call` only for an agent that has them in this turn. |

## How an agent reaches a connection

The agent gets **no direct tool**. It finds `buildersbot_connections.list` and `.call` with
`tool_search` and runs them with `tool_call`, like every other deferred tool. Every provider has
these discovery tools: Codex (also a code-mode model, through the `buildersbot` namespace), Claude
Code, OpenCode and the MCP-only providers through `local-mcp-bridge.ts`. No vendor MCP server, skill
or CLI reaches an agent.

The router grants the namespace per call. It is absent when:

- the person is not signed in to Cultura Builder;
- `/session` has the connection off (the kill switch), fails, or answers outside the contract;
- the agent's own setting `connectionsOff` names the connection (`AgentSummary.connectionsOff`,
  stored on the agent record, local only, absent = every connection);
- the turn does not come from the person at this computer, one of the person's routines, or an
  agent that the person's turn started. A chat app thread (Slack, Discord, Telegram) and a team member never get it, and a channel gets it only
  while nobody but the owner can write in the channels (`#connectionContext`, with the rule of
  `chromeTurnOrigin`; `hubTurnOrigin`, from the mailbox deliveries of the turn; see
  [Who may use them](#who-may-use-them)).

`/session.active` does not close the connections: it says whether the account may use the LLM.
Tool discovery (`tool_search`, `tool_describe`, `tool_call` resolution) waits at most 750 ms for
`/session` (`DISCOVERY_WAIT_MS`); past that, the turn gets no connection tools, and the read goes on
for the next turn. A failed read of `/session` or of the catalog is kept 60 seconds
(`HUB_FAILURE_CACHE_MS`), so a Hub that does not answer holds no agent for 25 seconds again; the
person's Refresh reads again at once.

## Who may use them

The origin of a turn is the most closed origin of its thread and of each of its deliveries
(`hub-connections/turn-origin.ts`), from the most open to the most closed: `owner_ui`, `routine`,
`agent`, `routine_agent`, `unknown`, `team_member`, `messaging`. Only the first four get the tools,
and the tools read `routine_agent` as `agent` (`hubConnectionOrigin`). `routine_agent` is an agent turn
that a routine started, at any distance; it keeps the owner's Chrome closed along the whole chain
([browser.md](browser.md)).

- A message that the person writes in the app is `owner_ui`; with a team member stamped on it, or
  on its last queue edit, `team_member`; in a channel, `team_member` (for the connections and the owner's Chrome, `owner_ui` while no team member can write in the channels); from a chat app (also as the
  answer of an agent that works there), `messaging`.
- A message that an agent sends carries the origin of the turn that sent it, as `sentOrigin` gives
  it: the person's own turn passes on `agent`, a routine passes on `routine_agent`, and a closed origin
  stays closed. This holds
  for `send_message`, the brief of `start_task`, the first message of an agent that `create_agent`
  makes, an interrupt notice and an automatic result. An agent message with no origin (one stored
  before this version) is closed.
- An agent that `create_agent` makes keeps the caller's `connectionsOff`, and has every known
  connection off when the creating turn is not the person's own (`owner_ui`). The person turns them
  on in the agent's settings.
- A routine run has the origin of who saved the routine (`routineOriginOf`, kept in the mailbox
  metadata row, `routineOrigins`, key `routine:<id>`): the person in the app (the Routines editor,
  or a team member's app as the person's own device) gives `routine`; an agent's or a routine's turn
  gives `routine_agent`; a team member (through a tool or the Team API) and a chat app give a closed origin.
  Every save writes its entry. A routine with no entry runs closed (`unknown`): one that an import, a
  template, the marketplace or an older version made. The person saves it in Routines to open it.
- A change of a saved routine sets a more open origin only when the person (`owner_ui`) saves its
  whole text: the Routines editor, a whole event-routine record, or `update_webhook_routine` with a
  new `instruction` and new `filters`. Every other change (a name, a schedule, `active`, a policy, or
  any change by another origin) keeps the most closed of the recorded origin and the new one.
- A copy of an agent gives each copied routine the entries of its source, narrowed to the origin of
  who copies it: `owner_ui` in the app, the member's origin through the Team API. A copy with no
  known copier is closed.
- A run that a turn starts (`test_routine`) gets at most that turn's origin. A webhook test event
  gets at most the origin of who sent it (`webhook-tests-v1` passes the member's).
- The mailbox keeps the most closed origin of who holds a webhook routine's signing secret
  (`secret:<id>`). A Team API save that makes the secret, and a Team API rotation, write the
  member's origin; the person's own rotation clears it, and a secret that the agent tool drops has
  no holder. A relayed request runs with at most `routineOriginOf` of that holder: the holder can
  sign any request.
- A flow handoff gets at most the origin of each earlier step of its run and of every delivery of
  each step's turn (`routineRunSenders`, read by `deliveryOrigin`), so a team member's edit of a
  queued step, or a member's message that joins a step's turn, closes the handoffs after it. It also
  gets at most the origin of each link that a turn other than the person's own added
  (`narrowFlowOrigin`). A workflow step has no stored routine, so it is closed.
- The Hub gets `origin` `owner_ui`, `routine` or `agent` only.

Every call is paid, so the agent spends only when the person put a store chip in the conversation (`PAID_DATA_RULE`).
A tool chip (`[tool-catalog: … (id)]`) is the person's request to use that tool: the agent describes and calls it in
the same turn, and the cost approval below stays with the app. A platform chip (`[tool-catalog platform: YouTube (youtube)]`,
made by choosing a platform tile after `/`; `createStorePlatformToken`) is a macro request: the agent searches with
`platform` once for each job, lists the matches with prices (a search gives at most 10), gives the expected total, and
calls the tools that fit after one agreement. With the store's name only in words, the agent does not search or call: it
tells the person to type `/` and the name. Every endpoint reads only, so a request to post or upload is refused in
words. With a chip but no tool in `tool_search`, the agent says why (signed out, connection off for this agent, or a
turn from another agent or a chat app) and does not fall back to the browser silently.

`tool-catalog` has three operations: `search` (by job), `describe` (closed schema and price) and
`call`. The texts that the agent reads are Builders Bot's own (`HUB_CONNECTION_GUIDANCE`), in
English, without vendor text. The vendor lines of the treg design §2.2 are masked in every Hub text
(`maskVendorPhrases`); a search row or a describe with such a title is dropped.

## Input checks before the Hub

`readCallInput` and `checkCallInput` run in the main process, in this order, and a refused input
never leaves the computer. The refusal names the rule and the field path, never the value.

1. Only `endpointId`, `query` and `body`. `confirmationId` and `maxCostMicros` from the model are
   dropped and named in `ignoredFields`: only the main process sets them.
2. At most 16 KB and 8 levels.
3. Credential names anywhere (`api_key`, `token`, `cookie`, `session`, `authorization`, `headers`,
   `proxy` …) and credential values: JWTs, cookie pairs and session cookies, `Bearer`/`Basic` values,
   known key prefixes and registered secrets (`findSecretValue`).
4. The closed schema of the mirrored endpoint: unknown field, missing field, type, enum, length,
   range, list size.
5. URLs: every `format: "uri"` field and every value that is a URL must be public `http(s)` on the
   default port, with no user, password or signature. Private, loopback, link-local and
   `100.64.0.0/10` (Tailscale) addresses, `.local`, `.internal`, `.ts.net`, `localhost` and `file:`
   are refused (`isPublicAddress`). A URL of a special scheme (`http`, `https`, `ftp`, `ws`, `wss`,
   `file`) is read as a URL parser reads it, also with no `//` or with `\`: `http:\\10.0.0.1`,
   `http:/10.0.0.1` and `https:10.0.0.1` are URLs of `10.0.0.1`, as a whole value and inside a
   text. A signed query is a name of `SIGNED_QUERY` or a name with the word `signature`, `sig` or
   `credential` (`isSignedQueryName`).

A `search` text gets rule 3 too (`valueRule`), so a key, a cookie or a token never leaves in a
search, also when the Guard is off. The cookie and token shapes are the Guard's own
(`cookieOrToken` in `guard-triage.ts`), so both locks refuse the same values; the Guard then stops a
cookie or a session that reaches it, with no card ([The Guard](guard.md#connection-tools)).

The Hub runs the same checks again.

## Calls about people

A describe answer with `personalData: true` (people and contact data, creators, people endpoints of
a social network) is an endpoint about people who did not agree to the lookup (the treg design §4.6
G3, question L4 for the lawyer). After the input checks and the Guard, the first such call of a
conversation shows a card that names the endpoint, the values that the call asks about (names,
domains, addresses; at most 300 characters) and where the data goes: Cultura Builder, treg.to (USA)
and the provider (`status.agent.connectionPeopleData`). **Allow** covers the next calls about
people in that conversation; **Deny** sends nothing, and the next call asks again. A routine run or
a turn that another agent started never makes such a call, also in a conversation where the person
allowed it: the result is `needsPerson: "people_data"` with no card.

## Who pays

`choosePayer` reads the catalog's access rows that can pay (`enabled`, `allowed`, `consented`):

- The anchor is the organization that the person chose, or the one that paid the last call.
- With no anchor: the only organization, else the personal plan when it is the only row.
- Several organizations, or an anchor that is gone: `choose_org`. In a person's own turn, a card
  asks about each organization in turn (at most three). A routine run or a turn that another agent
  started gets a refusal. The app never moves the cost to another organization by itself.
- A Hub answer `choose_org` (the person left the token's organization) drops that organization's
  token and catalog, so the next call asks again.

## Cost approval

A call above the organization's `confirmAboveMicros` gets `confirm_cost` from the Hub with a
`confirmationId`. The id stays in the main process. The person approves the cost on the Hub, not in
the app: the Hub no longer trusts an approval that the app declares (contract §6.4).

1. In a person's own turn, the app shows a card with the endpoint, the amount and the payer, and
   says that the approval is on the Cultura Builder Hub (`status.agent.connectionConfirmCostOnHub`).
   Only the owner can answer it (`ownerOnly`), and a Full access grant does not answer it
   (`alwaysAsk`). **Deny** sends nothing.
2. After **Allow**, main opens `https://hub.culturabuilder.com/builder-ai/conexoes/aprovar/<id>` in
   the default browser (`shell.openExternal`, through the `openHub` option of `AgentService`). Only a
   page that `isHubPageUrl` accepts opens: the Hub origin over https, that path or the connections
   page, with no query.
3. Main reads `GET …/connections/tool-catalog/confirmations/<id>` with the payer's proxy token every
   2 seconds, until a state other than `pending`, the deadline (the Hub's `expiresAt` and at most 5
   minutes) or the end of the turn (the abort signal of the tool request). A read that fails for the
   network, a 5xx or a refused proxy token (a new token is asked for) is read again; a `429
   rate_limited` waits its `retryAfter` first. A sign-out, a refused token request, an error answer
   such as `404 not_found`, and the plain-text 404 of a gateway with the connections off end the wait.
4. `approved`: the app sends the call once, with the id and `maxCostMicros` equal to the approved
   estimate. `denied` is a refusal with `declined`, `expired` and the deadline are a refusal with
   `expired`, and `used` or a failed wait is a refusal. None of them sends the call.
5. A call that the Hub answers `409 not_allowed` with `confirmation_not_approved` or
   `confirmation_denied` is a refusal: the Hub has no approval of the person. A second
   `confirm_cost` for the same call is not asked again.

In a routine run or a turn that another agent started, the answer is a refusal with no card and no
page.

## Results

- Every Hub text and every result reaches the agent inside
  `<connection_output untrusted="true" connection="…" endpoint="…" served_by="…">`, with `<` and
  `>` escaped in the content. Attributes are slugs only.
- Results are masked again in the app (`result-mask.ts`), in the decoded answer: each value under a
  field whose name is a credential (`isCredentialName`, the rule of the input check and of contract
  §6.3), at every depth of it, numbers too (a number stays only under a count name such as
  `sessions`; booleans and null stay); each URL query parameter whose name, decoded from
  percent-encoding, is a credential or a signed URL's (`isSignedQueryName`: `X-Amz-Signature`,
  `X-Goog-Credential`, `sig`); `Bearer` values; and every known key prefix and registered secret in
  one pass (`findSecretValues`). A secret that still shows after the mask holds
  the whole result back (`result_withheld`). This catches a provider key that the Hub missed,
  also a key with no prefix in a field such as `X-Auth-Token`.
- The Hub's answer must name the token's organization; another one is refused as
  `hub_unavailable`, and the payer does not move. A charge above the approved amount (or, with no
  card, above `confirmAboveMicros`) is logged and gets an `overcharged` line in the chat.
- The Guard reads the content of `list`, `search`, `describe` and `call`
  (`GUARD_TOOL_INBOUND`, `GUARD_INBOUND_PATHS["hub-connections"]`) and the input of `call`
  (`GUARD_TOOL_EGRESS`, `guardOutboundItem`).
- One call result is kept for the turn: the same input again is free (`repeated: true`), and
  `offset` pages a long result 30,000 characters at a time.
- In a turn that another agent started, results leave out the amounts and the payer: they would
  go to that agent's provider.
- A result that holds an email address or a phone number gets the field `contactData`, outside the
  envelope, with Builders Bot's fixed note (`CONTACT_DATA_NOTE`): the contacts are guesses of the
  provider, and the agent contacts none of them unless the person asks for that address (G9). The
  app does not stop a later send to such an address by itself: `messaging_post` posts only to places
  that the person connected, and a send in the browser or a shell is outside these tools.
- A vendor line that the app takes out of a result is replaced with `[vendor instruction removed]`,
  and the Guard puts its note in front of that result (G5). The patterns read each decoded string,
  so a line break, a tab or two spaces inside the line do not hide it; the Guard reads the decoded
  text of a connection result too (`decodedJsonText`).

## Limits

20 calls and 40 lookups per connection per turn; 200 paid calls per hour for all agents of the
computer. The Hub has its own velocity limits.

## Failure

The tools fail closed. Signed out, offline, Hub 5xx, an answer outside the contract, a refused token,
the kill switch: each one gives a fixed text and code (`FAILURE_TEXT`, `ERROR_TEXT`), never the
Hub's or the vendor's words. The app never retries by itself. A `connection_unavailable` answer or a
`connections_disabled` token error makes the next turn read `/session` again, so the tools leave the
catalog.

## Secrets

- The Cultura Builder sign-in (the device flow) uses the fixed public client of Builders Bot,
  `CULTURA_BUILDER_CLIENT_ID` in `cultura-builder-auth.ts`, and never registers a client. The Hub
  lists that client for the proxy, so its sign-ins get the refresh family that a proxy token needs.
  A session of an earlier version (a client that each sign-in registered) has no such family: the
  person signs in again.
- The session tokens stay in the credential store and the main process. The proxy tokens stay in
  memory. Nothing of a connection is written to disk.
- One grant of the refresh token runs at a time (`withCulturaRefreshGrant`): the session renewal,
  which can rotate the token, and each proxy token request, which reads the session again once it
  holds the lock.
- A Cultura Builder sign-out and each sign-in forget the payer choice, the approvals of calls about
  people, the use and every cache of the session's person (`HubConnectionTools.forget`); a session
  that is gone when a connection reads it does the same.
- `cbp_` (proxy token) and `treg_` (vendor key) are in `KNOWN_SECRET_PREFIXES` of
  `packages/logging`, so log redaction masks them without registration.
- The agent process gets no token: no environment variable, argument, file or tool result.
- A local server's process (a child of the app) holds no session and no proxy token either: it asks the app
  over a private channel ([Local servers](#local-servers)), and only the app's process reads the credential store.

## Local servers

A local server is a second server that this app runs on the same computer, as its own headless child
process (`src/main/local-server-child.ts`, [servers.md](servers.md#servers-on-this-computer)). It has its own user
data and its own credential store, signed out of Cultura Builder, so its agents had no connection tools.
They have them now, for the person that is signed in to the app, with no session in the child.

**Design.** The child builds its `HubConnectionTools` with `HubConnectionDelegate` in place of
`HubConnectionClient` (`AgentService` option `hubConnections.client`; both are a `HubConnectionPort`). The
delegate sends each Hub operation to the app, and the app runs it with its one `HubConnectionClient`
(`HubDelegateHost`, made by `AgentService.serveHubConnections` and `LocalServers` for each start of a child).
The tools of the child (access, origin rules, per turn and per hour limits, payer rules, approval and cost
cards, `team_member` closed in channels) are the same code and do not change; only the transport of the client
does.

**Channel.** The pipes that `LocalServers` already makes: the child writes requests to its standard output
(the app reads that stream for its ready line already), and the app writes answers to the child's standard
input (the child ends when this input closes already). One JSON message is one line:

| Line | From | What |
| --- | --- | --- |
| `BUILDERSBOT_HUB_DELEGATE_HELLO <key> <json>` | app | The first line, once: a random 32-byte key of this start of the child, and the first snapshot. |
| `BUILDERSBOT_HUB_DELEGATE <mac> {id, method, args}` | child | A request. `mac` is HMAC-SHA256 with the key over the direction and the text. |
| `BUILDERSBOT_HUB_DELEGATE <mac> {id, ok, value \| code, snapshot}` | app | The answer of the request `id`. A failure is the code of `HubConnectionFailure` (`signed_out`, `offline` …) and no text. |
| `BUILDERSBOT_HUB_DELEGATE <mac> {type: "snapshot", snapshot}` | app | A change of the snapshot. |

The key is not in the environment, an argument or a file. A process that is not the child but holds the
descriptor of its output cannot make a request that passes. A request id only grows. Limits: 64 KB for a request,
4 MB for an answer, 60 s to wait in the child (55 s in the app), 8 requests in flight, 240 in a minute and 200
paid calls in an hour for each child. The line readers drop a line past the limit whole.

**Methods.** Only `capabilities`, `catalog`, `search`, `describe`, `call`, `confirmation`, and the notices
`forget_catalog`, `forget_capabilities` and `forget_org` (a cache of the app's own client is stale; no read).
The app refuses anything else, and `usage` and `requestAccess` among them: those belong to the person's own
screens, which a local server has not. The app checks each request as the child's own tools check it, and does
not trust the child's checks:

- exact keys and ids (`isHubOrgId`, `isHubEndpointId`, `isHubConfirmationId`, a UUID for the idempotency key);
- `search`: `toolCatalogSearchRequest` and `valueRule`, as in the tools;
- `call`: `readCallInput` (size, depth, only the fields of the tools), then `checkCallInput` (closed schema,
  credential names and values, public URLs only) against the endpoint description that the app reads from
  the Hub itself (kept 5 minutes), never one that the child sends. A refused input is an `input_refused`
  answer and goes nowhere. `maxCostMicros` is accepted only with a `confirmationId`, and the id only if the app gave
  it to this child in a `confirm_cost` answer;
- no `fresh` read: the app's client keeps the session and the catalog for its own times;
- the app's own hourly limit of paid calls, for each child, as a second lock.

A line that fails its check is dropped. After 10 of them the app stops serving that child, and logs one fixed
line (`hub-delegate`). No log line holds an id, a value or an input.

**Snapshot.** `signedIn()` and `knownConnectionIds()` of `HubConnectionTools` are synchronous, so the child
keeps the last snapshot that the app pushed. The app pushes it in the hello, with every answer, when its client
forgets the session (a sign-out, a new sign-in), and after a look every 15 s for a sign-out that did not go
through the app's own sign-out. The delegate has no other cache, so nothing outlives a sign-out.

**When the app serves.** Only a child that `LocalServers` started, because the host is made there for each start,
and while a Cultura Builder session is stored in the app. A signed-out app answers `signed_out` to every
operation and reads nothing from the Hub; the same host serves again after the next sign-in, with no restart of
the child. The host closes when the child exits, when the app stops it, or when the child's input cannot be written;
a close drops every wait, and the delegate fails each wait with `offline` when its input ends. A joined server of
another host (AWS, WebRTC, another person) has no such channel and stays closed.

**What crosses.** Never the session (access and refresh token) or a proxy token (`cbp_`): the refresh token
rotates and one process at a time may use it (`withCulturaRefreshGrant`), so it stays in the app. The answers are
the decoded contract values, which carry no credential. The one approval id of a `confirm_cost` crosses, because
the child's tools use it as the app's own tools do (it opens the Hub page, and the child reads the status with it).
It is not a credential: the Hub does not accept it as an approval without the person's own sign-in on the Hub page.

**What does not move.** The payer the person chose on the Marketplace page of the app is a state of the app's own
tools, not the child's. A child's agent asks its own payer card in its own chat (the answer stays in the child's
memory, as the tools keep it). The per turn and per hour counts are the child's own, and the app's hourly limit for each
child stops a runaway. The Guard of the child uses the child's own credentials. The cost cards and the
people-data cards are shown in the child's chat, as for any agent of that server.

## The person's screens

Main gives a window, through the `hub-connections:*` IPC group, only views without a credential
(`packages/contracts/src/ipc-hub-connections.ts`): no token, confirmation id or Hub URL. The preload
decodes each value again (`src/preload/hub-connection-decoding.ts`). `HubConnectionTools` builds the
views (`hub-connection-views.ts`) from the catalog and `/session` answers that it already caches.

| Endpoint | What it gives |
| --- | --- |
| `getView`, `refresh` | The connections of the catalog: texts, the access row of each organization (cap, spend, state, categories, cheapest price, open requests), who pays the next call (`pay`, `choose_org`, `none`), whether `/session` has the connection on, and the platforms of the vendor catalog (`platforms`). `refresh` reads the Hub again. A failure is a status (`signed_out`, `off`, `unavailable`), never an error. A `/session` with no connection entry is `off`, and the catalog is not read; a catalog connection that `/session` does not name is left out. |
| `getUsage` | The person's own use for each organization whose row this app may spend, with the spend by platform. Off until `/session` says `connectionsUsage`. Each organization is read at most once in 30 seconds; a paid call drops its copy. |
| `choosePayer` | The organization that the person chooses on the page. Only a row that can pay is kept. The agent has no path to it. |
| `requestAccess` | "Ask the admin" (`access`) and "Ask the admin for more" (`more`), through the Hub route of the contract (§10.1). Never for the personal plan or an organization that is not in the catalog. |
| `openConsent` | Opens the connections page of the Hub (`https://hub.culturabuilder.com/builder-ai/conexoes`) in the default browser, where the person allows this app to spend an organization's connections. The URL is fixed in main; the renderer sends none. |

### The message box picker

`HubConnectionTools.searchEndpoints` (IPC `hub-connections:search-endpoints`) gives the tools of the
tool catalog that fit the words after a `$` in the message box (`ComposerEditor`, prop `storeSearch`).
It is read only and spends nothing from this app: it uses the organization that already pays the
connection (`choosePayer`), never asks a card (`needs_payer` tells the person to choose on the
connection's page), refuses an empty text or one that holds a key or a token (`valueRule`), and sends
at most 40 searches a minute. The renderer sends a query only when it starts with a letter, has 3
characters and waits 350 ms, so `$5` in a sentence goes nowhere. Choosing a result writes
`[tool-catalog: <title> (<endpointId>)]` in the draft; the agent then runs `describe` and `call`, and
the cost card and Hub approval do not change. A chat and a channel of this computer get it, and so does a server that this app runs on this computer
(`thisComputer`, see [Local servers](#local-servers)); `storeSearch` is absent on a joined server of another host (AWS,
WebRTC, another person); the "+" menu has a "Store tool" item that opens the same `$` picker. In a channel the
`$` lists the skills of the agents that the draft tags (`createChannelSkills`), or of its only agent. The Hub may charge for a search: confirm before relying
on it. A `/` at the start of a message or line opens the same search with the store's tools only. A chosen tool
shows as a chip (`createStoreToolToken`) and serializes to the same text; a draft that holds that text shows the chip
again (`STORE_TOOL_PATTERN`). A query goes to the Hub only when it reads as words (`isStoreQuery`: a letter first, then
letters, digits, spaces, `_` or `-`, at least 3), never as a price or a path.

### Marketplace

A connection is an app of the Apps tab (`kind: "connection"`), so the curated list decides if it
shows ([marketplace-apps-curation.md](marketplace-apps-curation.md#hub-connections)). It has its
own group, Connections, before the categories, and the side panel lists the ones in use under
"Your connections". The renderer adds the rows only when the Marketplace is for this computer
(`hubConnections` of `MarketplaceModal`): a joined server's agents do not use this computer's Hub
session.

Each platform of a connection (`platforms` of the catalog, such as Google Ads or the app stores) is
also a tile of the Apps tab (`kind: "connection-platform"`, id `<connection>:<platform>`), in the
category of its group: SEO, research, reviews and community in Research; enrichment, market and
commerce in Data & Analytics; developer in Coding; generation in Design; advertising, social and
other in Other (`PLATFORM_CATEGORY`). A tile shows the platform name, "Via Cultura Builder · {n}
tools" and the status of its connection, with no install button; it opens the connection's page. The
tiles show only while the connection is on (`enabled`) and not `idle` for the person, so they are
always in use for `curateApps`; an account without the capability, or a paused connection, has none.
The search finds them by name. They have the connection's generic mark: the app fetches no logo.

The page (`MarketplaceConnectionPage.tsx`) follows the integration page rules: what it gives, the
categories that the organization allows, the person's cap with the bar and its 80 % mark (a
`progressbar` with a value text), who pays with "Pay with {org}" when more than one organization
can pay, a switch per agent of this computer, and "Where the data goes" ("Provided by {vendor}", the
flow to the Hub, the vendor and the provider, and the retention that the Hub declares). The alerts
say when Cultura Builder paused it, when the person must choose who pays, when this app has no
consent of an organization yet ("Open the Hub", which opens the Hub's connections page; then Refresh
in the header),
over 80 % and at the cap, with "Ask the admin for more". A row that the person may not use names why, with "Ask the admin".
After a request, the page shows "Request sent on {date}" from the Hub's `requestedAt`.

The switch of an agent writes `connectionsOff` through `agent.updateAgent`: an agent with the
connection off has no `buildersbot_connections` in `tool_search`.

### Usage › Connections

`ConnectionUsageReport.tsx` under the model report of the local server: what Cultura Builder
charged this month, in the organization's currency, by organization and by platform. It is never
summed with the model estimate in USD. It shows only when `/session` says `connectionsUsage`.

### Cost lines in a chat

After a call in the person's own turn or routine, the router adds a system message to the chat
(`hub-connection:paid|warning|limit`, its text the JSON of `HubConnectionChatEvent`, as the hosted
site events do). The screen writes the line in the reader's language and money format:

- `paid`: "{endpoint}: paid by {org} · {amount}", after each call that ran.
- `warning`: the call that crossed 80 % of the cap (the Hub's `warningCrossed`, once a period).
- `limit`: a call that `cap_reached` or `org_budget_reached` stopped, once per turn and
  organization, with "Ask the admin for more" in a chat of this computer.

A turn that another agent started gets no line: it gets no amounts either. The agent's own
history tools can read these lines, as they read every message of the chat; the agent already got
the same amount and payer in the call result.

## Checks

`bun scripts/hub-connections-call-e2e.ts` drives the real agent service, router, Guard, cards and
Hub client with a fake Codex app-server against `scripts/fake-hub/` (a fake Hub and a fake vendor on
127.0.0.1). It writes `.buildersbot-build/hub-connections/tool-catalog.json`.

`bun scripts/hub-connections-local-server-e2e.ts` runs the app's half (the real agent service, Hub client and
`HubDelegateHost`, with the session) against the fake Hub, and a second Bun process as the local server
(`scripts/fake-hub/local-server-child.ts`: no session, a `fetch` that refuses everything, the real delegate over the
real pipes, the real agent service and tools). It checks the tools closed while signed out, the search, the payer
card, a paid call, the input checks, a forged line, `confirm_cost` with the approval on the Hub, a declined cost,
that no session, proxy token or vendor key is on the channel or in a file of the child, a sign-out and a new
sign-in with no restart, and the host that stops with the child. It does not run Electron or `LocalServers`
(the unit tests in `src/main/local-servers` cover the spawn side with a fake child). It writes
`.buildersbot-build/hub-connections/local-server.json`.

`bun scripts/hub-connections-usage-e2e.ts` checks the views of the screens from main's side: the
page view and its decoders, the payer that the person chooses, the requests to the admins, the cost
lines of a paid call, the 80 % line once, the limit line once per turn, the usage by platform and its
cache, the per-agent switch, the usage capability, the kill switch and a Hub that does not answer.
It writes `.buildersbot-build/hub-connections/usage.json`.

`bun scripts/hub-connections-surfaces-e2e.ts --storybook=<url>` drives the stories of the list (with
the tiles of the platforms in their categories, and none while the connection is not on or paused;
with every provider on, 40 tiles, a search of them, and a limit in US dollars),
the page in each state (with "Open the Hub" of the consent state), Usage › Connections and the chat
lines in a headless browser, in en and pt, dark and light, at 1280 and 390 pixels, and writes
screenshots and
`.buildersbot-build/hub-connections/surfaces/report.json`. Its `knownIssues` keeps one issue that
this change did not make: at 390 pixels in Portuguese, the model report of Usage (its breakdown
table) makes the Usage body scroll about 45 pixels sideways, also with no connection part. The check
of Usage covers the page and the connection part. Run it with the headless shell of Playwright:
`PLAYWRIGHT_BROWSERS_PATH=<folder> node node_modules/playwright-core/cli.js install --only-shell
chromium-headless-shell` installs one into a folder of your choice.

`bun scripts/hub-connections-treg-live-e2e.ts` checks the sign-in with the fixed client (no
`/register`), the `platforms` of the catalog through the contract and preload decoders (malformed
rows dropped, 120 platforms with every provider on give the first 40, an older Hub, an account
without the capability), the cost approval on the Hub (the
exact page URL, the status reads, one call after `approved`, nothing for `denied`, `expired`, `used`,
a Deny on the card, a routine run, and a call that the Hub answers `not_allowed`), and the consent
page. It writes `.buildersbot-build/hub-connections/treg-live.json`.

`bun scripts/hub-connections-safety-e2e.ts` checks the Guard rules G2, G3, G5, G6, G7, G9 and G11,
the person's own treg entry off in Codex and OpenCode, the Settings notice, the absence of the
vendor lines of §2.2 in every agent text and source file, and the Guard time. It writes
`.buildersbot-build/hub-connections/safety.json`. Both scripts share
`scripts/fake-hub/agent-harness.ts`.
