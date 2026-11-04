### Changed

- A channel packet now carries at most 16 KB of recent messages and a summary of at most 6 KB. Before, the
  ceilings were 60 KB and 12 KB, so a new session of each agent read about 70 KB before it did any work.
  Older messages stay behind `channel_history`, and the summary covers them.
