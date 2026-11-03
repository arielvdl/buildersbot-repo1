import type { ChannelTask } from "@buildersbot/contracts/ipc";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { Button } from "../../button";
import { useText } from "../../text";

/**
 * The queued requests of this tab that wait, one quiet line each with the reason
 * (`ChannelTask.wait`): the earlier request of the tab, the agent's place among its parallel tabs, a
 * computer low on memory, or the agent's own chat. A request with no reason shows nothing here.
 * The lines start folded under one summary, so they take no room above the composer. A reader who
 * opens them keeps them open while the notice stays on screen.
 */
export function ChannelTaskWaitNotice(props: {
  tasks: Pick<ChannelTask, "id" | "ownerAgentId" | "wait">[];
  name: (agentId: string | null) => string;
}) {
  const { t } = useText();
  const listId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const line = (task: Pick<ChannelTask, "ownerAgentId" | "wait">) => {
    const wait = task.wait;
    const name = props.name(task.ownerAgentId);
    switch (wait?.reason) {
      case "tab":
        return t("channel.task.wait.tab", { name });
      case "agent-tabs":
        return t("channel.task.wait.agentTabs", { name, count: wait.busy ?? wait.limit ?? 1 });
      case "memory":
        return t("channel.task.wait.memory");
      case "agent-chat":
        return t("channel.task.wait.agentChat", { name });
      default:
        return "";
    }
  };
  return (
    <Show when={props.tasks.length}>
      <div class="channel-task-waits">
        <Button
          variant="unstyled"
          type="button"
          class="channel-task-waits-toggle"
          aria-expanded={open() ? "true" : "false"}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{t("channel.task.wait.summary", { count: props.tasks.length })}</span>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-open={open() ? "" : undefined}>
            <path
              d="m6 4 4 4-4 4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </Button>
        <Show when={open()}>
          <ul id={listId} class="channel-task-wait-list">
            <For each={props.tasks}>
              {(task) => (
                <li class="channel-task-wait" role="status">
                  {line(task)}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
