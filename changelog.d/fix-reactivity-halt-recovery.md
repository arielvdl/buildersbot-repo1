### Fixed

- Load the window again when its screen stops answering after an error. Before, one uncaught error in
  the window stopped every click and every update until the app was closed, and nothing was written to
  the log. Now the log has a line about it, and the window loads again once in 5 minutes. Running
  agents are not stopped.
