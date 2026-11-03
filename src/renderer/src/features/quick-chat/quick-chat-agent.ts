import { createSignal } from "solid-js";

/**
 * The id of the Quick chat agent while the Quick chat page is open, else undefined. The agent is in no
 * roster, so the thread state needs this id to read its open conversation. The page sets it and clears
 * it when it closes, so a closed page costs nothing.
 */
const [quickChatAgentId, setQuickChatAgentId] = createSignal<string | undefined>(undefined);

export { quickChatAgentId, setQuickChatAgentId };
