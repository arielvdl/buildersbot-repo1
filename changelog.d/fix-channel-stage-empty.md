### Fixed

- The agent stage of a channel no longer says "Nobody is working" while an agent works. After you closed the
  open tab of a channel, the stage kept the id of that tab and ignored the agents of the tab that opened next.
- The agent stage keeps its fold in steps (the agents fade out, then the panel folds) together with the fold
  of each channel.

### Changed

- When nobody works and "Hide when nobody works" is on, the stage leaves the top of the channel completely, with
  no strip and no text. It comes back when an agent starts to work. A stage that you fold by hand stays a strip.
- The line "Waiting - … answers the earlier message of this tab first" is gone from above the message field.
  The work of the earlier message is already on the screen. A message that waits for the agent's limit of tabs,
  for memory, or for the agent's own chat keeps one quiet line with an icon, which opens to the reasons.
