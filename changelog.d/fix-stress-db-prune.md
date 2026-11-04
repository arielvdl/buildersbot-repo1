### Fixed

- The database no longer keeps imported provider history rows that nothing reads again. Every 6
  hours, in small batches, Builders Bot deletes the staged rows of a retired Codex or Claude session
  whose history is fully imported. The chat keeps all its messages.
