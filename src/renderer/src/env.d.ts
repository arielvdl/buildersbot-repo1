/// <reference types="vite/client" />

import type { BuildersBotDesktopApi } from "@buildersbot/contracts/ipc";

declare global {
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): this;
    delete(name: string): boolean;
  }

  interface Window {
    buildersbot: BuildersBotDesktopApi;
  }
}
