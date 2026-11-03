### Changed

- Close idle agent sessions sooner when the computer has plenty of free memory: at most 4 stay open,
  for 5 minutes. Before, 8 stayed open for 10 minutes. The next message to a closed session opens it
  again from its saved session.

- Keep less memory for long chat messages. The cache of rendered text now also has a size limit, so
  a conversation with many long messages no longer holds all of them in the window.
