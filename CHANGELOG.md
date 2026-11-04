# Changelog

All notable changes to Builders Bot are documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md).

## [Unreleased]

## [1.1.0] - 2026-11-04

### Added

- On a Mac laptop, Settings › General has "With the lid closed". "On power adapter" should keep the
  Mac on with its lid closed while the power adapter is connected, with no password. "Also on
  battery" keeps it on with battery power too. It asks for the administrator password one time, to
  install a small safety service. The service turns normal sleep on again when the battery goes below
  the level that you select (also on the power adapter while the battery does not charge), when the
  Mac is too hot, after 8 hours on battery with the lid closed, and in about 2 minutes when Builders
  Bot quits or stops. When the mode stops with the lid closed, Builders Bot and the service ask macOS
  to sleep. The mode is off by default, and it also has a time limit. While the mode is on, the Mac
  also does not sleep when it is idle, with the lid open too.
- "Test with the lid closed" uses the sleep record of macOS to find if the Mac slept while its lid was
  closed, and shows the result.
- When macOS has sleep turned off and Builders Bot did not ask for it, Settings shows "Restore normal
  sleep", and a desktop notification tells you.
- Settings shows when the safety service is installed but does not run, and when it did not turn
  sleep off.
- Settings > Mobile Connect and the sign-in step of Add phone show whether your phone can reach this
  computer. When the server of this computer is not published, Publish this server publishes it
  with one click.
- Put the pointer on a chat tab to see how the thread started: its first message on up to five
  lines, and your last message. The tab of the agent's own chat, and a thread tab beside the chat,
  show the same preview.
- The selected tab has an info button before its name. It opens the details of the thread: when it
  started, the first message and your last message, each with "Show more" and a copy button. In a
  narrow window, the thread menu has "Thread details". The first message stays the same when you
  rename the thread, so you do not lose what it is for. The close control of the selected tab moves
  to its end.
- Threads and chats from before this update show their first and last messages too.
- A joined server now signs in Cultura Builder on the host with the Hub device code. The Cultura
  Builder row no longer says that a remote server cannot connect it. The access token stays on the
  host, and the Hub proxy serves the models.
- The first provider step of a joined server downloads the Builders CLI when Builders is the choice
  and the host does not have it, as the first run does. The step no longer waits for the user to press
  Download.
- Limit the agents that run at the same time, in the load panel. It is off by default. On, a new turn
  waits in its queue while the limit is reached and starts by itself when an agent ends. The panel
  lists the agents that wait for a place, and the load ring shows the count of the limit, such as "3
  of 10", with a full circle when the limit is reached.
- When a provider does not start a task, the app tries again by itself: 3 more times by default,
  after about 10, 30 and 90 seconds. Then it runs the task on a backup model: the agent's own, or a
  new default backup model in Settings › Agents › Retries and backup model. The channel shows
  "Trying again (2/3)" in place of the card, and the card says how many starts ran.
- A usage limit, such as the 5-hour window of Claude, is tried again by default, because some
  accounts move to another account by themselves. You can send it to the backup model at once
  instead.
- An agent whose model failed stays on its backup model for 5, 15, 30 or 60 minutes, then one task
  tries its own model again. A task that started on the backup model ends there. Settings › Agents
  lists the agents on a backup model now and until when.
- Choose where agents reach the web, in Settings, General. By default Playwright attaches to the
  browser that is already open through its extension, so no second Chrome starts for each session.
  Turning on "Use the Builders Bot browser for the web" leaves Playwright out and points agents at
  the Builders Bot browser. The choice applies from the next turn, with no change to saved servers.
- The switch "Shorter channel context" in Settings > General > Advanced optimizations (beta) now
  works. With it on, an agent in a channel gets in full only the messages that its request needs, up
  to 4,000 characters each: the request, the message it replies to, messages that mention the agent,
  results of its subtasks and the last 2 messages. Other long messages come shortened, with their
  size and a pointer that the agent uses to read the rest. A cut does not end inside a code block.
  The next request in the same session leaves out the channel rules, details and memories when they
  did not change. Off, which is the default, channels work as before.
- Agents can read one channel message by its id, in parts of 12,000 characters, and a short page of
  up to 20 messages with a preview of each one.
- A load ring in the page rail shows how many agents work now and how much memory Builders Bot and
  its agents use. A click opens the details. The ring shows only for the server on this computer.
- Run one channel at a time, with the switch in the load panel. Only one channel starts work, and
  the next one starts when it ends, in the order you choose with Run first. Work that runs is never
  stopped. Run now starts a waiting channel beside the one that works, for example when that channel
  waits for your answer. The mode is off by default.
- Edit a channel member in the channel settings: the name, face, title, instructions and model
  open over the member list, without leaving for the agent's own settings. The member picker also
  creates an agent there and adds it to the channel in one step.
- Clicking a channel's title opens the list of its tabs: each tab's age, the running ones first or
  the most recent first, and a search inside the channel. A tab can be pinned to stay first, short
  and marked, as the way back to it.
- The message box of a channel has the microphone beside Send, as the chat of one agent has. Speak,
  then stop to put the text in the draft of the open tab, or send while you record to send it at
  once. The message goes to the agents that the channel routes it to, and to the tab where you
  started the recording, also when you open another tab before it ends.
- The Builders Bot Chrome extension can now connect to the app with no token and no network port:
  through a small signed program in the app and a private, encrypted channel. You pair a Chrome
  profile with two taps: one on the words in the app, and one on the words in Chrome. Nothing is
  copied or typed. The app package holds the program and the extension for a locally signed build.
- The Builders Bot extension is the default way to the web, and Playwright is the alternative that
  you can turn off in Settings. An agent that finds the extension not connected says so and offers
  to install it. In a development build, or with an installed app, the extension is loaded unpacked
  in Developer mode; the app writes the link that lets Chrome start it at each start.
- Settings > General has the switch "Use the Builders Bot extension in my Chrome", on by default. On,
  agents work in tabs of your own Chrome through the Builders Bot extension. Each project gets a tab
  group with its name, an agent keeps its tabs from one turn to the next, and tabs open in the
  background without taking the focus. Banks, password vaults and government sites stay blocked, an
  agent's own scripts are off, and each message that an agent sends on a mail, chat or social site
  waits for your approval of the text and the recipients. Messages from team members, channels that
  team members can write in, chat apps and routines do not reach your Chrome.
- Before an agent reads or acts on a mail, chat, cloud console, social network, payment page or a
  site of your own network in your Chrome, you allow it once for that project. The answer holds until
  Builders Bot restarts.
- An agent can no longer send a message in your Chrome around the approval card: Enter, Space, a new
  line, a button with no name, a part of a button's name, and a recipient that changed after the
  agent read the page all ask you first.
- Agents that a routine or a webhook started, also through other agents, do not reach your Chrome.
- More ways around the approval card in your Chrome now ask you first: a key with a space or a "+"
  after it, Alt+S and other keys with Ctrl, Cmd or Alt, a button named only by a symbol, a button in
  Spanish, French, German, Italian or Dutch, a tab or another control character in the text, and a
  button that the agent named by a part of its name, which the page can change after the agent read
  it.
- More ways around the approval card now ask you first: a send button in Japanese, Russian, Arabic or
  another language, a button whose label and visible text differ, a send button in a web component or a
  frame, and a space typed while a button has the focus. While a message is being written, any button
  asks unless it is an action such as Cancel, Close, Attach or Bold.
- Builders Bot connects only to its own Chrome program when Google Chrome started it. A copy of that
  program that another program starts, or that a program starts and then turns into Chrome, gets no
  connection and opens no pairing card. The pairing words stay the main protection.
- An app that you sign on your Mac with `bun run package:signed` now holds the small program that
  connects the Builders Bot extension to it, the check of that program, and the extension itself at
  `Contents/Resources/chrome-extension`. The extension then works in the installed app, with no
  development run. The app takes the program only when it has the same signature as the app and
  Google Chrome started it.
- `bun run chrome-extension:kit` makes the extension folders to load in your own Chrome and writes
  the steps to connect it, for the app in development and for a locally signed app.
- Delete a channel together with its agents: when some members are in no other channel, the delete
  confirmation lists them with "Also delete the agents that exist only in this channel", off by
  default. The channel goes to Deleted channels first, then each agent is deleted (on desktop, each with its own Undo).
  Restoring the channel does not bring these agents back.
- Act on a card of the Feed page without leaving it. Approve or deny an approval, answer a simple
  question (choose an option or type an answer), stop a run, and resume a stopped task or give it to
  another agent. A question with more than one part opens its conversation, as before.
- Select stopped tasks on the Feed page and resume them all, or give them all to one agent.
- Keys on a focused card: J and K go to the next and the previous card, A approves, N denies, R
  resumes.
- The card changes at once. If the action cannot be done, for example because the request was
  answered in the meantime, the card goes back and says why.
- A Feed page in the page rail shows what each run of each agent does, on every project and every
  server, as it happens. Each run is one card that changes in place: the agent, the project, the
  task, the state, the step that it does now and what it waits for. The newest run is at the bottom.
- The Team is a list on the side of the Feed page. Select an agent to see only its runs.
- Filter the feed by project, agent and state, search it (press `/`), or group it by project or by
  agent. The counters "Needs you", "Stopped" and "Working" go to the next such run.
- When you scroll up, the feed pauses and counts the new runs. A button goes back to the newest run.
- A run that needs you opens its conversation, where you answer. The feed shows only summaries: it
  never shows the text of a conversation, the arguments of a tool, or a secret.
- Settings has a Task reviewer page ("Fiscal" in Portuguese). Before, its switch showed only in the
  load panel, and only after Resume by itself was on. The page has the switch and says whether the
  task reviewer looks now, or waits for Resume by itself, with a button that turns it on. It also has
  the minutes before a task counts as stopped, the review model of the Guard that it asks and whether
  that model is available, the switches of the load panel that it follows, its last actions, and
  what it does and does not do. The settings search finds it by "Fiscal", "Revisor" and "Task
  reviewer". The load panel has a button to the page.
- The General section of a joined server's settings says that the server has its own Guard and task
  reviewer, and that this app cannot change them yet.
- Settings › Guard shows the Guard's siren at the top: the Guard's box with a dome on its lid. The
  picture follows the level (asleep when the Guard is off, the siren down in the box at Light) and
  says in text what the Guard does now, such as the local check only or no Cultura Builder sign-in.
  While a question of the Guard waits for you, the siren comes up and turns red.
- Under the siren, a card for each level sets the level of the Guard. Off and Light can be chosen;
  Strict, Very strict and Custom say "Soon".
- The card of a Guard question shows a small red siren at the start of its header until you answer.
- Add the Guard, an agent that checks what enters and what leaves your agents' work. It is on by
  default at Light, where it looks for prompt injection: in pages that the built-in and the shared
  Playwright browser read, and in the URLs, text, scripts, files, chat posts, sites and MCP servers
  that agents send or add. A fast local check reads everything first, and a small model (Builder
  Fast of Cultura Builder by default) reviews only what looks suspicious. A clear risk goes to the
  approval card, also for an agent with Full access; that card has no "Always allow". Ordinary
  pages, such as sign-in pages, cookie banners and pages about prompt injection, pass. Light never
  stops the work by itself, except in the shared Playwright browser, which cannot show the card: a
  call there that needs your answer does not run, and the agent tells you. Settings, Guard says when
  the chosen model is not available. Turn the Guard off, or choose another model or the local check
  only, in Settings, Guard.
- The load panel lists the work that stopped, with its channel, its request, the reason and the
  agent. You can resume one task, resume all, or reassign a task to another agent of the channel,
  the same model first. The panel also lists the agents that work now, with a Stop button.
- Resume by itself: stopped work starts again after an interval that you set (30 minutes is
  suggested). When you allow it, a task can go to another agent of the channel. Each task gets a
  fixed number of tries. It is off by default.
- A red count on the load ring shows how much work stopped.
- The load ring in the bar on the left now opens Settings › Load, a page with room for the work.
  It counts the stopped, failed and paused runs and the runs whose source was deleted. You can
  search, filter by state, agent, channel or tab, origin (routine or task) and source, and mark some
  rows, all rows, or all rows that the filters show.
