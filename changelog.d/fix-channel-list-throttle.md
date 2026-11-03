### Fixed

- Stop the window from freezing while agents write long replies in channels. The window read the
  channel list on each chunk of a reply, and with many long channels each read kept the main process
  busy for 100 to 200 ms. Now these reads wait between each other, so clicks still answer.
