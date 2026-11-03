// The quick chat: one local agent that no list shows. See `docs/architecture/quick-chat.md`.

import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseSetQuickChatConversationRuntime } from "./quick-chat-inputs";

export interface QuickChatIpcDependencies {
  service: Pick<AgentService, "ensureQuickChat" | "setQuickChatConversationRuntime" | "warmQuickChat">;
}

export function quickChatIpcHandlers({ service }: QuickChatIpcDependencies): Pick<IpcGroupHandlers, "quickChat"> {
  return {
    // Local only and with no payload: the renderer sends nothing that main has to decode, and the group
    // has no server to name. The sender check of the IPC layer runs before this.
    quickChat: {
      ensure: handler(() => runCauseEffect(service.ensureQuickChat())),
      warm: handler(() => runCauseEffect(service.warmQuickChat())),
      // The payload is decoded here; the service refuses a task of any other agent.
      setConversationRuntime: payloadHandler(parseSetQuickChatConversationRuntime, (input) =>
        runCauseEffect(service.setQuickChatConversationRuntime(input)),
      ),
    },
  };
}