- With rows marked, you can resume them, give them to another agent, change the model of their
  agents, or remove them, all at once. Remove asks first and can be undone for 10 seconds. A line
  says how many were done and why the others failed. Space marks a row and Shift marks a range.
- What runs now, the one-channel-at-a-time mode, the agent limit, Resume by itself and the task
  reviewer are on the same page, below the stopped work. The ring keeps its count and its tooltip.
- Review every message and image a person sends for prompt injection, before the agent acts on it.
  The reviewer is on by default and uses the model of the agent. A message that it finds suspicious
  or hostile reaches the agent with the verdict in front of it, so pasted instructions from a page,
  a README or an image are read as data. The switch is in Settings, General.
- After a forced close or a crash, Builders Bot asks which stopped work must continue: all of it,
  some channels, or some agents. Nothing starts again until you choose it. Not now keeps all of it
  stopped. A channel continues its stopped tasks in the queue, and an agent gets a message to
  continue in its chat.
- In the Routines view, the filter button beside the search field shows routine filters: Active
  routines, Paused routines, Created recently and Edited recently (the last 7 days). The list then
  shows only the agents of the selected section with at least one such routine. The Agents view keeps
  the activity filters, and each view keeps its own filter.
- Search opens on the Routines tab when you open it from the Routines view.
- While the sidebar selects a section, search shows a switch at the top: "This section" (the default
  each time search opens) or "All sections". With "This section", search shows only the agents,
  channels, routines, messages and files of that section. Press ⌘S (Ctrl+S) to move to the switch.
- The "Lighter channel routing" switch of Settings > General > Advanced optimizations (beta) works.
  When it is on, the lead chooses who answers a channel request at the lowest reasoning effort of its
  model, and the model stays the same. A follow-up in Portuguese or Spanish, such as "continua",
  "na verdade, ..." or "sí, hazlo", continues the work of its tab with no choice by the lead, as
  "continue" does. A follow-up never continues the work of another tab, and work in another tab no
  longer makes the lead choose again. The switch is off by default, and the channel then works as
  before.
- With "Continue after a short failure" on, in Settings > General > Advanced optimizations (beta), a
  channel task that a short provider or network failure (such as a 529 or a lost connection) stops in
  the middle of a turn continues by itself in the same session, at most 3 times. It continues only
  when nothing that the turn did can happen twice: before it continues, the app reads each step of
  the turn (reads, file changes, posts, pushes, messages) and tells the agent what is already done.
  When a post, a push or another outside action may already have happened, the task waits for you
  and says which action to check. When you resume it, the agent gets the same list of what is done
  and what may already have happened. The switch is off by default, and the app then works as before.
- Settings > Agents > Retries and backup model has the option "Continue also when an outside action
  is uncertain". It is off by default.
- A server can have a model policy: a file that its administrator writes on the host. The picker of
  the server then offers only the providers and models that the policy allows, and the free models
  of Builders are hidden. A provider that the policy does not allow is off and cannot be turned on.
- On a server with a model policy, the Cultura Builder models are the models that the Cultura
  Builder Hub allows for the signed-in account. A model that the Hub grants only to some people
  shows only for them.
- The activity filter of the chat list has a new choice, Finished recently: the agents and channels
  whose work ended in the last 24 hours.
- While a filter is on, the filter button shows a dot, and a notice at the bottom of the list says
  which filter is on and how many chats it hides. Show all turns the filter off.
- Markers in the chat list: "+" > New marker adds a thin line with a short text, such as Done, Soon
  or Waiting, at the top of the section. The chats below it, up to the next marker, can be dimmed,
  black and white, or tinted with a color. Click the marker to change its text and style, or drag it
  to another place. Markers are only on this computer's server.
- A section of the sidebar can have a color. Right-click the section name and open Color: choose
  one of ten colors, choose any color, or choose No color. The color shows as a light tint behind
  the section name and its chats. A new section has no color, and a duplicated section keeps the
  color. Only this computer's server keeps section colors.
- The section icon editor has a crop step: drag the image to move it, zoom with the wheel, a pinch or the
  slider, and use Fit, Fill or Center. The preview shows the result as you change it. You can drop an
  image on the editor or paste one, and you can use an SVG file. Builders Bot keeps a PNG or WebP
  square of at most 96 × 96 pixels.
- The section icon editor has a large icon library with search: type a name or a word in English or
  Portuguese, with or without accents (for example "segurança" or "security" finds the shield), or use
  a category. Your recent icons show at the top.
- A new Emoji tab in the section icon editor: search in English or Portuguese, nine categories, recent
  emoji and a skin tone choice. The section column shows the emoji large on its tile.
- The menu of a section in the section column has "Change color…". Each color shows on the tile at
  once. This works on this computer's server.
- Drag a section icon up or down in the column of sections to reorder the sections, or press Alt and an
  arrow key on a focused section. The list of chats follows the same order. This works on this
  computer's server.
- The column at the left of the chat list shows your sections: All, then each section, and a plus
  button that makes a new section. Select a section to see only its agents and channels. Each item
  shows when a chat in it waits for you, has unread messages or works. The app keeps the selection.
- A section can show one or two letters, an icon or a small image in that column. Right-click the
  section and choose Change icon. Without a choice, it shows the first letter of its name.
- Settings > General > Left column shows the servers there in place of the sections. With the
  sections, the menu on the server name switches servers and adds a server.
- A chat with more than one open tab keeps a bar at the bottom of its row in the sidebar. The bar
  or a click on the avatar opens the tabs under the row, 10 at most, and the tab that was open stays
  marked. Opening the chat from the list returns to that tab instead of the first one.
- An agent can open a site already signed in, with the sign-in of your own Chrome, through a new
  `use_site_session` browser tool. Only the cookies of that one site are copied into the Builders Bot
  browser, from the Chrome profile you used last, and the first time for a site you are asked once.
  Choosing Always remembers that site only; no cookie or value is stored or shown to the agent.
- Settings › Notifications has a Sounds section that lists every sound of the app on this computer,
  grouped by Agents, Approvals and questions, Guard, Task reviewer, Tasks and routines, Messages,
  Voice, Interface, System and Remote. Each sound has a switch, a sound menu, a volume and a play
  button, and "Mute all" silences the app and its macOS notifications.
- Choose a built-in sound, the system sound, no sound, or a sound file of your own (MP3, WAV, M4A,
  OGG or AIFF up to 2 MB, copied into the app folder) for each app sound, and a macOS sound for each
  notification.
- Recent sounds shows the last 20 sounds, who caused each one, and the sounds that your choices kept
  quiet, so you can find a sound that you do not know.
- Server settings, Storage, shows worktrees and old development folders worth cleaning on this
  computer. A scan lists worktrees that were merged or have not had a commit for a month, and the data
  folders of old development runs, with their size and why they are listed. Moving one to the Trash
  asks first, in a native dialog; a worktree with unsaved changes, unpushed commits or a lock is
  listed with what to do and has no button.
- Marketplace › Apps shows each platform of the Cultura Builder tool catalog, such as Google Ads or
  the app stores, as its own tile in its category (Research, Data & Analytics, Coding, Design or
  Other), with the status of the connection. A tile opens the page of the tool catalog. The tiles show
  only while your organization has the catalog on for you.
- The page of a connection that your organization turned on, but that Builders Bot may not spend yet,
  has "Open the Hub": it opens the connections page of the Cultura Builder Hub, where you allow it.
  Then select Refresh.
- Settings > General > Advanced optimizations (beta) has a switch for each optimization of how agents
  run, with what it changes and its risk, and buttons to turn all of them on or off. Every switch is
  off by default, and the app then works as before.
- Your messages first (beta switch): a message that you write can use one more place than the cap on
  agents, and when memory is low one message of yours can start on an agent whose session is open.
- Free idle agents when memory is low (beta switch): when memory becomes low, agent sessions that did
  nothing for 2 minutes close. Before, they closed only when memory was critical.
- Task reviewer waits after sleep (beta switch): after the computer wakes, the task reviewer waits two
  looks before it acts, so a run that was quiet only because the computer slept is not restarted.
- Offer WhatsApp in the Marketplace. The plugin links the user's own account as a
  device with a pairing code, like WhatsApp Web, and gives agents 23 tools to
  read, search and send messages without the official Cloud API or an API key.
- Sweep a light band across the title of a chat while a turn runs, in the sidebar row and in the
  header, so the work shows on the title itself. It stops with the turn and stays still for a
  reduced-motion preference.
- The menus that choose an agent have a search field and filters. Type part of a name: case and
  accents do not count. Select a provider, such as Claude, ChatGPT or Builders, and then one of its
  models, to show only those agents. Each agent shows the mark of its provider and its model. Enter
  chooses the first match, and the arrow keys move in the list. These menus are Settings >
  Notifications > Choose for one agent, the agent of a new task, Create routine in an empty
  calendar, and Reassign on a stopped channel task.
- Each stopped row of Settings › Load says what the app does next and when, such as "The task
  reviewer resumes it in 6 min", "Resume by itself waits: the agent waits for you" or "Needs you".
- The Task reviewer page of Settings shows why it waits for each task that it watches, and its last
  20 actions, which stay after a restart.
- An owner or admin can change the folders of an agent from the mobile app: add, remove, exclude
  and include again. The host checks each folder as the desktop folder picker does. A change on the
  phone or on the desktop shows on the other device at once. The computer that runs the agents needs
  this version.
- The phone connection can now receive a transfer file of up to 100 MB from a server, so the mobile app can export a server. Other files that the app downloads keep the 10 MB limit.
- An owner or admin of a joined server can now turn "Show the plan before long tasks" on or off for
  the server's agents, in the agent settings on desktop and in the web client. Before, only the
  computer that runs the agent could change it. The server must run this version.
- A phone that runs the new mobile app now gets the time at which the plan card starts by itself,
  so it can show the countdown and say when nobody answered in time.
- The owner of a server can change its server key from the mobile app. The server on your computer
  makes the new key and signs the change with the current key and the new key, so paired devices
  stay paired. Update Builders Bot on the server computer to use it.
- **Server settings → General → Server key** shows when the server last changed its key. Every member
  sees it. Only a change that the previous key and the new key both signed shows.
- An owner or admin of a joined server can now turn **Agent starts new chats** on or off for an agent from the mobile app. The computer that runs the agent must have this version. A change on the phone shows at once in the agent settings on the computer, and a change on the computer shows at once on the phone.
- You can branch a conversation with an agent. On the last agent message of a turn, select the branch button, or right-click the message and select **Branch from here**. A new thread of the same agent opens with the conversation up to that message, and its message box is ready for you to type a different direction. The original thread does not change. A line at the top of the new messages shows the thread that you branched from; select it to go back to that message. Files in the agent's workspace are not copied or rolled back. Joined servers and the web app can branch when the server has this version.
- An agent can now answer a website's alert or confirmation that its own browser action opened.
  Before, the dialog stopped the agent until you answered it. A dialog that you open, or one that is
  still open when the agent's turn ends, stays for you to answer.
- Agent settings have an Instructions page that shows the agent's `AGENTS.md` file as formatted
  text, with the file name and its folder at the top. Edit opens the whole file on the page, and
  Show in Finder shows the file. The agent keeps its standing rules in this file, as short
  bullets under headings, and changes the file when you ask it to change its instructions. A
  workspace that has only a `CLAUDE.md` file keeps that file. Each provider gets the file, also a
  provider that does not read it by itself.
- When the agent changes its instructions, the chat shows "Updated its instructions" after its
  answer. View opens the instructions, and Undo puts back the text from before the change.
