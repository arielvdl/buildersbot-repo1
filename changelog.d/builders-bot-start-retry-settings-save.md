### Fixed

- Changing the default backup model, the retries or the waits in Settings › Agents now saves. The
  settings came from the app's own store, which cannot cross the bridge to the host, so every change
  was refused and the row stayed as it was.
- The selects of the backup model and of the stopped-work place filter keep working with the arrow
  keys: their option keys no longer hold a character that the list cannot find.
