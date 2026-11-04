### Changed

- Idle agent sessions use less memory. With the tab mode `memory`, at most 3 idle sessions stay open, not 8; the
  rest close and open again from their history on the next message. Settings > General > Advanced
  optimizations: "Keep fewer idle agents warm" and "Free idle agents when memory is low" now start on.
- A session that runs a background task is never closed because of the idle limit.
- Settings > General > Advanced optimizations has a switch for the browser tab sleep, "Unload agent browser
  tabs that nobody uses". It starts on, as the sleep did before.
- A session with a background task that the provider reports stays open until the task ends. The fixed one-hour
  cap for a provider that stops reporting no longer follows the short idle time of the memory policy.
- The WhatsApp tool server (`npx -y wazap-mcp@1.6.x`) starts its own program directly when `npx` already has
  the package (other tool servers keep their `npx` line), with no `npm exec` around it (about 50 MB less for each agent, and a faster start). Settings >
  General > Advanced optimizations: "Start tool servers without the npx wrapper". On by default.
- Settings > General > Advanced optimizations: "Share one WhatsApp tool server between agents". The WhatsApp tool
  server runs once for all agents, behind a local address of this app, and each agent keeps its own session. On by default: six agents used to start six copies of the server (about 1.4 GB).
- The shared WhatsApp tool server host never repeats a tool call after an error in the connection: only calls
  without effect (listing tools, `initialize`, `ping`) are repeated. A call that failed in the middle comes back
  to the agent as an error, and the next call works.
