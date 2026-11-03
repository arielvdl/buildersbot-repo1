import type { ChannelTask } from "@buildersbot/contracts/ipc";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { Button } from "../../button";
import { ChevronRight, Clock3 } from "../../icons";
import { useText } from "../../text";

/**
 * The queued requests of this tab that wait for a reason that nothing else on screen shows
 * (`ChannelTask.wait`): the agent's place among its parallel tabs, a computer low on memory, or the
 * agent's own chat. Without it, such a request looks dropped. A request that waits for the earlier
 * request of its tab is not here: the activity line or the stage already shows that work.
 *
 * It is one quiet line above the message field, an icon and a count, that opens to the reason of each.
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
          aria-controls={open() ? listId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <Clock3 class="channel-task-waits-icon" aria-hidden="true" />
          <span>{t("channel.task.wait.summary", { count: props.tasks.length })}</span>
          <ChevronRight class="channel-task-waits-chevron" aria-hidden="true" />
        </Button>
        <Show when={open()}>
          <ul id={listId} class="channel-task-wait-list">
            <For each={props.tasks}>{(task) => <li class="channel-task-wait">{line(task)}</li>}</For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
