import {
  type AgentProviderId,
  type AgentProviderRef,
  isKnownAgentProvider,
  providerDisplayName,
} from "@buildersbot/contracts/agent-providers";

/**
 * The model family of an agent and how much it needs attention, as data. Pure and DOM-free. The agent
 * stage of a channel and the feed read them, so the mark above an agent and the order of agents are the
 * same in both.
 */

/**
 * What an agent does, for the order of attention. `stalled` is a channel task that stopped and waits
 * for the person. `failed` is a last turn that failed: it can be old.
 */
export type OrbitState = "working" | "speaking" | "thinking" | "waiting" | "stalled" | "failed" | "done" | "idle";

/**
 * What a waiting agent waits for. `question`, `approval` and `takeover` wait for the person. `limit`
 * waits for a provider plan to reset. `turn` waits for a free place under the agent cap, or for its
 * queued routine run.
 */
export type OrbitWait = "question" | "approval" | "takeover" | "limit" | "turn";

/** The Claude tiers. Each one has its own mark, because one provider runs most agents. */
export type OrbitTier = "opus" | "sonnet" | "haiku" | "fable";

/**
 * The makers of open models that run through a router, such as OpenCode, OpenRouter or Cultura
 * Builder. No provider of this build has their logo, so each one has a plain shape of its own.
 */
export type OrbitMaker = "kimi" | "glm" | "qwen";

/**
 * The model family of an agent: a Claude tier, the mark of a provider, the shape of a maker, or
 * `other` for a provider that this build does not know. `name` is a product name, so it is not
 * translated; `other` has none.
 */
export type OrbitFamily =
  | { id: OrbitTier; kind: "tier"; name: string }
  | { id: AgentProviderId; kind: "provider"; name: string }
  | { id: OrbitMaker; kind: "maker"; name: string }
  | { id: "other"; kind: "other"; name: null };

const TIER_NAMES: Readonly<Record<OrbitTier, string>> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable",
};
const TIER_PATTERN = /(?:^|[^a-z])(opus|sonnet|haiku|fable)(?:[^a-z]|$)/u;
/**
 * Model ids that name the maker of the model when another provider, such as OpenRouter, runs it. A
 * maker with a provider in this build shows the logo of that provider (Gemini runs on Antigravity).
 */
const MODEL_MAKERS: readonly { pattern: RegExp; provider: AgentProviderId }[] = [
  { pattern: /(?:^|\/)(?:gpt|o\d)(?:-|$)/u, provider: "codex" },
  { pattern: /(?:^|\/)grok(?:-|$)/u, provider: "grok" },
  { pattern: /(?:^|\/)deepseek(?:-|$)/u, provider: "deepseek" },
  { pattern: /(?:^|\/)gemini(?:-|$)/u, provider: "antigravity" },
];
/** Model ids of the makers that have no provider in this build. */
const OPEN_MAKERS: readonly { pattern: RegExp; id: OrbitMaker; name: string }[] = [
  { pattern: /(?:^|[/:_-])kimi(?:[-_.]|$)/u, id: "kimi", name: "Kimi" },
  { pattern: /(?:^|[/:_-])(?:glm|chatglm)(?:[-_.]|\d|$)/u, id: "glm", name: "GLM" },
  { pattern: /(?:^|[/:_-])(?:qwen|qwq)(?:[-_.]|\d|$)/u, id: "qwen", name: "Qwen" },
];

/**
 * The family of a model. A Claude tier wins wherever it runs, then the maker that the model id
 * names, then the provider. A provider that this build does not know is `other`.
 */
export function orbitFamily(provider: AgentProviderRef, model: string): OrbitFamily {
  const id = model.toLowerCase();
  const tier = TIER_PATTERN.exec(id)?.[1];
  if (isOrbitTier(tier)) return { id: tier, kind: "tier", name: TIER_NAMES[tier] };
  const maker = MODEL_MAKERS.find((entry) => entry.pattern.test(id))?.provider;
  if (maker) return { id: maker, kind: "provider", name: providerDisplayName(maker) };
  const open = OPEN_MAKERS.find((entry) => entry.pattern.test(id));
  if (open) return { id: open.id, kind: "maker", name: open.name };
  if (isKnownAgentProvider(provider)) return { id: provider, kind: "provider", name: providerDisplayName(provider) };
  return { id: "other", kind: "other", name: null };
}

function isOrbitTier(value: string | undefined): value is OrbitTier {
  return value === "opus" || value === "sonnet" || value === "haiku" || value === "fable";
}

/** The waits that only the person can end. */
export function orbitWaitsForPerson(wait: OrbitWait | null): boolean {
  return wait === "question" || wait === "approval" || wait === "takeover";
}

/**
 * How much an agent needs attention, lowest first: a wait for the person, a stopped task, a message
 * that is written now, running work, thinking, another wait, a failed turn, done work, nothing.
 */
export function orbitAttentionRank(agent: { state: OrbitState; wait: OrbitWait | null }) {
  if (agent.state === "waiting" && orbitWaitsForPerson(agent.wait)) return 0;
  switch (agent.state) {
    case "stalled":
      return 1;
    case "speaking":
      return 2;
    case "working":
      return 3;
    case "thinking":
      return 4;
    case "waiting":
      return 5;
    case "failed":
      return 6;
    case "done":
      return 7;
    default:
      return 8;
  }
}
