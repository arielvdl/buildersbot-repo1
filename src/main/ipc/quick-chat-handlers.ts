// The quick chat: one local agent that no list shows. See `docs/architecture/quick-chat.md`.

import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

export interface QuickChatIpcDependencies {
  service: Pick<AgentService, "ensureQuickChat">;
}

export function quickChatIpcHandlers({ service }: QuickChatIpcDependencies): Pick<IpcGroupHandlers, "quickChat"> {
  return {
    // Local only and with no payload: the renderer sends nothing that main has to decode, and the group
    // has no server to name. The sender check of the IPC layer runs before this.
    quickChat: { ensure: handler(() => runCauseEffect(service.ensureQuickChat())) },
  };
}