- Send the internet traffic of a server's agents through an HTTP proxy, such as a residential proxy
  in Brazil. Server settings › Network egress (owner or admin only) takes one pasted line
  (`host:port:user:password` or `http://user:password@host:port`), a bypass list that keeps sign-in,
  the account service, Signal and the Tailscale network direct, and an expected country. The
  embedded browser, the shared Playwright browser, the provider CLIs (the Codex app-server and
  Cultura Builder too) with their titles, reviews and routing, the tools and MCP servers that agents
  start, the WhatsApp accounts panel, and the MCP requests that Builders Bot sends for the agents use
  the proxy. Sign-ins and the app's own services stay direct. **Test proxy** shows the IP
  address, city and country. When the proxy fails, or the country is not the expected one, pages and
  tools stop with a clear message: Builders Bot never falls back to a direct connection. A change of
  the switch starts the agent processes again after their current turn. The password is encrypted on
  the server and is never shown again, written to a log or put in a process environment; a change of
  host, port or user asks for it again. **Use as default for new servers** gives the same proxy to
  each server that the app makes later.
- Each message in the queue above the composer has "Force now" (bolt icon). It stops the agent that
  works now, as Stop does, puts the message in the conversation and starts the same agent again with
  it, before the other queued messages. In a channel, only that agent stops. If the turn ends by
  itself first, the message starts once, with no stop. If the stop fails, the message stays in the
  queue and you see why. When other work of the agent must go first, such as channel work or a
  context compaction, nothing is stopped: the message moves to the head of the queue, marked "Up
  next", and the queue says why. Screen readers hear the result of each force.
- Before a force, a question explains that other agents that depend on the stopped work can get out
  of sync. "Don't ask me about this again" stops the question on this device and browser; "Ask before
  forcing a message" in Settings › General turns it on again.
- A joined server forces through the new `queue-force-v1` capability. A server that does not have it
  shows the button turned off, with a tooltip that says to update the server.
- Add the task reviewer, an experimental helper in the load panel that is off by default. While
  Resume by itself is on, it looks for channel tasks that are parked too long: a run that gives no
  sign for a long time while it holds a place, a request that the queue would start now but that
  did not start, and a start that the provider fails again. A request that waits for a dependency,
  a full tab, a browser or a busy agent is not touched, and a long command with no output gets more
  time. It acts on one task at a time: it gives the task more time, resumes it, gives it to a free
  agent of the channel (the same model first, when you allow it), or stops it and says so. It never
  touches a task that you stopped. It uses the tries of
  Resume by itself, so a task cannot loop. Set when a task counts as stopped (15 minutes with no
  sign by default). For a task that is only slow, it can ask the model of the Guard, with a short
  summary that has secrets masked; with no model, its local rules decide. Its actions show in
  "Lately", and a run with no sign shows its minutes.
- A Team button in the page rail opens the Team panel over the right side of the window. Each
  channel with work shows as a small solar system: its lead in the middle, and its members around
  it. A working agent orbits fast with sparks, an agent that writes a message pulses, a waiting
  agent dims, a stopped task flickers red, and an agent whose last turn failed shows a still red
  dot. A small mark beside each agent shows its model, and the marks at the top show the models
  that generate now and filter the panel by model. Click a channel name to open the channel, or an
  agent to see what it does and go to its channel. The motion stops while the panel is closed or
  the window is hidden, and with reduced motion.
- Agents can use paid data connections of Cultura Builder, such as the tool catalog (SEO and
  keyword data, company data, web search, app store and review data), through two tools that they
  find with `tool_search`: `buildersbot_connections.list` and `buildersbot_connections.call`. The key of each
  vendor stays in the Cultura Builder Hub; Builders Bot and its agents never get it. The tools are
  there only when you are signed in to Cultura Builder, your organization gives the connection, and
  the turn comes from you, from one of your routines, or from an agent that your turn started. A
  turn that a team member, a channel or a chat app started never gets them, also through a task, a
  routine, a new agent or a message to another agent that the turn makes. An agent that such a turn
  creates has every connection off until you turn them on.
- A routine that you saved before this version uses no connection until you save it again in
  Routines.
- A call that costs more than your organization's approval limit shows a card with the cost and
  the organization that pays. Only you can allow it, once. A routine cannot approve a cost.
- When you have more than one organization, a card asks which one pays. If that organization
  removes you, Builders Bot asks again and never moves the cost to another organization by itself.
- Builders Bot refuses, before anything leaves the computer, a call input that holds a key, a
  token, a cookie or a session, or a URL of a private, local or Tailscale address.
- The Guard reads every connection input and result. It stops a cookie, a session or a sign-in
  token before it leaves, with no way to allow it. It asks you before a long free text or a long
  block of data in one field leaves, and it puts a note in front of a result that asks the agent to
  install a tool, run a script, sign up, top up a balance, star a project or use the vendor first.
- The first lookup of data about people in a conversation shows a card with the names and the
  addresses that it sends. A routine never makes such a lookup. A result with emails or phone
  numbers tells the agent that they are unverified guesses.
- If treg's installer put a treg connection of your own in the MCP files of Codex, OpenCode, Cursor
  or Claude Code, Builders Bot turns it off inside its Codex, OpenCode, Cultura Builder and Claude
  Code agents, also when Codex cannot read its own config. For a Cursor agent, Builders Bot adds
  its names to the Cursor CLI's list of turned-off servers of the agent's project. Settings › General
  tells you that its token is in plain text, which files hold it, which agents (Grok, custom agents)
  can still use it, and that you should remove it and rotate the token.
- Marketplace › Apps has a Connections group with the paid connections of Cultura Builder, such as
  the tool catalog. The curated list hides a connection that you do not use, unless your
  organization's profile names it; the search and a link always reach it. Its page shows what it
  gives, the categories that your organization allows, your monthly limit with the 80 % mark, who
  pays (you can choose), a switch per agent, and where the data goes ("Provided by treg.to").
  "Ask the admin" and "Ask the admin for more" send a request through Cultura Builder, once in 7
  days.
- Usage shows the charges of the connections, apart from the model estimate, with a breakdown by
  platform, when Cultura Builder turns connection usage on.
- After a paid call, the chat shows what it cost and who paid. The first call over 80 % of your
  limit adds a notice, and a call that the limit stopped adds a line with "Ask the admin for more".
  A charge above the amount that you approved adds a line that tells you to tell an admin.
- When you sign out of Cultura Builder, or another person signs in, the payer that you chose, the
  lookups about people that you allowed and your use are forgotten.
- Settings > Voice shows the microphone permission of macOS or Windows: allowed, not allowed,
  blocked by the administrator, or (on macOS) not asked yet. On macOS it gives Ask for access, Open
  System Settings and Restart Builders Bot; on Windows it gives Open Windows Settings. It says that
  commands that agents run can also use the microphone.
- Settings > General warns when Builders Bot cannot decrypt saved data on this computer, which
  happens when the keychain changes or a profile is copied from another app. It lists the ElevenLabs
  key, the voice server key, custom agent values, custom provider credentials, provider API keys,
  messaging tokens and the network egress proxy that cannot be read, with the file name and what to
  do for each.
- The WhatsApp plugin page shows the WhatsApp accounts when the plugin is installed. Each account is
  one number with a nickname, such as "WhatsApp of Ana" or "Company", and shows the last digits of
  its number, its state and its message count. "Add account" takes a nickname and a number with a
  country, and links it with a pairing code or a QR code. The code shows large, with a countdown and
  the steps on the phone. The menu of each account unlinks it, turns it on or off, sets it as the
  default, makes it read only and removes it. Unlink, turn off and remove ask first, and remove says
  that the history of that account is deleted.
- Agents with the WhatsApp plugin pick the account by the nickname that you say, and ask when two
  or more accounts can fit. They do not invent a phone number, and they do not link a number into
  an account that existed before.
- A channel can show its agents on a stage above the conversation. Each agent that works
  appears with its provider logo, its model family and what it does now. The stage folds into a
  thin strip when nobody works. Turn it on with the flag at the bottom of the section column, for
  this channel or for all channels.
- Closing a channel tab asks how it ended. The Profile shows the closed tabs by outcome and period, and can continue one in a new tab.
- Add a ⚡ button as the first button of the main rail. It opens a new Quick chat. Quick chat talks
  with one agent. It is not a channel.
- Quick chat saves its conversations. Search them by title, first message, or last message. Archive
  a conversation to hide it. Archived conversations have their own group.
- Mention another agent with `@` in a Quick chat message. That agent takes over the conversation.
- The model you choose in Quick chat becomes the default for the next conversation. The first
  default is Cultura Builder · Builder Fast.
- Voice in Quick chat: dictate a message, read a reply aloud, and hear the reply after you dictate.
- The Quick chat agent does not appear in agent lists or in the Team API.
- In a Quick chat conversation, a message that you send while the agent works now waits in a visible
  queue. Send it to the running turn, delete it, or drag it up or down to set its priority.
- When the Quick chat calls other agents, a strip at the top of the conversation shows them at work:
  their characters, what each one does now, and how many are done. Unfold it to see the same stage as
  in a channel, with the Quick chat at the head of the table. When the last agent is done, the strip
  says so for a moment and goes.
- Quick chat folders and filters. Create folders, drag conversations into them, and filter the list
  by running, newest created or newest finished.
- Each Quick chat conversation has its own model. Choose a model in one conversation, and the other
  conversations keep theirs. A new conversation starts with the model of the last conversation you
  used. A model change applies from your next message in that conversation. It does not stop a reply
  that is already running, and it does not change the other conversations.
- An older version of Builders Bot ignores the model of each conversation. It runs every Quick chat
  conversation on the model of the Quick chat agent.
- Add a button at the top of the agent stage of a channel that folds the animation for that
  channel. Unfold it from the same place. The choice stays on this computer.
- Add "Force now" to the messages that wait in a quick chat conversation. It stops
  the turn that runs in that thread and starts the message next, alone, with the same question and the
  same "Don’t ask me about this again" choice as the chat. It works with every provider, also those that cannot
  steer a running turn, such as Cultura Builder. A turn in another conversation keeps running.
  Only this computer can do it: the Team API still forces only the messages of an agent's own chat.
- Prompt presets. Save the prompts that you use often in Settings › General › Prompt presets. There
  is no limit on how many you add. Each preset has a name, a prompt, and keys that you can set. The
  + menu of the message box lists your presets: choose one to add its prompt to your message. A
  preset with keys adds its prompt when you press them while you type.
- Swipe a Quick chat conversation to the left to show the Tag and Archive buttons. Right click on a conversation opens the same menu as the "..." button.
- Give a Quick chat conversation a tag with a name and a color. The tag shows before the bolt, and you can change or delete it from the menu.
- ⌘T (Ctrl+T on Windows and Linux) opens a new tab in the Quick chat and in channels, as it does in the full browser view.
- The agents on the channel stage now show what they do with the effects of the approved design:
  thought puffs while they think, code signs rising while they edit, an orbit with a terminal while
  they run a command, a page that is read while they read, sparks when they finish and a question
  mark when they wait for you. The symbol on the lid of the cube moves too. Nothing moves with
  reduced motion or while the stage is off screen.
- Let a prompt shortcut send the message as soon as you choose it. Turn on "Send on click" for a shortcut in Settings, and one click in the "+" menu, or its keys, sends the message with no second click on Send.
- Find a tool of the Cultura Builder store while you write: type `$` and a few letters (such as
  `$empresa`) and the picker lists matching store tools with the most one call can cost. Choosing one
  writes its name and id in the message, and the agent describes it, tells you the price, and runs it
  only after you agree. The "+" menu has a "Store tool" item that opens the same picker.
