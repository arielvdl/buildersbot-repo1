import { ProviderLogo } from "@buildersbot/brand";
import { AgentMark, type AgentMarkActivity, avatarMarkAccent } from "@buildersbot/brand/agent-mark";
import type { AgentProviderRef } from "@buildersbot/contracts/agent-providers";
import type { AvatarHue } from "@buildersbot/contracts/ipc";
import type { AppTextKey } from "@buildersbot/i18n";
import { Button } from "@buildersbot/ui";
import { createMemo, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { orbitFamily } from "../agents/agent-model-family";
import { StageActorEffects } from "./StageActorEffects";
import type { StageActivity } from "./stage-activity";
import { FIGURE_HEIGHT, FIGURE_WIDTH, type StageGeometry, seatIsFront, seatPoint, seatSide } from "./stage-geometry";
import { ENTER_EASING, ENTER_MS, FADE_MS, LEAVE_MS, prefersReducedMotion } from "./stage-motion";

/** One agent on a stage: who it is, what it does, and where it sits. */
export interface StageActorData {
  id: string;
  name: string;
  provider: AgentProviderRef | null;
  model: string | null;
  hue: AvatarHue | null;
  activity: StageActivity;
  /** The host's English progress line. Without one, the bubble says what the activity is. */
  line: string | null;
  /** The agent that gets the work, while this one delegates. */
  delegatesTo: string | null;
  /** The seat round the table, 0 to 7. The lead sits at the back (0). */
  seat: number;
}

export const STAGE_ACTIVITY_LABEL = {
  reading: "channel.stage.activity.reading",
  thinking: "channel.stage.activity.thinking",
  editing: "channel.stage.activity.editing",
  running: "channel.stage.activity.running",
  delegating: "channel.stage.activity.delegating",
  waiting: "channel.stage.activity.waiting",
  failed: "channel.stage.activity.failed",
  done: "channel.stage.activity.done",
} as const satisfies Record<StageActivity, AppTextKey>;
const ACTIVITY_LABEL = STAGE_ACTIVITY_LABEL;

const ACTIVITY_SAY = {
  reading: "channel.stage.say.reading",
  thinking: "channel.stage.say.thinking",
  editing: "channel.stage.say.editing",
  running: "channel.stage.say.running",
  waiting: "channel.stage.say.waiting",
  failed: "channel.stage.say.failed",
  done: "channel.stage.say.done",
} as const satisfies Record<Exclude<StageActivity, "delegating">, AppTextKey>;

/** How far the eyelids come down for each activity. 0 is wide open. */
const ACTIVITY_EYELID: Readonly<Record<StageActivity, number>> = {
  reading: 0.2,
  thinking: 0.3,
  editing: 0.06,
  running: 0,
  delegating: 0.1,
  waiting: 0,
  failed: 0.92,
  done: 0.1,
};

const BUBBLE_MIN = 96;
const BUBBLE_MAX = 210;
const BUBBLE_EDGE = 12;

function markActivity(activity: StageActivity): AgentMarkActivity | undefined {
  return activity === "waiting" || activity === "failed" ? undefined : activity;
}

export function StageActor(props: {
  actor: StageActorData;
  geometry: StageGeometry;
  delegateName: string;
  /** Whether the speech bubble shows. A crowded stage gives it to the agents that need attention first. */
  bubble?: boolean;
  /** The x of the agent that gets the work, so a delegating agent leans toward it. */
  targetX: number | null;
  leaving?: boolean;
  onGone?: () => void;
  /** Makes the cube a button, such as to filter the feed by this agent. */
  onSelect?: (() => void) | undefined;
  selected?: boolean | undefined;
  selectLabel?: string | undefined;
}) {
  const { t, sourceText } = useText();
  let figure: HTMLDivElement | undefined;
  let hop: HTMLDivElement | undefined;
  const place = createMemo(() => seatPoint(props.actor.seat, props.geometry));
  const family = createMemo(() =>
    props.actor.provider && props.actor.model ? orbitFamily(props.actor.provider, props.actor.model) : null,
  );
  const logo = () => {
    const found = family();
    if (!found) return null;
    if (found.kind === "tier") return "claude" as const;
    return found.kind === "provider" ? found.id : null;
  };
  const modelName = () => family()?.name ?? props.actor.model ?? "";
  const anchor = () => seatSide(props.actor.seat);
  /** The room between the figure and the edge of the stage on the side where the bubble opens. */
  const bubbleMax = () => {
    const figure = FIGURE_WIDTH * place().scale;
    const room = anchor() === "right" ? props.geometry.width - place().x - figure / 2 : place().x - figure / 2;
    return Math.round(Math.max(BUBBLE_MIN, Math.min(BUBBLE_MAX, room - BUBBLE_EDGE)));
  };
  const say = () => {
    const actor = props.actor;
    if (actor.activity === "delegating")
      return props.delegateName
        ? t("channel.stage.say.delegating", { name: props.delegateName })
        : t("channel.stage.say.delegatingGeneric");
    return actor.line ? sourceText(actor.line) : t(ACTIVITY_SAY[actor.activity]);
  };
  const mood = () =>
    props.actor.activity === "waiting"
      ? "waiting"
      : props.actor.activity === "failed"
        ? "failed"
        : props.actor.activity === "done"
          ? "responded"
          : "idle";
  const lean = () => {
    const target = props.targetX;
    if (props.actor.activity !== "delegating" || target === null) return undefined;
    return target < place().x ? "left" : "right";
  };

  // The arrival, the exit and the celebration are Web Animations that this actor owns. They end with
  // the actor, so nothing runs for an agent that is gone.
  onSettled(() => {
    const animations: Animation[] = [];
    if (figure) {
      if (props.leaving) {
        const exit = figure.animate(
          prefersReducedMotion()
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { transform: "none", opacity: 1 },
                { transform: "translateY(34px) scale(0.5)", opacity: 0 },
              ],
          {
            duration: prefersReducedMotion() ? FADE_MS : LEAVE_MS,
            easing: "cubic-bezier(0.5, 0, 0.75, 0)",
            fill: "forwards",
          },
        );
        exit.finished.then(
          () => props.onGone?.(),
          () => {},
        );
        animations.push(exit);
      } else {
        animations.push(
          figure.animate(
            prefersReducedMotion()
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [
                  { transform: "translateY(80px) scale(0.35)", opacity: 0 },
                  { transform: "none", opacity: 1 },
                ],
            { duration: prefersReducedMotion() ? FADE_MS : ENTER_MS, easing: ENTER_EASING, fill: "backwards" },
          ),
        );
      }
    }
    return () => {
      for (const animation of animations) animation.cancel();
    };
  });
  onSettled(() => {
    const activity = props.actor.activity;
    if (!hop || props.leaving || prefersReducedMotion() || (activity !== "done" && activity !== "failed")) return;
    const animation = hop.animate(
      activity === "done"
        ? [
            { transform: "none", easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
            {
              transform: "translateY(-24px) scale(1.04, 0.98)",
              offset: 0.36,
              easing: "cubic-bezier(0.6, 0, 0.9, 0.5)",
            },
            { transform: "scale(1.1, 0.88)", offset: 0.62 },
            { transform: "scale(0.98, 1.03)", offset: 0.8 },
            { transform: "none" },
          ]
        : [
            { transform: "none" },
            { transform: "translateX(-7px) rotate(-5deg)" },
            { transform: "translateX(7px) rotate(5deg)" },
            { transform: "translateX(-5px) rotate(-3deg)" },
            { transform: "translateX(4px) rotate(2deg)" },
            { transform: "none" },
          ],
      { duration: activity === "done" ? 760 : 560, easing: "ease-out" },
    );
    return () => animation.cancel();
  });

  return (
    <li
      class="agent-stage-actor"
      data-activity={props.actor.activity}
      data-anchor={anchor()}
      data-front={seatIsFront(props.actor.seat) ? "" : undefined}
      data-lean={lean()}
      data-leaving={props.leaving ? "" : undefined}
      data-selected={props.selected ? "" : undefined}
      aria-label={`${props.actor.name}, ${t(ACTIVITY_LABEL[props.actor.activity])}`}
      style={{
        left: `${place().x}px`,
        top: `${place().y}px`,
        "z-index": place().y,
        "--stage-width": `${Math.round(FIGURE_WIDTH * place().scale)}px`,
        "--stage-height": `${Math.round(FIGURE_HEIGHT * place().scale)}px`,
        "--stage-scale": String(place().scale),
        "--stage-accent": avatarMarkAccent(props.actor.hue),
        "--stage-bubble-max": `${bubbleMax()}px`,
      }}
    >
      <div
        class="agent-stage-figure"
        ref={(node) => {
          figure = node;
        }}
      >
        <Show when={logo() || modelName()}>
          <span class="agent-stage-model" aria-hidden="true">
            <Show when={logo()}>
              {(provider) => <ProviderLogo class="agent-stage-model-logo" provider={provider()} />}
            </Show>
            <span>{modelName()}</span>
          </span>
        </Show>
        <div
          class="agent-stage-hop"
          ref={(node) => {
            hop = node;
          }}
        >
          <div class="agent-stage-body">
            <AgentMark
              class="agent-stage-mark"
              animated={false}
              mood={mood()}
              activity={markActivity(props.actor.activity)}
              accent={avatarMarkAccent(props.actor.hue)}
              style={{ "--agent-mark-eyelid": String(ACTIVITY_EYELID[props.actor.activity]) }}
            />
            <StageActorEffects activity={props.actor.activity} />
          </div>
        </div>
      </div>
      <Show when={props.onSelect && !props.leaving}>
        <Button
          variant="ghost"
          type="button"
          class="agent-stage-hit"
          aria-label={props.selectLabel ?? props.actor.name}
          aria-pressed={props.selected ? "true" : "false"}
          onClick={() => props.onSelect?.()}
        />
      </Show>
      <Show when={!props.leaving && props.bubble !== false}>
        <div class="agent-stage-bubble" data-tone={props.actor.activity}>
          <Show
            when={
              props.actor.activity === "waiting" || props.actor.activity === "failed" || props.actor.activity === "done"
            }
          >
            <span class="agent-stage-bubble-tone">{t(ACTIVITY_LABEL[props.actor.activity])}</span>
          </Show>
          <Show when={say()} keyed>
            {(sentence) => <span class="agent-stage-bubble-text">{sentence}</span>}
          </Show>
        </div>
      </Show>
      <span class="agent-stage-name" aria-hidden="true">
        <span class="agent-stage-name-text">{props.actor.name}</span>
        <span class="agent-stage-verb">{t(ACTIVITY_LABEL[props.actor.activity])}</span>
      </span>
    </li>
  );
}
