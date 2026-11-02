/** Keep the last server in this browser, separately for each account. */
export function readWebServerSelection(accountId: string): string | null {
  try {
    return window.localStorage.getItem(`buildersbot.web.selected-server:${accountId}`);
  } catch {
    return null;
  }
}

export function writeWebServerSelection(accountId: string, hostId: string): void {
  try {
    window.localStorage.setItem(`buildersbot.web.selected-server:${accountId}`, hostId);
  } catch {
    // A UI preference must not block a connection when storage is unavailable.
  }
}
