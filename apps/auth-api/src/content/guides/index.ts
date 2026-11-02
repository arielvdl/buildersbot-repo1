// Slug to guide body, on the same terms as the news bodies: eager, so the prose
// is in the server's HTML rather than arriving after hydration.

import type { ArticleBody } from "../body";
import { AgenticAIDefinition } from "./agentic-ai-definition";
import { AIAgentsExamples } from "./ai-agents-examples";
import { AIAgentsVsAgenticAI } from "./ai-agents-vs-agentic-ai";
import { BuildersBot101 } from "./buildersbot-101";
import { BuildersBotHostedServers } from "./buildersbot-hosted-servers";
import { BuildersBotMarketplace } from "./buildersbot-marketplace";
import { ImportGrokBotAgents } from "./import-grok-bot-agents";
import { ImportHermesAgents } from "./import-hermes-agents";
import { WhatAreAIAgents } from "./what-are-ai-agents";
import { WtfIsBuildersBot } from "./wtf-is-buildersbot";

export const GUIDE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "import-hermes-agents": ImportHermesAgents,
  "import-grok-bot-agents": ImportGrokBotAgents,
  "ai-agents-examples": AIAgentsExamples,
  "ai-agents-vs-agentic-ai": AIAgentsVsAgenticAI,
  "agentic-ai-definition": AgenticAIDefinition,
  "what-are-ai-agents": WhatAreAIAgents,
  "buildersbot-101": BuildersBot101,
  "buildersbot-hosted-servers": BuildersBotHostedServers,
  "buildersbot-marketplace": BuildersBotMarketplace,
  "wtf-is-buildersbot": WtfIsBuildersBot,
};
