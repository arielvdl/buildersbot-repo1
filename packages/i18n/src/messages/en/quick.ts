import { defineMessages } from "../../message";

export const messages = defineMessages("quick", {
  // The Quick chat page: one hidden agent with its own conversations. The name is also source text,
  // because the backend gives it to the agent when it makes it.
  "quick.agentName": "Quick chat",
  "quick.rail.label": "Quick chat",
  "quick.page.label": "Quick chat",
  "quick.page.loading": "Loading Quick chat",
  "quick.empty.title": "What do you want to solve?",
  "quick.composer.label": "Message",
  "quick.composer.placeholder": "Ask anything",
});
