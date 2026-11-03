import { onSettled } from "solid-js";
import { currentDevicePlatform } from "./send-shortcut-preference";

/** The full browser view owns ⌘W while it is open: it closes a browser tab there. */
const BROWSER_VIEW_OPEN = "#browser-expanded-panel:not([hidden])";

/** True for the key that closes a tab in other browsers: ⌘W on a Mac, Ctrl+W elsewhere. */
export function isCloseTabKey(
  event: Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">,
  platform: "darwin" | "win32" | "linux",
): boolean {
  if (event.key.toLowerCase() !== "w" || event.altKey || event.shiftKey) return false;
  return platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

interface CloseTabShortcut {
  /** Closes the tab that is open. It runs when no dialog or menu holds the key. */
  onClose: () => void;
  /** False for a view with no tab to close. */
  enabled?: () => boolean;
  /** True while the close dialog of this view is open: the key then answers it with `onConfirm`. */
  confirming?: () => boolean;
  onConfirm?: () => void;
}

/**
 * Runs `onClose` on ⌘W (Ctrl+W) while the calling view is mounted, as other browsers close a tab.
 * While `confirming`, the same key confirms the close dialog, so the key twice closes a tab that asks
 * first. Another dialog, a menu, the full browser view and text being composed keep their own keys.
 */
export function useCloseTabShortcut(options: CloseTabShortcut): void {
  onSettled(() => {
    const platform = currentDevicePlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.repeat) return;
      if (!isCloseTabKey(event, platform)) return;
      if (options.confirming?.()) {
        event.preventDefault();
        options.onConfirm?.();
        return;
      }
      if (options.enabled && !options.enabled()) return;
      if (event.target instanceof Element && event.target.closest("[role=dialog], [role=alertdialog], [role=menu]")) {
        return;
      }
      if (document.querySelector(BROWSER_VIEW_OPEN)) return;
      event.preventDefault();
      options.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}
