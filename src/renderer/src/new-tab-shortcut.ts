import { onSettled } from "solid-js";
import { currentDevicePlatform } from "./send-shortcut-preference";

/** The full browser view owns ⌘T while it is open: it opens a browser tab there. */
const BROWSER_VIEW_OPEN = "#browser-expanded-panel:not([hidden])";

/** True for the key of a new tab in other browsers: ⌘T on a Mac, Ctrl+T elsewhere. */
export function isNewTabKey(
  event: Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">,
  platform: "darwin" | "win32" | "linux",
): boolean {
  if (event.key.toLowerCase() !== "t" || event.altKey || event.shiftKey) return false;
  return platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/**
 * Runs `onNewTab` on ⌘T (Ctrl+T) while the calling view is mounted, as the full browser view does. A
 * dialog, a menu, the full browser view and text being composed keep their own keys. `enabled` can
 * turn the key off, for a view that cannot add a tab.
 */
export function useNewTabShortcut(onNewTab: () => void, enabled: () => boolean = () => true): void {
  onSettled(() => {
    const platform = currentDevicePlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.repeat) return;
      if (!isNewTabKey(event, platform) || !enabled()) return;
      if (event.target instanceof Element && event.target.closest("[role=dialog], [role=alertdialog], [role=menu]")) {
        return;
      }
      if (document.querySelector(BROWSER_VIEW_OPEN)) return;
      event.preventDefault();
      onNewTab();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}
