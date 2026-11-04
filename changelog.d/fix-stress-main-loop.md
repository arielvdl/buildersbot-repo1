### Fixed

- Keep the window smooth while many agents write at the same time. Before, each streamed reply
  wrote to the database and to the channel ten times a second, and each write read every agent.
  Now a write reads only its own agent, and the writes slow down as more replies stream.
