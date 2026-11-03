import { PICKER_PROVIDERS } from "./agent-providers";
import {
  AGENT_REASONING_EFFORTS,
  type AgentModelId,
  type AgentModelOption,
  type AgentReasoningEffort,
  defaultProviderModel,
} from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";

/** The model that the quick chat starts on when the Cultura Builder account lists it. It has no effort level. */
export const QUICK_CHAT_FAST_MODEL: AgentModelId = "cultura-builder/builder-fast";

/** The fields of a catalog model that the choice reads. */
type QuickChatModelOption = Pick<
  AgentModelOption,
  "provider" | "id" | "supportedReasoningEfforts" | "reasoningEffortConfigurable" | "fastServiceTier"
>;

/** What the quick chat agent runs on. No `reasoningEffort` means the model has no level to set. */
export interface QuickChatModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  /** Only for a model that has a fast tier. */
  fastMode?: true;
}

/** The lowest effort that the model accepts, or `undefined` when it has no effort setting. */
export function lowestAcceptedEffort(model: QuickChatModelOption): AgentReasoningEffort | undefined {
  if (model.reasoningEffortConfigurable === false) return undefined;
  return AGENT_REASONING_EFFORTS.find((effort) => model.supportedReasoningEfforts.includes(effort));
}

function choiceFor(model: QuickChatModelOption): QuickChatModelChoice {
  const reasoningEffort = lowestAcceptedEffort(model);
  return {
    provider: model.provider,
    model: model.id,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(model.fastServiceTier === undefined ? {} : { fastMode: true as const }),
  };
}

/**
 * The provider and model that the quick chat agent starts on, or `null` when no provider can run one.
 *
 * The providers go in picker order, which puts Cultura Builder first. A provider that is not available
 * is skipped. On Cultura Builder the fast model leads, else the first model of its list. On any other
 * provider the default model of that provider leads, else its first model. The effort is the lowest the
 * model accepts, and none for a model with no effort setting. Fast mode is on only for a model that has
 * a fast tier.
 *
 * `models` is what the providers list now, so a saved choice that left the list is not a candidate.
 */
export function quickChatDefaultModel(input: {
  models: readonly QuickChatModelOption[];
  providerAvailable: (provider: AgentProviderId) => boolean;
}): QuickChatModelChoice | null {
  for (const provider of PICKER_PROVIDERS) {
    if (!input.providerAvailable(provider)) continue;
    const listed = input.models.filter((model) => model.provider === provider);
    const preferred = provider === "cultura-builder" ? QUICK_CHAT_FAST_MODEL : defaultProviderModel(provider);
    const model = listed.find((candidate) => candidate.id === preferred) ?? listed[0];
    if (model) return choiceFor(model);
  }
  return null;
}

/** Whether the choice that the agent holds is still in the list of its provider. */
export function quickChatChoiceListed(
  held: { provider: AgentProviderId; model: AgentModelId },
  models: readonly Pick<AgentModelOption, "provider" | "id">[],
): boolean {
  return models.some((model) => model.provider === held.provider && model.id === held.model);
}
