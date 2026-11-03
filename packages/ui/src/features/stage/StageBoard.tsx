/**
 * A board with a table, the agents round it and the links between them, drawn from data. It is the
 * part that the agent stage of a channel and a table of the feed have in common. It owns the little
 * state a board needs and nothing else: its size (from one shared observer), whether it is on screen
 * (from the shared visibility observer), the agents that are leaving, and the seats of the agents.
 * One attribute on its root pauses every loop while it is off screen or the window is hidden.
 */

import { avatarMarkAccent } from "@buildersbot/brand/agent-mark";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { observeOnScreen } from "../agents/AgentAvatar";
import { StageActor, type StageActorData } from "./StageActor";
import { type StageLinkData, StageLinks } from "./StageLinks";
import { StageTable } from "./StageTable";
import { type StageGeometry, seatPoint, stageGeometry } from "./stage-geometry";
import { observeSize } from "./stage-observers";
import { pickScanFocus } from "./stage-scan";

/** Up to this many agents, each has a bubble. Above it, only the first few (the ones that need attention). */
const BUBBLE_ALL = 4;
const BUBBLE_FOCUS = 3;

export interface StageBoardProps {
  actors: readonly StageActorData[];
  links?: readonly StageLinkData[] | undefined;
  /** Whether the agents have a speech bubble. The feed draws none. */
  bubbles?: boolean | undefined;
  /** The table shows a slow laser scan while an agent works. The stage of a channel sets it; the feed does not. */
  scan?: boolean | undefined;
  /** The widest the table gets, in pixels. */
  maxTable?: number | undefined;
  /** The window is hidden: the caller reads the page visibility once and passes it to every board. */
  suspended?: boolean | undefined;
  /** Makes each cube a button. `selected` is the id of the agent that the caller has chosen. */
  onSelectActor?: ((id: string) => void) | undefined;
  selectedActor?: string | null | undefined;
  selectLabel?: ((actor: StageActorData) => string) | undefined;
  /** Drawn on the table, under the agents. It gets the geometry of the board. */
  overlay?: ((geometry: StageGeometry) => JSX.Element) | undefined;
  /** Drawn over the agents, such as a "+N" chip. */
  children?: JSX.Element;
  class?: string | undefined;
}

export function StageBoard(props: StageBoardProps) {
  const [onScreen, setOnScreen] = createSignal(true);
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [leaving, setLeaving] = createSignal<readonly StageActorData[]>([]);
  let root: HTMLElement | undefined;
  let previous: readonly StageActorData[] = [];

  onSettled(() => {
    if (!root) return;
    const stopOnScreen = observeOnScreen(root, setOnScreen);
    const stopSize = observeSize(root, (width, height) =>
      setSize((current) => (current.width === width && current.height === height ? current : { width, height })),
    );
    return () => {
      stopOnScreen();
      stopSize();
    };
  });

  // An agent that left plays its exit once from its last place, then its element goes.
  createEffect(
    () => props.actors,
    (actors) => {
      const ids = new Set(actors.map((actor) => actor.id));
      const gone = previous.filter((actor) => !ids.has(actor.id));
      previous = actors;
      if (gone.length > 0 || untrack(leaving).length > 0)
        setLeaving((current) => [...current.filter((actor) => !ids.has(actor.id)), ...gone]);
    },
  );

  const geometry = createMemo(() => stageGeometry(size().width, size().height, props.maxTable));
  const ready = () => size().width > 0 && size().height > 0;
  const paused = () => !onScreen() || props.suspended === true;
  /** An agent works now: not a wait, a failure or a finished run. */
  const working = () =>
    props.scan === true &&
    props.actors.some(
      (actor) => actor.activity !== "waiting" && actor.activity !== "failed" && actor.activity !== "done",
    );
  const scanFocus = createMemo(
    () =>
      props.scan === true
        ? pickScanFocus(
            props.actors.map((actor) => ({
              id: actor.id,
              color: avatarMarkAccent(actor.hue),
              seat: actor.seat,
              activity: actor.activity,
            })),
          )
        : null,
    { equals: (a, b) => a?.id === b?.id && a?.seat === b?.seat && a?.color === b?.color },
  );
  const find = (id: string | null) => (id === null ? undefined : props.actors.find((actor) => actor.id === id));

  return (
    <div
      class={["agent-stage-board", props.class]}
      ref={(element) => {
        root = element;
      }}
      data-paused={paused() ? "" : undefined}
    >
      <Show when={ready()}>
        <StageTable geometry={geometry()} scan={props.scan} working={working()} focus={scanFocus()} />
        {props.overlay?.(geometry())}
        <StageLinks links={props.links ?? []} actors={props.actors} geometry={geometry()} />
        <ul class="agent-stage-actors">
          <For each={props.actors} keyed={(actor) => actor.id}>
            {(actor, index) => (
              <StageActor
                actor={actor()}
                geometry={geometry()}
                bubble={props.bubbles !== false && (props.actors.length <= BUBBLE_ALL || index() < BUBBLE_FOCUS)}
                delegateName={find(actor().delegatesTo)?.name ?? ""}
                onSelect={props.onSelectActor ? () => props.onSelectActor?.(actor().id) : undefined}
                selected={props.selectedActor === actor().id}
                selectLabel={props.selectLabel?.(actor())}
                targetX={(() => {
                  const target = find(actor().delegatesTo);
                  return target ? seatPoint(target.seat, geometry()).x : null;
                })()}
              />
            )}
          </For>
          <For each={leaving()} keyed={(actor) => actor.id}>
            {(actor) => (
              <StageActor
                actor={actor()}
                geometry={geometry()}
                delegateName=""
                targetX={null}
                leaving
                onGone={() => setLeaving((current) => current.filter((candidate) => candidate.id !== actor().id))}
              />
            )}
          </For>
        </ul>
        {props.children}
      </Show>
    </div>
  );
}
