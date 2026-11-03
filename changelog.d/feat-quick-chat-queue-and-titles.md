### Added

- In a Quick chat conversation, a message that you send while the agent works now waits in a visible
  queue. Send it to the running turn, delete it, or drag it up or down to set its priority.

### Changed

- A Quick chat conversation gets a short title from what was said, after the first answer. Before,
  the title was the start of your first message. A title that you set yourself stays.

- The Quick chat asks Claude for the 1 hour prompt cache and keeps up to six idle conversations open
  apart from other agents' threads, so a message that comes after a pause pays less to read the
  conversation again. The log shows the cache hit rate of its Claude sessions.
