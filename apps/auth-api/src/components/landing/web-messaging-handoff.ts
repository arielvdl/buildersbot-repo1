import {
  decodeWebMessagingInstallMark,
  decodeWebMessagingInstallReceipt,
  WEB_MESSAGING_INSTALL_CHANNEL,
  type WebMessagingInstallPlatform,
  webMessagingInstallKey,
} from "@buildersbot/contracts/web-messaging-install";

/** How long the page waits for the client tab's answer. The tab answers before any network call. */
const RECEIPT_TIMEOUT_MS = 3_000;

/**
 * Gives a Slack or Discord install's sealed grant to the browser client tab that started it. Null when
 * no tab of this browser marked the nonce: the page then opens the `buildersbot://` link of the desktop app,
 * or, on a phone, asks to start again in the web app. Otherwise true when the tab took the grant, and
 * false when no tab answered, for example after a reload.
 */
export function handOffToWebClient(
  platform: WebMessagingInstallPlatform,
  fragment: URLSearchParams,
): Promise<boolean> | null {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  if (!nonce || !grant) return null;
  try {
    const key = webMessagingInstallKey(nonce);
    const marked = decodeWebMessagingInstallMark(localStorage.getItem(key), Date.now());
    localStorage.removeItem(key);
    if (marked !== platform) return null;
  } catch {
    return null;
  }
  const channels = [WEB_MESSAGING_INSTALL_CHANNEL].map((name) => new BroadcastChannel(name));
  return new Promise<boolean>((resolve) => {
    const done = (received: boolean) => {
      clearTimeout(timer);
      for (const channel of channels) channel.close();
      resolve(received);
    };
    const timer = setTimeout(() => done(false), RECEIPT_TIMEOUT_MS);
    for (const channel of channels)
      channel.onmessage = (event) => {
        if (decodeWebMessagingInstallReceipt(event.data) === nonce) done(true);
      };
    for (const channel of channels) channel.postMessage({ platform, nonce, grant });
  });
}
