/**
 * The agents that a Quick chat conversation called, at the top of the conversation. A thin strip by
 * default: the agents' marks, who does what now, and how many are done. The button unfolds it into the
 * same stage that a channel has, with the agents round the table. Everything here is data in, drawing
 * out: the desktop reads the conversation's requests and gives the actors.
 */

import { For, Show } from "solid-js";
import { Button } from "../../button";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { createTaskListPlayState } from "../conversation/TaskList";
import type { StageActorData } from "../stage/StageActor";
import { StageBoard } from "../stage/StageBoard";
import type { StageLinkData } from "../stage/StageLinks";
import "../stage/agent-stage.css";
import "./quick-chat-agent-strip.css";

export type QuickChatStripState = "asked" | "working" | "replied" | "failed";

export interface QuickChatStripAgent {
  id: string;
  name: string;
  /** The profile fields of the mark. A remote or removed agent has none and gets a mark from its name. */
  avatar?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl"> | undefined;
  state: QuickChatStripState;
  /** What the agent does now, in the host's English source text. */
  line: string | null;
}

export interface QuickChatAgentStripProps {
  agents: readonly QuickChatStripAgent[];
  /** The agents and the Quick chat agent as they stand round the table when the strip unfolds. */
  actors: readonly StageActorData[];
  links: readonly StageLinkData[];
  /** Every agent has answered or failed: the strip says so for a moment, then the host removes it. */
  finished: boolean;
  open: boolean;
  onToggle: () => void;
}

const MOOD = { asked: "waiting", working: "working", replied: "responded", failed: "failed" } as const;

export function QuickChatAgentStrip(props: QuickChatAgentStripProps) {
  const { t, sourceText } = useText();
  const playState = createTaskListPlayState();
  const done = () => props.agents.filter((agent) => agent.state === "replied" || agent.state === "failed").length;
  /** The agent to name in the strip: the first one that works, else the first one that waits. */
  const focus = () =>
    props.agents.find((agent) => agent.state === "working") ?? props.agents.find((agent) => agent.state === "asked");
  const summary = () => {
    if (props.finished) return t("quick.agents.finished", { count: props.agents.length });
    const agent = focus();
    if (!agent) return t("quick.agents.calling");
    const what = agent.line
      ? sourceText(agent.line)
      : agent.state === "asked"
        ? t("chat.awaiting.state.asked")
        : t("chat.awaiting.state.working");
    return `${agent.name}: ${what}`;
  };
  const label = () => (props.open ? t("quick.agents.fold") : t("quick.agents.unfold"));

  return (
    <section
      class="quick-agent-strip"
      aria-label={t("quick.agents.label")}
      data-open={props.open ? "" : undefined}
      data-finished={props.finished ? "" : undefined}
    >
      <div class="quick-agent-strip-bar" role="status" aria-live="polite">
        <span class="quick-agent-strip-live" aria-hidden="true" />
        <span class="quick-agent-strip-marks" aria-hidden="true">
          <For each={props.agents.slice(0, 5)}>
            {(agent) => (
              <span class="quick-agent-strip-mark" data-state={agent.state}>
                <AgentAvatar
                  agent={agent.avatar}
                  seed={agent.avatar ? undefined : agent.name}
                  mood={MOOD[agent.state]}
                  class="quick-agent-strip-avatar"
                />
              </span>
            )}
          </For>
        </span>
        <span class="quick-agent-strip-text">{summary()}</span>
        <span class="quick-agent-strip-bars" aria-hidden="true">
          <For each={props.agents.map((agent) => agent.state)}>{(state) => <i data-state={state} />}</For>
        </span>
        <span class="quick-agent-strip-count">
          {t("quick.agents.count", { done: done(), total: props.agents.length })}
        </span>
        <Button
          variant="unstyled"
          type="button"
          class="quick-agent-strip-toggle"
          aria-expanded={props.open ? "true" : "false"}
          aria-label={label()}
          title={label()}
          onClick={() => props.onToggle()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" data-open={props.open ? "" : undefined}>
            <path
              d="M4 6.5 8 10l4-3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </Button>
      </div>
      <Show when={props.open}>
        <div class="quick-agent-strip-stage">
          <StageBoard actors={props.actors} links={props.links} suspended={playState() === "paused"} />
        </div>
      </Show>
    </section>
  );
}