- The "+" menu and the `$` picker of a channel now offer skills and store tools, as a chat does. Skills
  come from the agent you tag with `@` (or the channel's only agent). The store works in a channel while
  only you write in the channels; a channel with a team member keeps it closed.
- A store tool you choose shows as a chip in the message box, and a `/` at the start of a message
  opens the store's tools directly.
- Advanced optimization "Quick status when an agent is busy" (Settings > General > Advanced
  optimizations, off by default). When an agent has worked on one turn for 5 minutes or more and you
  write again, in its chat, a task or a channel, a second fast generation writes a short note about
  what the agent does now. The turn and your message do not change. The app writes each decision and
  outcome to its log, with no text, so that you can follow how it behaves.
- Pick many chats in the sidebar list with ⌘/Ctrl-click, or a range with Shift-click. A bar at the bottom of the list moves them all to a section, starts a new section with them, or hides the agents. Right click on a picked row opens the same actions, and dragging one picked row moves them all. Escape or a plain click ends the pick.
- The tab list of a channel in the sidebar ends with a "New tab" item, so a new tab opens without going to the top of the channel.
- Close a tab with ⌘W (Ctrl+W on Windows and Linux) in an agent chat and in a channel, as in other
  browsers. A channel tab that asks first shows its dialog with Done chosen and the close button
  focused; ⌘W again closes the tab. On a Mac, Close window moves to ⇧⌘W.
- On the stage of a channel, while an agent works, a thin laser crosses the table slowly, from the back to the
  front, then rests and crosses back. The squares that the laser passes glow a little and fade behind it.
  It runs only while an agent reads, thinks, edits, runs or delegates, and the table goes quiet in 1.5 seconds
  when the work stops. With "reduce motion" on, the table stays still. The Feed tables do not change.
- A site whose hosting is paused now shows a maintenance page instead of the generic error. It says
  the site comes back, reloads itself after a minute, and keeps the motion off when the reader asks
  the system to reduce it.
- The Guard levels Strict, Very strict and Custom can now be chosen in Settings. Before, they showed
  "Soon". Custom has three switches: how a suspicious content and a suspicious action are handled, and
  whether the model can release a suspicious item.
- On a joined server, including a server on this computer, the sidebar now has the same section tools as
  on the local server: section color, section icon, markers, and reordering the sections in the section
  rail. The host sends them through the new optional `sidebar-style-v1` capability. A server that does
  not have it keeps the old sidebar, and the released sidebar routes do not change.
- Channel tabs now work on a joined server, also on a server on this computer that the app reaches over
  the network. You can create, rename, switch and close tabs, and each tab keeps its own messages,
  tasks, unread count and read mark. Before, a joined channel had only its first tab, and a message
  you wrote always went there.
- On a joined server, only an admin can close a tab, because closing it deletes its messages and its
  work. Any member can create and rename a tab.
- A server that does not have this feature yet shows one conversation for each channel, as before.
  Update the server to get the tabs.

### Changed

- The web app, also on a phone, signs in with Cultura Builder: select Sign in with Cultura Builder,
  approve the code on the Cultura Builder Hub, and go back to the app. The web app no longer sends a
  sign-in code by email.
- Settings > Mobile Connect > Add phone shows only the address of the web app,
  buildersbot.culturabuilder.com/app, as a QR code and a link. The steps tell you to sign in there
  with Cultura Builder.
- `buildersbot mobile-connect` on a server with no screen shows the address of the web app and its QR
  code.
- The iPhone and Android download pages name buildersbot.culturabuilder.com/app and the Cultura
  Builder sign-in. The Linux page no longer gives a command that installed the upstream Builders Bot
  server.
- A server invitation and its QR code are a buildersbot.culturabuilder.com/join link, which a phone
  camera opens in the web app. An invitation can also go by email.
- The link to share an agent is a buildersbot.culturabuilder.com/agents page.
- The desktop download buttons of the website say that the installer is not published there yet,
  in place of the upstream Builders Bot installer.
- The plan step of first run no longer has the "Start free instead" button. The free path stays on the
  first question of first run, and you can set up another provider later in Settings.
- Builders Bot sends no usage analytics and no error reports from the desktop app, the browser client
  or the website. Before, they went with your account ID and email to the analytics service of the
  Builders Bot project, which Builders Bot does not control.
- First run and the web sign-in no longer show the "Help make Builders Bot better" box.
- Settings → General → Permissions shows a note in place of the "Share product analytics" switch. The
  old text said that the analytics service was hosted by Builders Bot. That was not true.
- The account service sends no account, billing or email events to an analytics service, and its
  deployment needs no OpenPanel secrets. The Signal capacity report has no default address.
- `bun run dev --hosting=test` stops with an error. It signed the development app in to a test Worker of
  the Builders Bot project.
- On start, the desktop app deletes the failure report queues and the inventory file that earlier versions
  kept for that analytics service, so an earlier version that opens the same profile cannot send them.
- The privacy policy at `/privacy` and the compare pages no longer say that Builders Bot has a self-hosted
  analytics service, that analytics are on by default, or that the apps have an analytics setting.
- `bun run hosting:setup` registers the Stripe and boat webhooks at the Builders Bot account service, and
  `--target=test` needs `--api`. Before, it used the account API and the test Worker of the Builders Bot project.
- The package scripts and the package checks stop a build whose code or `app.asar` names the analytics
  service or an OpenPanel client of the Builders Bot project, and a workflow runs the same check on each push
  to `builders-bot`.
- Builders Bot does not check for app updates in this version. Settings → Updates says "Updates are
  not available in this version of Builders Bot yet." Before, a build with an update file read the
  release feed of the Builders Bot project and could download and install an Builders Bot release over
  Builders Bot.
- A hosted or self-installed Linux server and the Servers panel no longer ask for releases.
  `sudo buildersbot update` says that updates are not available, and the server install script stops
  before it downloads anything.
- When a server cannot update itself, Server Settings asks the host administrator for a compatible
  Builders Bot release. Before, it named the release page of the Builders Bot project. While there is no
  release feed, every server shows this text: before, a hosted, self-installed, container or shared
  Mac server said that the host installs updates.
- Container servers need an image that you built from `docker/Dockerfile` (`BUILDERSBOT_IMAGE`) and
  never pull one. `buildersbot-instance upgrade` and updates from the app are not available. Before,
  they pulled the image of the Builders Bot project.
- The Nix package is not available in this version. Before, it installed the Builders Bot release.
- The macOS Host Manager of shared Macs finds no release and installs nothing. Before, it could
  download the Builders Bot release.
- The small faces of a channel move when their agent works: in the channel row of the sidebar, in
  the channel header and in the faces of an agent message. Only the members that work move. When
  the app cannot tell who works, every face of the busy channel moves. Very small faces show the
  work with a light on the edge and on the lid, without the points of light around the box.
- The desktop app opens with the agent box, in the color of the logo, at work until the app is
  ready.
- On the first screen of the app, the eyes of the agents follow the pointer.
- The agent avatar has a new look. The whole box has the agent's color. Its left side has two eyes
  that look around and blink, and its right side shows an emblem of the agent's role, which comes
  from the agent's title. The lid shows what the agent does: arrows while it works, a ring while it
  waits for you, and an × when it fails, with the eyes shut. While an agent works, its eyes open
  wider and points of light circle the box. When its chat is open, the avatar moves faster and the
  lid shows an equalizer. In the sidebar, the eyes of an agent at rest move only when you point at
  it. With a reduced-motion preference the avatar stays still.
- The task reviewer acts on a failed start after 5 minutes (with "slow after" at 5), then after 10,
  20 and 30, and follows the task until it starts: a resume, then a reassign to a free agent and a
  resume by turns, at most 6 actions (about 2 hours). Before, it waited 10 minutes each time and stopped
  after 2 resumes and 2 reassigns. It waits while the app tries a start again.
- The summary of a long channel history runs at the lowest reasoning level of the lead's model, and
  one at a time for each tab. Before, it ran at the lead's own level (such as Max), and two starts in
  one tab made the same summary, so a long channel often failed with "Profile generation timed out".
- Each tab of a channel is now its own line of work for each agent. A message in one tab no longer
  waits for the work of the same agent in another tab: it waits only for the earlier messages of its
  own tab. The tabs of one agent run at the same time up to a limit, 2 by default.
- Settings > Load and the load panel have "Channel tabs of one agent at the same time" (1 to 4). With
  1, an agent works in one tab at a time, as before.
- A tab whose turn waits for your answer, your approval or a browser takeover does not take a place
  among the agent's tabs. A tab whose task waits for other members did not take one before either.
- A tab whose request waits for a new start try, after the provider did not start it, does not take
  a place among the agent's tabs either. Its retry and its move to a backup model stay in its own tab.
- A message that waits in a channel tab shows why: the earlier message of the tab, the agent's limit
  of tabs, low memory, or a message of the agent's own chat that came first.
- The queue of the agent's own chat names the channel tab that holds the agent, and how many tabs
  hold it.
- While the computer is low on memory, an agent that works opens no second tab. The tab starts when
  memory is free.
- An app that has no signature that the program can check, such as an unsigned package, keeps "Let
  agents use my Chrome" off and says why in its log.
- First-run setup now starts with Cultura Builder. "Use Cultura Builder" is the first choice, and the
  provider list shows Cultura Builder as its first row and selects it. A new agent then starts on the
  normal Cultura Builder model. The button names the provider that it connects, for example
  "Connect Cultura Builder". The other providers stay in the same list and in "More providers", and
  you can change the provider at any time in Settings.
- Settings, Guard also says when the Guard asks you, what leaves the computer, and what its log
  keeps, and links to the Task reviewer page, to the load panel, and to the security review of
  messages, which is a separate check. The settings search finds these parts.
- While the window shows a joined server, the Guard and Task reviewer pages say that they change only
  this computer: the joined server has its own Guard and task reviewer.
- The load panel shows the switch of the task reviewer also while Resume by itself is off.
- The Task reviewer page says that Resume by itself also starts again the tasks that you stopped.
- The load panel and Settings use one reading of the load, so a switch changed in one shows in the
  other at once.
- In Portuguese, the task reviewer is named "Fiscal" in the load panel too.
- The model list of Settings › Guard opens next to its trigger and closes with Escape, with a click
  outside and after a choice. Before, it opened at the top of the window, could not close, and the
  window stopped responding.
- A select list is no higher than the space between its trigger and the edge of the window, and
  scrolls.
- The Routines view of an agent with no routine has a new design. Your first four agents stand in a
  row, and a small wave passes through them, above the title "Leave the routine to the agents." and a
  line of sample routines. "Create Routine" opens the settings of a new routine, as before. Before,
  the view showed a faint sample diagram that built itself behind the text.
- A new link, "Ask an agent to create it", opens the chat over the canvas with the request "Create a
  routine for me:" in the message field, so you only add what the routine must do. A message that you
  already started in that field stays.
- Agents share one Playwright connection to your browser. No Chrome starts for each agent, so many
  agents at once no longer use all the memory of the computer.
- Many agents can use the browser at the same time. Each agent can keep 4 tabs open, and all
  agents together 12. When an agent asks for one more tab, the browser refuses it and tells the
  agent to close a tab first.
- A turn in a channel, a task thread or a routine, such as the work that the task reviewer resumes,
  plays its own "Channel and team work finished" or "Routine run finished" sound, which you can turn
  off without losing the sound of replies to your own messages.
- While you dictate or talk with an agent by voice, the other app sounds stay quiet.
- The "task sound" and "Action sounds" menus moved into the Sounds section. Your choices move with
  them.
- A new tab is named by the channel model from the first request, with two or three words that say
  what was asked, in place of the cut first line. The cut first line still appears at once as a
  placeholder, and a manual rename wins over the model.
- You approve the cost of an expensive tool catalog call on the Cultura Builder Hub. Allow on the card
  opens the approval page in your browser, and the call runs once after you approve it there. Deny on
  the Hub, or no answer in 5 minutes, sends nothing.
- The local trace of the app (`trace.ndjson`, in the diagnostics export) records how long each step of
  a turn start takes, such as the security review, the prompt scan and the start of the provider
  turn. It records names, times and status words only, never a message.
- The Model section of the "New agent" dialog is easier to use. The providers that can run show by
  name, the models of the chosen provider show as a short list with a check, and the reasoning level
  is a row of segments with the model's default under it. The providers to download or to sign in to
  are under "Other providers", each with its Download or Connect button. The Model row shows the
  provider, the model and the reasoning level.
- When a provider no longer lists the model of an agent, the Model section of the agent shows that
  model as chosen, with "Not listed". A provider that is not downloaded says "Not downloaded" and
  tells you to download it.
- The tabs of each project are in one tab group with the project's name: the sidebar section of the
  agent, else the agent. Up to 3 projects get a group of their own; the others use the
  "Builders Bot" group.
- Agents are told to open each page in their current tab, and to open a second tab only when they
  need two pages at the same time.
- After 10 minutes with no agent, a group is put away: its blank tabs close, and tabs with a page
  stay open.
- The member list of a channel shows the mark of each member's provider after its name. Hover the
  mark to see the model and its reasoning. You can see which models a channel has at a glance.
- Remove in the member list is an icon button with a tooltip, the same size as the other row
  actions. Before, it was a red text button.
- The arc of the load ring shows the agents that run, and ten agents close the circle. The memory now
  sets the colour of the ring, and the tooltip and the panel still show it.
- Add phone in Settings > Mobile Connect installs the web app on the phone. Its QR code opens the web
  app of your account, and the iPhone and Android tabs show how to add it to the Home Screen from
  Safari or Chrome. Then you sign in on the phone with the email of your account.
- The sidebar card for phones and the iPhone and Android pages of the website now explain how to
  install the web app from the browser of the phone.
- On a phone, an invitation page opens the invitation in the web app.
- The resource log (`logs/resources.ndjson`) now records the memory level of the Mac, and for each
  provider the number of MCP processes, folders and sessions. This helps to find the cause of a
  memory problem.
- Pinned chats at the top of the sidebar show the avatar and the name in the middle of the tile, with
  space on each side. The title is no longer a small label in the tile: point at a tile, or move the
  focus to it, to see the full name and the title.
- The column of sections shows only on Agents, Routines, Workflows and Schedule, and it keeps the
  same section on the four pages. Workflows shows the workflows with an agent of that section, and
  Schedule shows the routines of the agents and channels of that section.
- The plus button and Rename in the column of sections open a dialog for the section name. A new
  section is selected at once.
- Send an attached MP3 file to an agent as audio when its provider accepts audio input, such as
  Antigravity. The agent hears the file and still gets its path. Audio over about 14 MB a message
  goes as a path only, as before.
- Show a browser profile change made on another device at once in the desktop and web Browser
  profiles settings and in the agent settings. A host that runs this version tells each client
  about each change.
- A chat shows one schedule card for each routine: the newest change by the agent. Earlier changes show as one line that opens the routine.
- When you pay for a plan or a license, the account service sets your account email on your
  analytics profile, also when product analytics is off on your devices. See `PRIVACY.md`.
- Remote connections that need a relay server now spread over two relay servers. When one relay
  server is full or stops, new connections use the other one.
- Remote access now uses two connection servers at the same time. Each server and its devices meet on
  one of them. When that connection server stops, the server and its devices move to the other one
  automatically.
- When a tab or the thread menu cuts a long thread title, a number at its end, such as **#2**, stays visible.
- The reaction button below a message now has the same hover color as the copy and reply buttons.
- Show the Builders Bot server offer at the bottom of the Routines panel, below the routine list, with
  its buttons on the right. Before, it was above the routines.
- Show each routine in the agent's Routines list as its own card, with a switch at the end that
  pauses or resumes it. The Pause and Resume buttons are gone.
- Memories now open in the settings pane of an agent or a channel, not in a dialog. The list shows a short title for each memory, in "Always used" and "Used when relevant" groups. A title opens the memory on its own page, where you read, edit or delete it, and where a "Use in every chat" switch sets whether the agent always uses it. A search field above the list finds memories by their words.
- Agents now start a long memory with a short label, such as "Release notes:", so the list shows a clear title.
- The old Instructions field is now Description: a short summary that teammates read to choose who
  does a task.
- Settings > Notifications shows one card for each server, with All, Needs me and Nothing as one
  control. Only the agents that have their own level show under their server. "Choose another
  agent" gives one more agent its own level, and the X button gives it the server level again.
- An agent that a member turned off for everyone in an earlier version turns on again when you give
  it its own level. Settings no longer shows "Off for everyone on this server".
- Marketplace › Apps shows a short list first: GitHub; Slack, Telegram, WhatsApp, Trello, Obsidian,
  Notion, Atlassian, Apple apps, Discord and 1Password; Context7; and Playwright. Turn on "Show all
  apps" beside the search to see the other apps. The app keeps the choice. The search and a link
  still find every app, and an app that you installed or connected always stays in the list.
- A category with no app in the short list, such as Design or Data & Analytics, is not shown until
  you turn on "Show all apps".
- Builders Bot uses less CPU and battery when it is idle. The main process wakes up 10 times a second
  to measure its own delays, not 50 times. The Computer Use outline asks the driver once a second
  while no agent uses the desktop, not 30 times a second, and still shows at the first action of an
  agent.
- The idle Dynamic Island blinks its logo from a timer, and draws no frames between two blinks.
- A working agent's avatar stops moving while it is out of sight, such as in a collapsed sidebar
  section or below the end of the sidebar. A collapsed section also stops the shimmer, the dots and
  the breathing of its rows.
- A browser preview card captures a page that does not change less often: the wait grows from 3 to
  12 seconds, and goes back to 3 seconds when the page changes. While the agent works, and after a
  new page title, the card asks every 3 seconds, as before.
- While a reply streams in a channel that is not open, Builders Bot reads only the channel list, not
  the open channel's page again.
- Each window of Builders Bot loads only English and Portuguese at start. Another language loads the
  first time that a window shows it. Each window uses less memory.
- Builders Bot keeps the inline images of agent messages in memory only for the open conversation.
  A chat that you open again reads its images again.
- The code of each Builders Bot window is smaller, so a window opens sooner and uses less memory.
- On a Mac, the main window shows its content sooner after a launch. The Dynamic Island opens after
  the main window.
- Builders Bot uses about 230 MB less disk space. It no longer holds a second copy of the packages
  that only the window code uses.
- A task plan that changes many times in a turn no longer keeps a copy of each change in the
  database.
- A message that you send to an agent starts sooner when the security reviewer is on. The reviewer,
  channel routing and side questions now use the provider process that stays ready for short
  generations. Before, each of them started a new provider process and the turn waited for it.
- While your Mac is low on memory, Builders Bot stops a provider process, with its MCP servers, 1 to 2
  minutes after its last turn. Before, an idle process stayed for 10 minutes. The next message starts
  it again, which takes some seconds more, and more when agents have MCP servers for each folder.
  Work that stays in that process after its turn stops too: Codex background terminals, programs
  that an OpenCode command left running, and MCP servers for each folder. Claude keeps its process
  while a background agent runs. Servers do not get this change.
- Cultura Builder sessions are compacted near 262K tokens on every model. Before, Builder Auto, Builder
  Code and Builder Fast sent up to 1M tokens again on each step of a long conversation. To keep the 1M
  window, turn on "Use the full 1M context of Cultura Builder" in Settings › General.
- The provider step of a server shows Builders first, marked "Recommended", then the accounts that
  are connected. Builders is the choice while no other provider is connected, and an account that
  connects while the step is open takes its place, unless the user chose a row. A provider whose CLI
  is too old is now in "More providers", with one short line on its row when the row can download or
  update it. Pi and the key providers that run in it are rows only when they are connected or chosen.
  The key providers that wait for a newer Pi share one notice with one "Update Pi" button. The text
  under the title now says that Builders is free.
- When Builders is not installed and another row is selected, setup suggests it, installs it with its
  progress, and offers a retry with the reason when the install fails. With Builders selected, the
  main button downloads it.
- First run and the server step use the same label for the main button.
- Only an administrator, or a person whom an administrator gives permission, can create a new
  remote server. Each person can still join a server with an invite or add their own computer.
  The join dialog shows "Ask for permission" to a person without it, and administrators approve or
  deny the requests in Settings > Profile. Servers that exist do not change. When this deployment
  cannot create remote servers, the apps show nothing about it. The administrator section needs a
  Cultura Builder sign-in. A revoke closes the payment pages that the person opened before it.
  The mobile app does not show "Ask for permission" yet: a person without the permission asks from
  the desktop app or the web client.
- In the column of sections, a section where agents work now shows a light that goes round the border
  of its icon, in the color of the section. It stops when the work stops. With reduced motion turned
  on, the border stays lit and does not move. The work dot of the icon no longer pulses.
- The text of Settings > Voice > Read replies aloud says that only the reply to a dictated message is
  read by itself, and that Read aloud in the menu of a reply reads any reply. Without the voice, it
  gives the download size.
- The macOS microphone prompt says that commands that agents run from Builders Bot can also use the
  microphone, and that the audio stays on the Mac unless you choose a cloud voice model or your own
  voice server.
- The system dictation of macOS recognizes on the Mac only. Before, when the on-device pass failed
  or the language had no on-device recognition, it sent the audio to the speech server of Apple. Now
  such a language uses the voice model when the dictation engine is Automatic, and says that the
  system cannot recognize it when the engine is System.
- The sign-in screen shows a team of three animated agents at the top, in place of the cube and the
  product name. The middle one follows the pointer. With reduced motion they stay still.
- The menu of the Builders Bot extension for Chrome has a new look, in the colors of the app, dark
  or light as your system is. Each project is a card with its agents, tabs and blocked sites, and
  Stop all stays at the bottom in every state. The welcome page shows the pairing words larger.
- The agent's own chat no longer waits for its channel tabs, and a channel tab no longer waits for
  the chat. When a tab of the same agent has declared a workspace or the browser, the chat turn gets
  a short warning with the channel, the tab and the resources, so the agent knows what is in use.
- Settings > Load has "Agents of one tab at the same time" (1 to 8, 4 by default). It sets how many
  agents of one team channel tab work at the same time. A request for more agents than this number
  waits in the tab, in order, and starts when one of them ends its turn.
- The number of channel tabs one agent works in at the same time follows the free memory by default,
  or a fixed number. Its ceiling is 4 (8 at most), set in Settings > Load. When the memory gets low,
  idle agent sessions are released sooner, and they start again from their saved history with the
  next message.
- Going back to an older version: it does not accept a tab count of 5 to 8 saved by this version, so
  it treats that setting as invalid. No user data is lost.
- Cultura Builder is the first row of provider setup, marked Recommended and chosen by default. It
  applies to first run, to a new server and to a server that you create from inside Builders Bot.
  Each other provider is behind "More options". A server that cannot sign in to Cultura Builder
  keeps its previous rows.
- The channel header shows a small settings gear in place of the three agent faces, and the
  channel name sits next to it. The gear opens the same channel settings panel.
- The Feed page shows one table for each project with an agent at work. The agents at work sit at
  the table, and the ones that finish cheer and leave. Click a table to see only its project, or
  click an agent to see only its runs. When nobody works, the page says so. You can fold the tables
  into a strip, and Builders Bot remembers your choice.
- A Quick chat conversation gets a short title from what was said, after the first answer. Before,
  the title was the start of your first message. A title that you set yourself stays.
- The Quick chat asks Claude for the 1 hour prompt cache and keeps up to six idle conversations open
  apart from other agents' threads, so a message that comes after a pause pays less to read the
  conversation again. The log shows the cache hit rate of its Claude sessions.
- Settings > Profile > Closed tabs shows each closed tab on one line: the outcome, the name, Continue in
  new tab, and Delete. Select the name to show the note and the last result, at most four lines each.
  Select it again to hide them. The date, open time, task counts, and agents of a closed tab no longer
  show.
- The "Waiting - ... answers first" lines and the "Waiting for sub-tasks" block of a channel start
  folded, so the conversation keeps more room. Open them when you want to read them.
- The agent stage of a channel folds in steps: the agents and the table fade out first, then the
  panel folds. It opens the other way round. Before, the agents shrank with the panel.
- The lines that say a message waits for an earlier one are now one small line, "Na fila (N)", that
  opens to show the reason of each.
- When nobody works and "Hide when nobody works" is on, the stage leaves the top of the channel completely, with
  no strip and no text. It comes back when an agent starts to work. A stage that you fold by hand stays a strip.
- The line "Waiting - … answers the earlier message of this tab first" is gone from above the message field.
  The work of the earlier message is already on the screen. A message that waits for the agent's limit of tabs,
  for memory, or for the agent's own chat keeps one quiet line with an icon, which opens to the reasons.
- A channel no longer shows the agent stage when the window is narrower than 1000 px, also when the
  stage is on in the channel settings. The stage comes back when the window is wider again.
- In the Quick chat, when you come back to the page, the conversation that was open opens again. Before, a new
  conversation opened each time. A new conversation with no message, or one that was deleted or archived,
  still opens a new one.
- Show a thin moving bar on the base of a channel tab that has work, in place of the shimmer on its name. Before, the name looked half faded and stopped between two sweeps.
- Hide the "Builders Bot para celular" card in the sidebar for now. Installing the phone app still
  works from Settings.
- The close tab dialog shows the tab's name, its messages, its age and whether agents still work in it,
  above the question "How did it go?". The three answers sit in one segmented control, in place of a
  list of rows.
- The Quick chat list shows only the bolt, not the word "Quick", before the last message.
- Show a contact notice in Settings, Billing. Your account is set up as Enterprise, so the Cultura Builder sales team manages it with you. Before, the tab tried to load billing and could stay on a spinner.
- In Quick chat, the archived conversations now open in a dialog, not in the list. The dialog has a
  search, shows 40 conversations at a time with "Show more", and lets you select many conversations to
  restore or delete them together. Before, a long archive made the whole list slow.
- While an agent of a channel has reported no step yet, the agent stage changes its pose every few
  seconds and the activity line changes its label, so a slow start looks like work in progress.
  The first real step replaces both.
- Move the prompt presets out of the General tab of the settings into a tab of their own, "Prompt
  presets" ("Atalhos de prompt"), so the list has room to grow. The search still finds them.
- On the stage of a channel and in the Feed tables, the label above an agent shows the provider
  logo and the agent's name. The model name shows when you hold the pointer on it. The line under
  the agent keeps only what it does, such as "reading", so the stage has less text.
- On a wide channel stage the agents grow. Up to 1200 px they keep their size. From 1200 px they grow
  steadily, up to 15% bigger at 1600 px, so a big window does not leave small agents on a big
  floor. A short stage does not grow them past what its height holds. The Feed tables do not change.
- On the stage of a channel and in the Feed tables, the speech bubble of an agent and the title of
  the request type in letter by letter, with a blinking caret that goes away a moment after the last
  letter, each time a new line shows. A long line types faster, so it never takes more than about 2
  seconds. With "reduce motion" on, the text shows at once, and a screen reader gets the whole text
  at once.
- In the close tab dialog, the three answers look like buttons, and "Done" is already chosen. To close
  a finished tab, click Close tab; choose another answer only when it did not end well.
- Close idle agent sessions sooner when the computer has plenty of free memory: at most 4 stay open,
  for 5 minutes. Before, 8 stayed open for 10 minutes. The next message to a closed session opens it
  again from its saved session.
- Keep less memory for long chat messages. The cache of rendered text now also has a size limit, so
  a conversation with many long messages no longer holds all of them in the window.
- Click an attachment in the message box to open it in the side panel, the same way as an attachment in a
  sent message. Before, you could not look at it until you sent the message.
- On the stage of a channel, a change of state is now smooth. When the line of a speech bubble
  changes, the bubble closes to a small pill with three dots and opens again with a spring round the
  new line. The status under an agent (for example "thinking" or "reading") and the count of parts
  done on the request roll up like an odometer. The cube wobbles like jelly and a ring spreads from
  it when its activity changes. A bar of the request pops when its part is done. With "reduce
  motion" on, all of this is a plain swap.
- Nothing of the previous project name is left in the product: the app registers only
  `buildersbot://`, a published site resolves only on `culturabuilder.com`, the command line reads
  only `BUILDERSBOT_AUTOMATION_DIR`, the installer no longer removes an installation made under the
  old name, and the account analytics no longer has a subdomain of its own.
- An installation of the previous version starts on a new profile and asks for the sign-in again.
- An agent that ends its turn saying it will continue after something finishes now opens a wait, so
  the chat shows the open wait above the composer instead of silence. With one open wait, the card
  has a "Cancel the wait" button in its header.
- On the stage of a channel, the scan of the table takes the color of the agent that does the work, and the
  laser crosses the table from the seat of that agent (the lead, at the back, gives back to front). When
  another agent takes the work and holds it for 4 seconds, the scan fades out and starts again in the color
  and the way of that agent. The lead keeps the scan while it works itself; when it only delegates, the
  agent that works has it.

### Removed

- The permanent link and the one-time Mobile Connect code. They put an buildersbot:// link with a
  sign-in secret in a QR code, for the earlier phone app. A phone that signed in with one stays
  signed in until you disconnect it.
- The App Store and Google Play QR codes and links in the desktop app and on the website. Builders
  Bot on a phone is the web app only.
- The Team list is gone from the rail and from the Feed page. Use the table of each project or the
  agent filter instead.

### Fixed

- The Cultura Builder sign-in screen shows why a sign-in could not start. Before, it showed nothing.
- An approval on the Hub is no longer lost when many people sign in from one network, or when the
  code was already used: the screen asks for a new code at once.
- When a phone reloads the web app while you approve on the Hub, the sign-in continues.
- Two tabs, or a tab and the installed web app, can each wait for their own code.
- The web app no longer opens the upstream changelog, guides, Discord or feedback pages.
- "Keep this computer awake" now tells you that it stops only the sleep of an idle computer. Before,
  it did not say that the Mac still sleeps when you close the lid.
- The web app on a phone can sign in again. Before, the browser refused the sign-in request before
  it sent it, because the name of a request header had a space in it, and no code came.
- A computer passes the requests of a phone to its server again, and the live view of the agent
  browser opens on the phone. Before, each phone request failed on the computer.
- Remote desktop, the upload of the server logo and site publishing send valid header names again.
- The web app tells you where to publish the computer. Before, it asked you to "turn on remote
  access", which is not the name of a setting.
- The web app starts offline with its offline page. Before, the browser could show a network error.
- The web app on a phone shows the name Builders Bot under its icon and in its notifications.
- The web app shows its notifications in Chrome on Android and as an installed app on a phone, while
  the app is open in the background. Before, the browser refused them and nothing showed. A click
  on such a notification opens the agent or the channel.
- Mobile Connect tells a published server that is offline now, such as after sleep, from a server
  that is not published. It shows the cause and Try again. Before, it said "This server is not
  published" in both cases, and also while the server was connecting.
- Mobile Connect says that a phone reaches the computer only while the computer is on and awake, and
  names the settings that keep it awake.
- Mobile Connect says where a phone with the web app is: Profile > Account sessions. Before, the
  phone list stayed empty, and the phone seemed not to be paired.
- The settings search finds Publish this server with "publish" and "remote access".
- **Install this version on the computer that phones connect to.**
- Settings search finds every setting again: Theme, Transparent window, Security review of messages,
  the dictation settings, Voice server and the security check of the Agents tab. Before, these rows
  had no search entry.
- Settings search finds the sections of the server settings, such as Vault, Roles, MCP, Storage and
  Updates, and the rows of General, such as Timezone and Memories per agent. A result opens the
  section and moves to the row. The server settings page has the search field too.
- Settings search finds a setting when you type it without accents, in English, or with another word
  for it: "notificacoes", "update" and "tampa" each find their setting. A search for "tema" no longer
  shows "Permissões do sistema".
- A result for a row that is not shown now opens its tab and says why the row is not there.
- The command palette finds all the sections of the server settings and finds a settings page by the
  words of its rows. It ranks settings pages as the settings search does, so "voice" shows Voice first
  and "tema" no longer finds a page through "sistema". Enter does not open a settings page that only
  other words found while messages and files are still loading.
- Settings search finds a setting when the query has small words or a plural, such as "cofre do
  servidor", "membros do servidor" and "memória dos agentes". A search for "servidor" shows the
  sections of the server below the settings of this app, and each group shows its own results.
- Settings search does not show a row that the Updates tab hides now, and does not show Remove server
  for a hosted server. A newer result stops an older one that still waits for its row.
- In the web app, the command palette also finds the settings: Profile, Preferences and the sections
  of the server settings.
- The Roles section of the server settings is in Portuguese.
- Changing the default backup model, the retries or the waits in Settings › Agents now saves. The
  settings came from the app's own store, which cannot cross the bridge to the host, so every change
  was refused and the row stayed as it was.
- The selects of the backup model and of the stopped-work place filter keep working with the arrow
  keys: their option keys no longer hold a character that the list cannot find.
- The Windows installer now protects the Builders Bot workspace and data folders
  (`%USERPROFILE%\Builders Bot` and `%APPDATA%\Builders Bot`). Before, it protected only the Builders Bot
  folders, so an installation in a Builders Bot data folder could lose its data at the next update.
- A turn that started in one tab could take the starting message of another tab of the same agent.
- The rows of a turn could go to the task of another tab of the same channel.
- The record of what an agent's session read in one tab was written for every tab of that channel,
  so the next message of another tab got the whole channel again.
- The task reviewer took the start of a turn in one tab for the start of a turn in another tab of
  the same channel, and the running list could name the task of another tab.
- One slow page in your Chrome no longer cuts the connection for every agent.
- The connection renews its keys once a day without failing an agent's action.
- Turning the extension off removes the link that lets Chrome start Builders Bot. Builders Bot writes
  that link back at each start in Chrome mode, and repairs it when another program changes it.
- The load ring opens its panel again on a click. Before, a click did nothing.
- When the Mac is low on memory, new agent messages wait in the queue and start by themselves when
  memory is free again. Before, agents could use all the memory until macOS asked you to close apps.
- OpenCode agents no longer start the Playwright of your own `opencode.json`. Before, each agent
  started its own Playwright and Chrome, which used much memory.
- Stopped work of a deleted channel routine now leaves with the routine. Before, it stayed stopped
  for ever and you could not clear it.
- A channel routine no longer posts its request again each time the app starts. Before, a request
  that the lead could not route added one more stopped task at each start, and the run stayed queued.
- The red count of the ring counts every stopped run. Before, it stopped at 50.
- The Cultura Builder sign-in uses the fixed client of Builders Bot, so the paid connections of your
  organization work after a sign-in. Before, each sign-in registered a new client, which the Hub did
  not accept for connections. If the tool catalog says you are signed out, sign out of Cultura Builder
  and sign in again.
- Pointing at a group of agent faces, such as the faces of a channel in its header or in the
  sidebar, no longer starts their motion. Only the faces of agents that work move. Small faces, such
  as the face on an agent's chip, also stay still under the pointer. Before, pointing at the faces of
  a channel could show a part of the window without the glass background.
- The glow of the agent avatars no longer uses a graphics filter. Before, pointing at an avatar,
  such as a channel's faces or the lead's chip, could show a rectangle of the window without the
  glass background while the avatar moved.
- In the "New agent" dialog of a channel, the Model section shows all of its choices again. Before,
  the open section was cut to a strip under the Model row and covered the reasoning row, so you
  could not choose a model or a reasoning level. The choices now open in the form, under the row, and
  the form scrolls to show them, also with a short window or a large interface size.
- Enter in the model search of the agent dialog chooses the first model found. Before, it created or
  saved the agent with the model from before.
- The agent dialog no longer moves up when its Model section opens, so the Model row stays under the
  pointer.
- Settings > Notifications > Choose for one agent no longer goes past the bottom of the window on a
  server with many agents. Before, the last agents were cut off and you could not scroll to them or
  choose them. The menu now stops at the edge of the window and its list scrolls with the mouse,
  the trackpad and the keyboard.
- No menu of the app goes past the edge of the window. A menu with more rows than the window has
  scrolls.
- A usage limit that stops a task before it does any work, such as the 5-hour window of Claude, now
  gets the same tries again and backup model as a task that did not start. Before, it went to the
  agent's backup at once, or waited for the reset, and never used the default backup model.
- A slow summary of the channel history runs on the lead's model, so it no longer moves another
  agent to its backup model or keeps that agent's model from other agents.
- An agent whose model failed no longer moves other agents on the same model to their backups.
- A task that waits to run on the backup model no longer stays in "Trying again" for good: after 10
  minutes it runs, or it stops and the task reviewer takes it.
- While an agent waits on its backup model, its other tasks no longer start on its own model and
  make the wait longer. Tasks that fail together count as one failure.
- An agent goes back to its own model when its wait ends. A task that waits for a person no longer
  keeps it on the backup model, and a task that keeps it there does so for at most 2 hours.
- An agent set to ask before it switches never moves to the default backup model. Settings › Agents
  lists it with "asks first".
- An agent can no longer give another agent a backup model that switches without asking, or one on
  a provider account that the other agent does not use. Only you can.
- A quit request for Builders Bot from a script, such as `tell application "Builders Bot" to quit`,
  now quits the app. On a computer with a server on this computer, macOS could deliver it to that
  server: the server quit and started again, and the app kept running until a script stopped it
  about a minute later.
- A second quit while Builders Bot was still quitting, such as Cmd+Q again, no longer ends it before
  the database closes.
- The quit steps that keep no data share one time limit. When several of them do not stop, such as
  the team connection, Builders Bot still closes the database and quits within 30 seconds. The steps
  that save your data, such as the agent stop that records the turns it interrupts, keep their full
  time, and the database closes after them.
- A server on this computer that does not stop when Builders Bot quits is ended. It no longer keeps
  running after the app, which held its port and stopped it from starting again.
- Agents that use your own Chrome no longer open a new tab and a new tab group at each turn. The
  connection to the Playwright extension stays between turns, and an agent goes back to the tab it
  used last.
- Two agents no longer drive the same tab: an agent gets a tab that no other agent works in.
- Closing the last tab of a group no longer ends the connection: the tab stays, blank, for the next
  page.
- On macOS, a server on this computer no longer shows as a second "Builders Bot" in the Force Quit
  and low-memory panels. Each process of the app now starts as a UI element. The app then becomes a
  normal app with a Dock tile, and a server on this computer becomes background-only. Before, each
  start of a server while such a panel was open added an entry with the memory of the whole app.
- Cultura Builder sign-in no longer gives up on the first dropped request or unrecognised answer
  from the Hub. A device code lives for minutes and is polled every few seconds, so one bad
  round-trip was ending the whole sign-in and silently resetting the dialog, even after the user had
  approved the code on the Hub.
- On a Mac, the system dictation works again. Before, macOS stopped the dictation helper when it
  asked for the speech recognition permission, and dictation used the voice model with no message.
  The helper is now a small background app, and the permission prompt names "Builders Bot system
  dictation".
- The task reviewer tries a start that failed after 2 × its threshold (10 minutes at 5), not after the
  30 minutes of "Resume by itself". Before, a stopped card stayed for more than 15 minutes with the
  reviewer on.
- "Resume by itself" reads every stopped run, not only the first 50 rows. Before, a channel with many
  stopped runs hid the stopped work of the channels after it.
- "Resume by itself" no longer resumes a task that a resume cannot fix, such as a request that
  exceeds the routing context limit or a task whose agent was deleted. It gives the task to an agent
  with the same model when allowed, else it says that the task needs you.
- The lines of the task reviewer, of "Resume by itself" and of the memory level now go to
  `logs/task-reviewer/task-reviewer.log`. Before, they went nowhere in an app started from the Dock.
- Dictation from the global key combination now works when ElevenLabs Scribe is the voice model.
  Before, each dictation failed with "Builders Bot could not transcribe the dictation", because the
  recording was sent as one file, and the ElevenLabs model takes only a stream. The recording now
  goes through a stream, as it does in the message box. A model on this computer and your own voice
  server still get the whole recording.
- The load panel lists stopped and running work as a short list. Each item shows the channel, the
  tab, and one line of the request; click the line to read all of it. The reason a task stopped is
  now an icon with a tooltip, in your language. Before, each item repeated the same English sentence
  in red and showed the whole request.
- Resume and Reassign are now clear buttons on one line. Reassign is a menu that lists the agents
  with the same model first. Before, the buttons looked off and Reassign was a plain list box.
- The number in the load ring counts the agents that run now. Before, it stayed at 0 while agents
  worked in channels, in side threads or in messaging chats. An agent with more than one turn counts
  one time, and the number can be more than ten.
- A server on this computer no longer opens a second window at each start. Before, a window "Sign
  in to Builders Bot" with "Builders Bot could not load the account service" opened on top of the
  app, also when you were signed in, and came back at each launch.
- If the sign-in screen opens before Builders Bot can read the account, it reads the account again
  when the window shows or gets focus. Before, it stayed on "could not load the account service"
  until you quit the app.
- The agent dialog of a channel member scrolls as one form, and the Model section shows the model
  and its reasoning in full. The section is now under the face, so its menu has room to open, and
  the form scrolls to it when a menu opens. Long instructions scroll in their own box. Before, the
  section was cut to a strip and the reasoning was not visible.
- A server on this computer no longer shows as a second Builders Bot in the low-memory panel of
  macOS. It ran as a hidden app with the footprint of the whole app, so the panel listed two Builders
  Bot entries with the same size.
- On a Mac, new agent turns now wait, and idle agent processes close, when macOS itself reports
  memory pressure. Before, the memory reading counted only the "free" percentage, which stayed near
  40% while macOS ran out of memory and asked the person to close apps.
- A chat that you open from search, a notification, Back or Forward, or another page now also
  selects its section in the section rail, opens a collapsed section, turns off a list filter that
  hides it, and scrolls its row into view. Before, the list could stay on another section, and the
  open chat had no row.
- A search result in an agent's own chat opens that chat, also when a side thread of the agent was
  open. Before, the side thread stayed on screen, and the composer sent your message to it.
- A search result in a side thread scrolls to the message.
- A channel opens on the tab that you had open last, also from search, a notification and Back.
  Before, it opened on the first tab, and the first tab then became the last one.
- Each tab of a channel keeps its own draft. Before, a draft showed in every tab of the channel, and
  clearing it in one tab cleared it in all of them.
- A channel tab stays open when a read of it fails for a moment. Before, the channel went back to its
  first tab.
- A new installation starts at the Cultura Builder sign-in. Before, a computer prepared before it was
  handed over, or an app data folder restored from a backup, opened signed in with the account of the
  previous installation, so the person never signed in. The Cultura Builder provider sign-in of the
  previous installation is removed with it.
- OpenCode used much memory when agents worked in many folders. It kept a full set of your MCP
  servers for each agent folder, about 200 MB each, for as long as any agent used it. Now Builders
  Bot stops OpenCode when no turn runs and a folder was idle for 5 minutes, or when it holds more
  than 4 folders. The next message starts it again in the same conversation; only that first
  message is slower.
- Cultura Builder no longer fails to start with "stopped before it answered (exit code 1)". The
  OpenCode providers share one CLI and one SQLite database, and started together they locked each
  other out. They now start one at a time, and a start that dies at once is tried again.
- The example settings of the remote host (`remote/.env.example`) now point the ticket keys and the
  account service to the Builders Bot account server. Before, they pointed to the Builders Bot server,
  so a host that copied them would reject every ticket.
- In a section with a color, and below a marker with a color, the open chat keeps that color in a
  stronger tint, and so does the chat under the pointer. Before, the open chat turned gray, so it
  looked like a chat of another section. A chat with no color still opens in gray. The gray text of
  the chats below a marker with a color is also easier to read.
- A section icon image now loads in the installed app. Before, each image failed with "Builders Bot
  could not process this image", because the app does not allow `blob:` images. The editor also says
  why an image fails: an unsupported format, a file too large, a damaged file, or an SVG file with a
  script or a web link.
- A section selected in the column shows its chats open, also when it was collapsed in the full
  list. Before, it showed only its title.
- The column of sections no longer slows down the list while agents work.
- The reason of a stopped channel task shows in the language of the app. Before, it was always in
  English.
- With "Show agent steps" on, the steps of a turn are open while the agent works and close by
  themselves when the turn ends, so the answer shows under one short row. The row still shows the
  number of steps, the failed steps and the time. Steps that you opened stay open. Before, the
  steps of every turn stayed open above the answer, also in the history.
- The tabs of a channel now show what a person wrote in them, as the thread tabs of an agent's chat
  do. The open tab has an info button before its name. It opens the first and the last message that
  a person sent in the tab, with "Show more" for the whole text. The pointer on a tab shows a card
  with the start of its first message. The messages stay after a rename of the tab, and tabs made
  before this version show them too. Before, a channel tab had no info button and no preview.
- A paid data connection call refuses a URL of a private or local address also when the URL has no
  `//` or has a `\`, such as `http:\\10.0.0.1` or `https:192.168.0.10`.
- The result of a paid data connection hides the signature of a signed link (`X-Amz-Signature`,
  `sig`, also when the name is percent-encoded) and every value in a field that holds a credential,
  numbers and nested values too.
- A routine that Builders Bot did not see you save, such as one from an import, a template or the
  marketplace, uses no paid data connection until you save it in Routines. A copy of an agent keeps
  the connection limits of its routines.
- When you change only the name, the schedule or the state of a routine that a team member wrote,
  the routine still uses no paid data connection.
- A team member's edit of a queued routine step, a team member's webhook test event, and a webhook
  request signed with a secret that a team member got no longer let the routine, or the next steps
  of its flow, use paid data connections.
- The transparent window keeps the blurred desktop behind it while the window is not active. Before,
  macOS replaced the blur with a flat, near-black color, which showed most in the left column.
- A paste of more than 100,000 characters into the message box no longer loses text. The box kept
  the first 100,000 characters and dropped the rest with no message. The text now goes in as a text
  file attachment, with a reference to it in the message.
- An agent's change to a routine schedule stays saved. Before, when the agent changed a routine to a schedule that only the cron field can show, each older routine card in the chat saved the earlier schedule again, and the chat filled with "Updated routine" lines.
- While the phone downloads a file from a server, other answers from that server no longer wait for the download to finish.
- A computer that joined a server over a direct connection now gets the newer server features, such as thread branches and notification levels for agents. Before, it got only the older features of the server.
- An agent with no title no longer saves "General assistant" as its title.
- Update the file preview panel when the agent changes the open file or folder. Before, the panel
  showed the file as it was when you opened it.
- WhatsApp shows its logo in the Marketplace and on the app card that an agent shows in a chat.
  Before, it showed a puzzle piece, because whatsapp.com refuses its icon to the app.
- OpenCode and Cultura Builder agents no longer start the Playwright server of your own
  `opencode.json` next to the shared browser of Builders Bot. With OpenCode 2, the setting that
  turned it off did nothing, so each OpenCode process of the app kept a second browser server open.
- On a Mac that is low on memory, an agent tab in the Builders Bot browser that nobody uses now
  unloads its page after 5 minutes, not 30, when that agent is not working on a reply. The tab of
  an agent that is still working keeps the 30 minutes. You and your agents can still open new tabs
  and pop-up windows. Before, only a server unloaded tabs sooner.
- When the offline cache of one site in the Builders Bot browser (the cache of its service worker) is
  larger than 100 MB, Builders Bot clears the cache and the service worker of that site after it
  opens. Other sites keep theirs. When the compiled scripts of a browser profile are larger than
  100 MB, Builders Bot clears them for all sites of that profile. Your sign-ins stay. The first visit
  to such a site after that is a little slower.
- OpenCode no longer starts the Playwright server of your own `opencode.json` for Builders Bot agents.
  Before, OpenCode 2 ignored the setting that turned it off, and the server ran beside the shared
  browser of Builders Bot.
- The Cultura Builder row no longer shows a "Sign in" button that did nothing, in setup and in
  Settings. Its Connect is the Cultura Builder sign-in.
- On a joined server whose host has no Cultura Builder sign-in, the row is in "More providers" and
  says that Cultura Builder does not connect through a remote server yet. Its main button selects
  another provider. Another problem of the host keeps the host's own message.
- The Cultura Builder row no longer asks for a new sign-in each time the access token expires. The
  provider check now refreshes and saves the token before it starts the provider, as a turn does.
- A Cultura Builder with no sign-in, a refused refresh token, or a refused token now shows "Not
  connected" and Connect, not "Unavailable", and none of them counts as a failed start. An account
  without access to the LLM says so. The Cultura Builder messages are translated.
- Usage no longer scrolls sideways when the totals have long labels, as in Portuguese.
- An app page whose status is long, such as "Precisa de atenção", puts the status under the name
  in a narrow window, instead of pushing the page action out of it.
- Dictation with ElevenLabs no longer acts as if no API key is saved when the saved key cannot be
  read, for example after the keychain changed or after a profile was copied from Builders Bot.
  Settings > Voice says that the key cannot be read, and gives Use Parakeet (local) and Remove
  unreadable key. Before, the app asked for a key and the microphone was never asked for.
- The dictation of the global shortcut shows the real reason when it fails, such as a missing or
  unreadable API key. Before, it always showed the same general failure.
- When macOS refuses the microphone, the message under the message field has an Open System Settings
  button that opens Privacy & Security > Microphone.
- When the saved key of your own voice server cannot be read, Settings > Voice and the voice server
  dialog say so, and a refused request says that the saved key cannot be read. Before, the app
  showed no key and the server answered that it refused the key. A save without a new key keeps the
  file, and a server that needs no key still works.
- On macOS, dictation reads the microphone permission before it downloads a model. macOS asks for
  the microphone at once, and a refused or blocked microphone shows its own message, also in the
  dictation of the global shortcut. On Windows, dictation opens the microphone as before, and a
  refusal has Open Windows Settings.
- Read aloud stays in the right-click menu of a reply when the voice is not downloaded. It tells you
  to download the voice and gives the download, with its size. Before, the item was not shown and
  nothing told why. The action bar of a reply shows no Read aloud button without the voice, as before.
  A build with no speech runtime does not offer the download, because the download does not repair it.
- The accounts panel does not link a number into a WhatsApp account that had another number, or
  that keeps the history of another number after an unlink. Before, a second number linked into the
  same account made wazap set the history of the earlier number aside and delete it after seven
  days.
- Stop the false "could not load the account service" error when you open the app. The sign-in
  screen now stays on "Connecting" while the app starts, and shows the error only when the account
  service still does not answer after about 8 seconds.
- A member whose channel task was stopped, replaced or restarted no longer shows the error "The channel
  assignment is no longer active". It now ends its turn quietly. A channel tool call that comes just
  before the turn is linked to its task waits a short time instead of failing.
- The logo files of the brand page on the website show the Builders Bot cube and the name
  "Builders Bot". Before, they showed an old mark and another name.
- The logo in the mobile app, in About and in the hosted server setup, shows the Builders Bot cube.
  Before, it showed the old mark.
- The model picker in Quick chat no longer closes or flickers while another conversation runs. Before,
  it could close while you chose a model.
- A model you chose in Quick chat no longer changes back to the old model when you send your next
  message. Before, the message could run on the old model.
- An agent that the Quick chat asked can answer it with `send_message`. Before, the answer was refused as an
  unknown agent, because the Quick chat agent is in no list. Now the Quick chat takes the answer to a question that
  it sent from an open conversation, one time, and the answer shows in that conversation. Any other message to
  it, and every list, tool and the Team API, still do not find it.
- The agent strip of the Quick chat shows the agents that a conversation called, and what each one does. Before, it
  never showed for a conversation, because a request that an agent sends from a side thread left no row for the strip to
  read. It counts the agents that are done, and closes when the last one answers.
- A change in the queue of an agent no longer reads the whole mailbox to find the Quick chat questions that wait for
  it. Before, each of these changes scanned every delivery and indexed every message for it, in each agent, also with
  no Quick chat conversation open. The Quick chat tasks now remember which agents they asked, so the check is a lookup.
- In the Quick chat, when you change the model while the open conversation answers, the "next turn" badge now
  shows. Before, the header showed the new model and no badge, while the answer still ran on the old one.
- The agent stage of a channel no longer says "Nobody is working" while an agent works. After you closed the
  open tab of a channel, the stage kept the id of that tab and ignored the agents of the tab that opened next.
- The agent stage keeps its fold in steps (the agents fade out, then the panel folds) together with the fold
  of each channel.
- Let the quick chat run 8 conversations at the same time, and let you change that number. Before, it held every
  conversation after the third with "Waiting for a free thread. 3 threads running", and no setting changed it. The
  limit of tabs per agent in Settings › Load is for channels and never reached the quick chat. The new "Quick chat
  threads" setting is in Settings › Load, from 1 to 16, saved, and a lower number stops no turn that runs.
- Say why a thread waits when the computer is low on memory. Before, the thread had no named wait, and the page
  wrote "Waiting for a free thread. 3 threads running" although nothing ran. It now says that the computer runs as
  many turns as its memory allows. A thread with no named wait shows no text, also in the iPhone app.
- Name a channel tab, a task thread and a quick chat by what the message says. Before, a message that
  started with an image gave the title `@[image.png](attachment:…)`; now the title is the short text
  that the model writes from the words, and a message of only files keeps their names.
- The Quick chat now shows the queue panel while the agent is thinking, so a message sent meanwhile can be edited, steered or forced.
- The Quick chat header is shorter: the name and the title are split by a slash, and under 1000 px the model is only its icon with a dot for the effort.
- A channel shows the agent as working from the moment its task is ready, in the activity line and
  on the agent stage. Before, nothing showed while the provider started the turn, and the channel
  looked stuck although the Stop button was on.
- Write each failed tool step to the app log. Before, a step that failed showed only in the chat,
  and the log kept no record of it.
- A long session keeps less memory in the chat. The raw text of a message that leaves an inactive
  conversation is now freed, and each conversation keeps only its newest 20 different errors.
- The feed no longer shows a run in a task or a channel tab as finished while it still works. A run
  that goes on after the agent's own chat updates stays a Working card, with its steps.
- The feed shows the runs of channels, tasks and messaging threads as Working cards, with their steps.
  Before, only the run in an agent's own chat showed, so the feed said that nobody worked while a
  channel ran and the agents of the feed tables did not move.
- The CLA can be signed with the English line again, next to the Portuguese one, and the checker
  accepts the Portuguese `Versão:` field. A contributor following the Portuguese text is no longer
  refused.
- The telemetry guard treats `api.openpanel.dev` as the destination the account service reports to,
  instead of the previous project's host.
- The production deploy no longer stops when the optional site-router token is absent: it falls back
  to the production deploy token, which already has the Worker and zone permissions.
- The production deploy verifies the account Worker on `buildersbot.culturabuilder.com`, the route
  that exists. `api.buildersbot.culturabuilder.com` still has no DNS record of its own.
- Published sites answer on the current one-label host (`<slug>.culturabuilder.com`): the site router
  declares the wildcard route again, and the deploy smoke check uses that shape instead of the old
  `sites.` subdomain.
- The agent stage of a channel keeps the agent that gave work to others on the stage while it waits for that
  work, and draws the dashed line from it to each agent that does the work. Before, the agent left the stage
  when its own turn ended, and the lines went away with it.
- A click no longer stops working after you scroll up in a channel and come back to the end of the
  chat. The stage had told the channel that you were up in older messages in a way that made the app
  stop reacting to anything.
- Load the window again when its screen stops answering after an error. Before, one uncaught error in
  the window stopped every click and every update until the app was closed, and nothing was written to
  the log. Now the log has a line about it, and the window loads again once in 5 minutes. Running
  agents are not stopped.
- Show the words of a request, not the `@[image.png](attachment:...)` marker, as the title of the
  request card on the channel stage when the first message starts with an image.
- Stop the window from freezing while agents write long replies in channels. The window read the
  channel list on each chunk of a reply, and with many long channels each read kept the main process
  busy for 100 to 200 ms. Now these reads wait between each other, so clicks still answer.
- The New tag window in the quick chat list now has a background, a border and padding, and the tag label on a row sits
  centered on its line.
- OpenCode agents no longer stop to ask which web search service to use (Exa, Firecrawl and others). Web search is
  handled by Builders Bot.
- The site router no longer answers the Hub (`hub.`) and the RTX model endpoint (`llm-rtx.`) as published sites. They pass straight to their origin, so the wildcard route cannot take the model gateways offline again. More platform hosts go in `PASSTHROUGH_HOSTNAMES`.
- On the stage of a channel, the speech bubble of an agent no longer squeezes and springs open at each
  new progress line. It moves only when the status of the agent changes (reading, thinking, editing...).
  A new line under the same status takes the place of the old one with no motion.
- The bubble can no longer stay a pill with three dots: if the opening does not end in time, the line
  shows anyway.
- The site router serves published sites only under `culturabuilder.com`. The old second zone is gone.
- On the stage of a channel, the speech bubble of an agent that has no step to report no longer closes
  to the three dots and types the same kind of line again each time the agent changes pose. The bubble
  moves and types only when what it says is new.
- A channel with a full memory (32 notes) no longer shows the error "A channel can have up to 32
  memories" on each try. The agent now gets a note to merge the old memories into one and keeps working.
- On a server on this computer, or on a joined server whose member name is not your account email,
  a message you send is no longer shown twice with "Not sent". The app now knows which member you
  are from the session, not from the email of your account.

### Security

- The sign-in of the web app is bound to the browser that started it. Only that browser can collect
  the approval from the Hub, and the page never gets a session token.
- The account service refuses to make or redeem a Mobile Connect code or permanent link.
- The web app opens only with a session of the Cultura Builder sign-in. The phone email code of the
  earlier phone app is refused.
- The sign-in screen says to approve on the Hub only the code that it shows.
- After a sign-in, the sign-in service ends its own copy of the Hub access at once.
- The sign-in code of the web app comes only by email again. Before, a configuration error showed
  the code in the sign-in form.
- The account service no longer returns a sign-in code on its public address, also when that
  configuration error comes back. Only a local development address gets the code.
- Agents can no longer run Playwright code in your Chrome with `browser_run_code_unsafe`. That
  tool reached every tab of the group and the cookies of your signed-in sites. Agents now get an
  error for it and use the other browser tools, such as `browser_evaluate` on the current page.
- An approval of the Guard, a request for more access and a file change outside the workspace show
  their reason and need a second, explicit step on the card. N opens a confirmation and never denies
  by itself.
- The Feed sends only the ids of the cards. The app checks each card again: the request must still
  wait, for the same agent and conversation, on this computer. A repeated action does nothing. The
  cards of a joined server offer no action; their conversation answers them, as before.
- A model policy file that is not valid offers only the Cultura Builder gateway. It does not open
  every provider.
- In a container of `buildersbot-instance`, the model policy is in a read-only folder, so an agent cannot
  change it.
- Builders Bot no longer approves a connection cost by itself: the Hub accepts a call above the
  approval amount only after you approve it on the Hub.
- The web client keeps the first key that it sees for each server. A later key change is used only
  when the previous key signed a handover to it, as on desktop.
- The Guard now reads more ways to send a secret file. It follows grouped short options of `curl`
  that end in the one that sends a file (`-sd @file`, `-sT file`, `-sF x=@file`), and it reads the
  code that starts a process inside `node -e`, `python3 -c`, `perl -e` and `osascript -e` as a
  command of its own. A request to take a secret and send it is also found with the verbs copy,
  gather, fetch and obtain, in English and in Portuguese. Each argument of a stdio MCP server that an
  agent saves stays one word, so the Guard reads the code of a `node -e` argument whole.

## [1.0.0] - 2026-11-02

First public release of Builders Bot under Cultura Builder.

### Added

- Desktop app for macOS, Windows and Linux, with agents that run on this computer or on a server.
- Local-first workspace: the agents, the conversations and the database stay on the machine that runs
  them; the account is central.
- Builders, Codex, Claude, Grok and custom providers, each with its own model and reasoning level.
- Channels with a lead and members, tasks, routines, workflows, a schedule, a marketplace and a
  shared browser.
- Remote access with a paired phone or another computer, and published sites on our zone.

### Changed

- The product, the package scopes, the file names, the headers, the environment variables and the
  network hosts are ours. The license is our EULA with a commercial license per seat.
- The profile folder, the database file and the workspace state folder of an installation made
  before this version are moved on first run, so an upgrade keeps the account, the agents and the
  chats.
