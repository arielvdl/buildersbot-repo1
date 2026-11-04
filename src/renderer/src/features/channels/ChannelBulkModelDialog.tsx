import { isKnownAgentProvider } from "@buildersbot/contracts/agent-providers";
import type { AgentModelId, AgentProviderId, AgentReasoningEffort } from "@buildersbot/contracts/ipc";
import { Alert, AlertDescription, Button, Dialog, ErrorReference, IconButton, X } from "@buildersbot/ui";
import { ProviderModelPicker } from "@buildersbot/ui/components/ProviderModelPicker";
import type { AgentProfile } from "@buildersbot/ui/data";
import { useText } from "@buildersbot/ui/text";
import { errorReference } from "@buildersbot/user-errors";
import { createEffect, createSignal, Show } from "solid-js";
import { useProviders } from "../../providers";
import { useAgents } from "../agents/agents-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useServers } from "../servers/servers-context";

interface ChannelBulkModelDialogProps {
  open: boolean;
  /** The members that get the model. The dialog opens on the model of the first one. */
  members: readonly AgentProfile[];
  onClose: () => void;
}

interface RuntimeDraft {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

/**
 * One model for several channel members. It reuses the picker of the member form, so the choices,
 * the sign-in state of a provider and the effort list are the ones the reader already knows.
 */
export function ChannelBulkModelDialog(props: ChannelBulkModelDialogProps) {
  const agents = useAgents();
  const providers = useProviders();
  const { customProviders } = useCustomProviders();
  const { customAgents } = useCustomAgents();
  const { activeServer } = useServers();
  const { t, errorMessage } = useText();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<{ message: string; reference: string | null } | null>(null);
  const [draft, setDraft] = createSignal<RuntimeDraft>({ provider: "codex", model: "", reasoningEffort: "medium" });

  // Refilled each time the dialog opens, from the first member who will be changed.
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setError(null);
      setBusy(false);
      const first = props.members[0];
      if (first)
        setDraft({
          provider: isKnownAgentProvider(first.provider) ? first.provider : "codex",
          model: first.model,
          reasoningEffort: first.reasoningEffort,
        });
    },
  );

  function pickModel(model: AgentModelId, provider: AgentProviderId) {
    const option = agents.modelOptions().find((item) => item.provider === provider && item.id === model);
    setDraft({ provider, model, reasoningEffort: option?.defaultReasoningEffort ?? "medium" });
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy() || !props.members.length) return;
    const runtime = draft();
    setBusy(true);
    setError(null);
    // One member at a time: a failure names how many were left, and the ones already changed stay so.
    const failed: AgentProfile[] = [];
    let lastFailure: unknown;
    for (const member of props.members) {
      try {
        await agents.updateAgent(member.id, runtime);
      } catch (failure) {
        failed.push(member);
        lastFailure = failure;
      }
    }
    setBusy(false);
    if (!failed.length) {
      props.onClose();
      return;
    }
    setError({
      message: errorMessage(lastFailure, t("channel.members.bulk.modelFailed", { count: failed.length })),
      reference: errorReference(lastFailure),
    });
  }

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="channel-dialog-backdrop">
          <Dialog.Content class="channel-create-dialog channel-member-dialog channel-bulk-model-dialog">
            <header class="channel-dialog-header">
              <Dialog.Title>{t("channel.members.bulk.modelTitle", { count: props.members.length })}</Dialog.Title>
              <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
                <X />
              </IconButton>
            </header>
            <form class="channel-create-form channel-member-form" onSubmit={(event) => void submit(event)}>
              <p class="channel-member-form-note">{t("channel.members.bulk.modelNote")}</p>
              <Show when={error()}>
                {(failure) => (
                  <Alert tone="danger" role="alert">
                    <AlertDescription>
                      {failure().message}
                      <ErrorReference reference={failure().reference} />
                    </AlertDescription>
                  </Alert>
                )}
              </Show>
              <div class="agent-settings-runtime-rows channel-member-runtime">
                <ProviderModelPicker
                  variant="field"
                  inline
                  ariaLabel={t("agentSettings.runtime.model")}
                  provider={draft().provider}
                  value={draft().model}
                  reasoningEffort={draft().reasoningEffort}
                  onReasoningEffortChange={(reasoningEffort) =>
                    setDraft((current) => ({ ...current, reasoningEffort }))
                  }
                  agentStatus={agents.agentStatus()}
                  modelOptions={agents.modelOptions()}
                  runtimeStatuses={
                    providers.providerRuntimeDownloadsAvailable() ? providers.providerRuntimeStatuses() : undefined
                  }
                  customProviders={customProviders()}
                  customAgents={activeServer()?.kind === "local" ? customAgents() : undefined}
                  onDownloadProvider={
                    providers.providerRuntimeDownloadsAvailable() ? providers.downloadProviderRuntime : undefined
                  }
                  onCancelProviderDownload={
                    providers.providerRuntimeDownloadsAvailable() ? providers.cancelProviderRuntimeDownload : undefined
                  }
                  onConnectProvider={providers.connectProvider}
                  disabledReason={t("agentSettings.runtime.modelUnavailable")}
                  onChange={(model, provider) => pickModel(model, provider)}
                />
              </div>
              <footer class="channel-editor-footer">
                <Button type="button" variant="ghost" onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={!draft().model || !props.members.length} loading={busy()}>
                  {t("channel.members.bulk.modelApply", { count: props.members.length })}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
