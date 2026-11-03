import { AgentMark, avatarMarkAccent } from "@buildersbot/brand/agent-mark";
import { createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { StageActorData } from "./StageActor";
import { arcPath, centerOf, type SeatPoint, type StageGeometry, seatPoint } from "./stage-geometry";
import { HAND_OFF_MS, prefersReducedMotion } from "./stage-motion";

/** A hand-off from one agent to another. `key` is its identity, such as the id of the task. */
export interface StageLinkData {
  key: string;
  from: string;
  to: string;
}

/** The dashed lines between the agents that hand work over, and the cube that flies once on each new line. */
export function StageLinks(props: {
  links: readonly StageLinkData[];
  actors: readonly StageActorData[];
  geometry: StageGeometry;
}) {
  const find = (id: string) => props.actors.find((candidate) => candidate.id === id);
  const point = (id: string): SeatPoint | undefined => {
    const actor = find(id);
    return actor ? seatPoint(actor.seat, props.geometry) : undefined;
  };
  return (
    <>
      <svg class="agent-stage-links" aria-hidden="true">
        <For each={props.links} keyed={(link) => link.key}>
          {(link) => {
            const path = () => {
              const from = point(link().from);
              const to = point(link().to);
              if (!from || !to) return "";
              return arcPath(centerOf(from), centerOf(to)).d;
            };
            return (
              <path
                class="agent-stage-link"
                d={path()}
                style={{ stroke: avatarMarkAccent(find(link().to)?.hue ?? null) }}
              />
            );
          }}
        </For>
      </svg>
      <For each={props.links} keyed={(link) => link.key}>
        {(link) => <StagePacket link={link()} actors={props.actors} geometry={props.geometry} />}
      </For>
    </>
  );
}

/**
 * The small cube that flies from the agent that hands a task over to the agent that gets it. It
 * flies once, when the link is new, and goes. A link that was there when the stage opened does not fly.
 */
function StagePacket(props: { link: StageLinkData; actors: readonly StageActorData[]; geometry: StageGeometry }) {
  const [flying, setFlying] = createSignal(true);
  let element: HTMLSpanElement | undefined;
  onSettled(() => {
    const from = untrack(() => props.actors.find((actor) => actor.id === props.link.from));
    const to = untrack(() => props.actors.find((actor) => actor.id === props.link.to));
    if (!element || !from || !to || prefersReducedMotion()) {
      setFlying(false);
      return;
    }
    const geometry = untrack(() => props.geometry);
    const start = centerOf(seatPoint(from.seat, geometry));
    const end = centerOf(seatPoint(to.seat, geometry));
    const arc = arcPath(start, end);
    const frames = Array.from({ length: 13 }, (_, index) => {
      const progress = index / 12;
      const rest = 1 - progress;
      const x = rest * rest * start.x + 2 * rest * progress * arc.middleX + progress * progress * end.x;
      const y = rest * rest * start.y + 2 * rest * progress * arc.middleY + progress * progress * end.y;
      const scale = 0.7 + Math.sin(Math.PI * progress) * 0.55;
      return {
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${Math.round(progress * 320)}deg) scale(${scale.toFixed(2)})`,
      };
    });
    const animation = element.animate(frames, {
      duration: HAND_OFF_MS,
      easing: "cubic-bezier(0.45, 0, 0.2, 1)",
      fill: "forwards",
    });
    animation.finished.then(
      () => setFlying(false),
      () => {},
    );
    return () => animation.cancel();
  });
  return (
    <Show when={flying()}>
      <span
        class="agent-stage-packet"
        aria-hidden="true"
        ref={(node) => {
          element = node;
        }}
      >
        <AgentMark
          animated={false}
          accent={avatarMarkAccent(props.actors.find((actor) => actor.id === props.link.from)?.hue ?? null)}
        />
      </span>
    </Show>
  );
}
