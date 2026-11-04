import type { ChannelMember, ChannelTask } from "@buildersbot/contracts/ipc";
import { Button, buttonVariants } from "@buildersbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentPicker, type AgentPickerAgent } from "../agents/AgentPicker";

export function ChannelStoppedTasks(props: {
  tasks: Pick<ChannelTask, "id" | "ownerAgentId" | "error" | "startAttempts">[];
  members: Pick<ChannelMember, "agentId">[];
  name: (agentId: string | null) => string;
  /** The face, provider and model of a member, for the Reassign menu. Absent shows the names only. */
  agent?: ((agentId: string) => AgentPickerAgent | undefined) | undefined;
  onResume: (taskId: string, recipientAgentId: string | null) => Promise<boolean>;
  /**
   * Closes stopped runs for good, so nothing starts them again: not "Resume by itself" and not the task
   * reviewer, which only look at work that is still stopped. Absent hides Dismiss, as on a host that
   * is not this computer.
   */
  onDismiss?: ((taskIds: string[]) => Promise<unknown>) | undefined;
  /** The runs closed a moment ago, and the way to open them again. Shown for a few seconds. */
  undo?: { count: number; run: () => void } | undefined;
}) {
  const { t, sourceText } = useText();
  /** The members that can take the task: every member but its owner. */
  const reassignTo = (ownerAgentId: string | null): AgentPickerAgent[] =>
    props.members
      .filter((member) => member.agentId !== ownerAgentId)
      .map((member) => ({ ...props.agent?.(member.agentId), id: member.agentId, name: props.name(member.agentId) }));
  /** The tasks that Continue can start: a task whose owner left the channel needs Reassign. */
  const continuable = () =>
    props.tasks.filter(
      (task) => !task.ownerAgentId || props.members.some((member) => member.agentId === task.ownerAgentId),
    );
  return (
    <Show when={props.tasks.length || props.undo}>
      <div class="channel-paused-tasks">
        {/* With two or more stopped runs, one bar acts on all of them: after a "stop everything" the
            list can be long, and each row alone would take a click per run. */}
        <Show when={props.tasks.length > 1 && props.onDismiss}>
          {(dismiss) => (
            <section class="channel-paused-tasks-bar" aria-label={t("channel.stoppedTask.barLabel")}>
              <p class="channel-paused-tasks-count">
                {t("channel.stoppedTask.barCount", { count: props.tasks.length })}
              </p>
              <div class="channel-paused-task-actions">
                <Button
                  size="xs"
                  onClick={() => void Promise.all(continuable().map((task) => props.onResume(task.id, null)))}
                >
                  {t("channel.stoppedTask.continueAll")}
                </Button>
                <Button size="xs" onClick={() => void dismiss()(props.tasks.map((task) => task.id))}>
                  {t("channel.stoppedTask.dismissAll")}
                </Button>
              </div>
            </section>
          )}
        </Show>
        <Show when={props.undo}>
          {(undo) => (
            <div class="channel-paused-tasks-bar" role="status">
              <p class="channel-paused-tasks-count">{t("channel.stoppedTask.dismissed", { count: undo().count })}</p>
              <div class="channel-paused-task-actions">
                <Button size="xs" onClick={() => undo().run()}>
                  {t("channel.stoppedTask.undo")}
                </Button>
              </div>
            </div>
          )}
        </Show>
        <For each={props.tasks}>
          {(task) => (
            <section
              class="channel-paused-task"
              aria-label={t("channel.stoppedTask.label", { name: props.name(task.ownerAgentId) })}
            >
              <div class="channel-paused-task-reason">
                <p class="channel-paused-task-text">{task.error ? sourceText(task.error) : null}</p>
                {/* After the start retry: how many starts the app tried before it stopped. */}
                <Show when={task.startAttempts}>
                  {(count) => (
                    <p class="channel-paused-task-tries">{t("channel.stoppedTask.triedTimes", { count: count() })}</p>
                  )}
                </Show>
              </div>
              <div class="channel-paused-task-actions">
                {/* `resume` keeps the owner, and the service stops the task again when the owner left
                    the channel, so only Reassign can start it. */}
                <Show when={!task.ownerAgentId || props.members.some((member) => member.agentId === task.ownerAgentId)}>
                  <Button size="xs" onClick={() => void props.onResume(task.id, null)}>
                    {t("common.continue")}
                  </Button>
                </Show>
                <AgentPicker
                  agents={reassignTo(task.ownerAgentId)}
                  label={t("channel.stoppedTask.reassignLabel", { name: props.name(task.ownerAgentId) })}
                  triggerLabel={t("channel.stoppedTask.reassignLabel", { name: props.name(task.ownerAgentId) })}
                  triggerClass={buttonVariants({ variant: "ghost", size: "xs" })}
                  onChoose={(agent) => void props.onResume(task.id, agent.id)}
                >
                  {t("channel.stoppedTask.reassign")}
                </AgentPicker>
                <Show when={props.onDismiss}>
                  {(dismiss) => (
                    <Button size="xs" onClick={() => void dismiss()([task.id])}>
                      {t("channel.stoppedTask.dismiss")}
                    </Button>
                  )}
                </Show>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  );
}
