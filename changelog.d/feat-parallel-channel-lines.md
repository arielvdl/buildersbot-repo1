### Changed

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
