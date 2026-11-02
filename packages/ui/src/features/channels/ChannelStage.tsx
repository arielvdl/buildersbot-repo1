/**
 * The agent stage of a channel: the agents that work stand round a table with the request on it,
 * each one with the symbol and the motion of what it does and a speech bubble for its last step.
 * Everything here is data in, drawing out. The desktop reads the channel and gives the actors, so
 * the stage adds no store, no event subscription and no copy of the messages.
 *
 * It is made to cost almost nothing. The table and the request are static. Each actor moves with CSS
 * keyframes on `transform` only, and the one-time moves (arrive, leave, celebrate, hand-off) are Web
 * Animations that the actor cancels when it goes. Seats come from the size of the board, which a single
 * `ResizeObserver` reports. One attribute on the root pauses every animation while the stage is off
 * screen or the window is hidden. While nobody works and the stage is folded, it draws a strip and
 * nothing else: no observer, no animation.
 */

import { ProviderLogo } from "@buildersbot/brand";
import { AgentMark, type AgentMarkActivity, avatarMarkAccent } from "@buildersbot/brand/agent-mark";
import type { AgentProviderRef } from "@buildersbot/contracts/agent-providers";
import type { AvatarHue } from "@buildersbot/contracts/ipc";
import type { AppTextKey } from "@buildersbot/i18n";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { springLinearEasing } from "../../spring-motion";
import { useText } from "../../text";
import { observeOnScreen } from "../agents/AgentAvatar";
import { createTaskListPlayState } from "../conversation/TaskList";
import { orbitFamily } from "../orbits/orbits-view";
import "./channel-stage.css";

export type ChannelStageActivity =
  | "reading"
  | "thinking"
  | "editing"
  | "running"
  | "delegating"
  | "waiting"
  | "failed"
  | "done";

export interface ChannelStageActor {
  id: string;
  name: string;
  provider: AgentProviderRef | null;
  model: string | null;
  hue: AvatarHue | null;
  activity: ChannelStageActivity;
  /** The host's English progress line. Without one, the bubble says what the activity is. */
  line: string | null;
  /** The agent that gets the work, while this one delegates. */
  delegatesTo: string | null;
  /** The seat round the table, 0 to 7. The lead sits at the back (0). */
  seat: number;
}

export interface ChannelStageRequest {
  title: string;
  parts: number;
  done: number;
}

export interface ChannelStageLink {
  key: string;
  from: string;
  to: string;
}

export interface ChannelStageProps {
  actors: readonly ChannelStageActor[];
  overflow: number;
  request: ChannelStageRequest | null;
  links: readonly ChannelStageLink[];
  /** Fold the stage into a strip. The desktop sets it while nobody works and the reader chose to fold. */
  collapsed: boolean;
}

const ACTIVITY_LABEL = {
  reading: "channel.stage.activity.reading",
  thinking: "channel.stage.activity.thinking",
  editing: "channel.stage.activity.editing",
  running: "channel.stage.activity.running",
  delegating: "channel.stage.activity.delegating",
  waiting: "channel.stage.activity.waiting",
  failed: "channel.stage.activity.failed",
  done: "channel.stage.activity.done",
} as const satisfies Record<ChannelStageActivity, AppTextKey>;

const ACTIVITY_SAY = {
  reading: "channel.stage.say.reading",
  thinking: "channel.stage.say.thinking",
  editing: "channel.stage.say.editing",
  running: "channel.stage.say.running",
  waiting: "channel.stage.say.waiting",
  failed: "channel.stage.say.failed",
  done: "channel.stage.say.done",
} as const satisfies Record<Exclude<ChannelStageActivity, "delegating">, AppTextKey>;

/** How far the eyelids come down for each activity. 0 is wide open. */
const ACTIVITY_EYELID: Readonly<Record<ChannelStageActivity, number>> = {
  reading: 0.2,
  thinking: 0.3,
  editing: 0.06,
  running: 0,
  delegating: 0.1,
  waiting: 0,
  failed: 0.92,
  done: 0.1,
};

/** The seats as a direction from the middle of the table, in half-table units. The lead takes the first. */
const SEATS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
  [-0.72, 0.72],
  [0.72, 0.72],
  [-0.72, -0.72],
  [0.72, -0.72],
];

/** Up to this many agents, each has a bubble. Above it, only the first few (the ones that need attention). */
const BUBBLE_ALL = 4;
const BUBBLE_FOCUS = 3;
const BUBBLE_MIN = 96;
const BUBBLE_MAX = 210;
const BUBBLE_EDGE = 12;
const FIGURE_WIDTH = 100;
const FIGURE_HEIGHT = 108;
const TABLE_RATIO = 0.5774;
const TABLE_DEPTH = 16;
const TABLE_GRID = 6;

/** A spring that settles a little past its end: the arrival of an agent. Computed once, at load. */
const ENTER_EASING = supportsLinearEasing()
  ? springLinearEasing({ response: 0.5, dampingFraction: 0.62 })
  : "cubic-bezier(0.34, 1.2, 0.64, 1)";
const ENTER_MS = 500;
const LEAVE_MS = 340;
const FADE_MS = 120;
const HAND_OFF_MS = 700;

function supportsLinearEasing(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("animation-timing-function", "linear(0, 1)")
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

interface Geometry {
  width: number;
  height: number;
  tableWidth: number;
  tableHeight: number;
  centerX: number;
  centerY: number;
  /** The size of every figure, so a short stage keeps its agents apart. */
  fit: number;
}

function stageGeometry(width: number, height: number): Geometry {
  const tableWidth = Math.max(120, Math.min(380, width * 0.4, (height * 0.5) / TABLE_RATIO));
  return {
    width,
    height,
    tableWidth,
    tableHeight: tableWidth * TABLE_RATIO,
    centerX: width / 2,
    centerY: height * 0.52,
    fit: Math.max(0.62, Math.min(1, height / 380)),
  };
}

interface SeatPoint {
  x: number;
  y: number;
  scale: number;
}

function seatPoint(seat: number, geometry: Geometry): SeatPoint {
  const [sx, sy] = SEATS[seat] ?? SEATS[0] ?? [0, -1];
  return {
    x: Math.round(geometry.centerX + sx * (geometry.tableWidth / 2 + 44)),
    y: Math.round(geometry.centerY + sy * (geometry.tableHeight / 2 + 18) + 20),
    scale: (0.6 + 0.2 * ((sy + 1) / 2)) * geometry.fit,
  };
}

export function ChannelStage(props: ChannelStageProps) {
  const { t } = useText();
  return (
    <div class="channel-stage-frame">
      <section
        class="channel-stage"
        aria-label={t("channel.stage.label")}
        data-collapsed={props.collapsed ? "" : undefined}
      >
        <Show when={!props.collapsed} fallback={<p class="channel-stage-strip">{t("channel.stage.empty")}</p>}>
          <StageBoard {...props} />
        </Show>
      </section>
    </div>
  );
}

function StageBoard(props: ChannelStageProps) {
  const { t } = useText();
  const playState = createTaskListPlayState();
  const [onScreen, setOnScreen] = createSignal(true);
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [leaving, setLeaving] = createSignal<readonly ChannelStageActor[]>([]);
  let root: HTMLElement | undefined;
  let previous: readonly ChannelStageActor[] = [];

  onSettled(() => {
    if (!root) return;
    const stopOnScreen = observeOnScreen(root, setOnScreen);
    // One observer for the board. It reports once for each frame that changed the size.
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(root);
    return () => {
      stopOnScreen();
      observer.disconnect();
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

  const geometry = createMemo(() => stageGeometry(size().width, size().height));
  const ready = () => size().width > 0 && size().height > 0;
  const paused = () => !onScreen() || playState() === "paused";
  const accentOf = (id: string) => {
    const actor = props.actors.find((candidate) => candidate.id === id);
    return avatarMarkAccent(actor?.hue ?? null);
  };
  const point = (id: string): SeatPoint | undefined => {
    const actor = props.actors.find((candidate) => candidate.id === id);
    return actor ? seatPoint(actor.seat, geometry()) : undefined;
  };

  return (
    <div
      class="channel-stage-board"
      ref={(element) => {
        root = element;
      }}
      data-paused={paused() ? "" : undefined}
    >
      <Show when={ready()}>
        <StageTable geometry={geometry()} />
        <Show when={props.request}>{(request) => <StageRequest request={request()} geometry={geometry()} />}</Show>
        <svg class="channel-stage-links" aria-hidden="true">
          <For each={props.links} keyed={(link) => link.key}>
            {(link) => {
              const path = () => {
                const from = point(link().from);
                const to = point(link().to);
                if (!from || !to) return "";
                return arcPath(centerOf(from), centerOf(to)).d;
              };
              return <path class="channel-stage-link" d={path()} style={{ stroke: accentOf(link().to) }} />;
            }}
          </For>
        </svg>
        <For each={props.links} keyed={(link) => link.key}>
          {(link) => <StagePacket link={link()} actors={props.actors} geometry={geometry()} />}
        </For>
        <ul class="channel-stage-actors">
          <For each={props.actors} keyed={(actor) => actor.id}>
            {(actor, index) => (
              <StageActorView
                actor={actor()}
                geometry={geometry()}
                bubble={props.actors.length <= BUBBLE_ALL || index() < BUBBLE_FOCUS}
                delegateName={props.actors.find((candidate) => candidate.id === actor().delegatesTo)?.name ?? ""}
                targetX={point(actor().delegatesTo ?? "")?.x ?? null}
              />
            )}
          </For>
          <For each={leaving()} keyed={(actor) => actor.id}>
            {(actor) => (
              <StageActorView
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
        <Show when={props.overflow > 0}>
          <span
            class="channel-stage-more"
            role="img"
            aria-label={t("channel.stage.moreLabel", { count: props.overflow })}
          >
            {t("channel.stage.more", { count: props.overflow })}
          </span>
        </Show>
      </Show>
    </div>
  );
}

/** The table: a diamond with an edge, drawn once for its width. */
function StageTable(props: { geometry: Geometry }) {
  const shape = createMemo(() => {
    // Rounded to 8 px, so a drag of the splitter does not build the drawing again for each pixel.
    const width = Math.round(props.geometry.tableWidth / 8) * 8;
    const height = width * TABLE_RATIO;
    const half = width / 2;
    const top = height / 2;
    const lines: string[] = [];
    for (let step = 1; step < TABLE_GRID; step += 1) {
      const fraction = step / TABLE_GRID;
      lines.push(
        `M${half - fraction * half} ${fraction * top}L${width - fraction * half} ${top + fraction * top}`,
        `M${half + fraction * half} ${fraction * top}L${fraction * half} ${top + fraction * top}`,
      );
    }
    return {
      width,
      height,
      top: `${half},0 ${width},${top} ${half},${height} 0,${top}`,
      left: `0,${top} ${half},${height} ${half},${height + TABLE_DEPTH} 0,${top + TABLE_DEPTH}`,
      right: `${width},${top} ${half},${height} ${half},${height + TABLE_DEPTH} ${width},${top + TABLE_DEPTH}`,
      grid: lines.join(""),
    };
  });
  return (
    <svg
      class="channel-stage-table"
      style={{
        left: `${Math.round(props.geometry.centerX - shape().width / 2)}px`,
        top: `${Math.round(props.geometry.centerY - shape().height / 2 + 20)}px`,
      }}
      width={shape().width}
      height={shape().height + TABLE_DEPTH}
      viewBox={`0 0 ${shape().width} ${shape().height + TABLE_DEPTH}`}
      aria-hidden="true"
    >
      <polygon class="channel-stage-table-left" points={shape().left} />
      <polygon class="channel-stage-table-right" points={shape().right} />
      <polygon class="channel-stage-table-top" points={shape().top} />
      <path class="channel-stage-table-grid" d={shape().grid} />
    </svg>
  );
}

/** The request on the table: its title and a bar for each part. A bar fills when its part is done. */
function StageRequest(props: { request: ChannelStageRequest; geometry: Geometry }) {
  const { t } = useText();
  return (
    <div
      class="channel-stage-request"
      data-complete={props.request.done >= props.request.parts ? "" : undefined}
      style={{ left: `${Math.round(props.geometry.centerX)}px`, top: `${Math.round(props.geometry.centerY - 6)}px` }}
    >
      <span class="channel-stage-request-kind">{t("channel.stage.request")}</span>
      <span class="channel-stage-request-title">{props.request.title}</span>
      <span class="channel-stage-request-bars" aria-hidden="true">
        <For each={Array.from({ length: Math.min(props.request.parts, 12) }, (_, index) => index)}>
          {(index) => <i data-done={index < props.request.done ? "" : undefined} />}
        </For>
      </span>
      <span class="channel-stage-request-count">
        {t("channel.stage.requestParts", { done: props.request.done, total: props.request.parts })}
      </span>
    </div>
  );
}

function centerOf(point: SeatPoint): { x: number; y: number } {
  return { x: point.x, y: point.y - point.scale * FIGURE_HEIGHT * 0.5 };
}

/** A quadratic arc from one figure to another. The packet flies along the same curve. */
function arcPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const middleX = (from.x + to.x) / 2;
  const middleY = Math.min(from.y, to.y) - 40 - Math.abs(from.x - to.x) * 0.12;
  return {
    d: `M${from.x} ${from.y}Q${Math.round(middleX)} ${Math.round(middleY)} ${to.x} ${to.y}`,
    middleX,
    middleY,
  };
}

/**
 * The small cube that flies from the agent that hands a task over to the agent that gets it. It
 * flies once, when the link is new, and goes. A link that was there when the stage opened does not fly.
 */
function StagePacket(props: { link: ChannelStageLink; actors: readonly ChannelStageActor[]; geometry: Geometry }) {
  const [flying, setFlying] = createSignal(true);
  let element: HTMLSpanElement | undefined;
  onSettled(() => {
    const from = untrack(() => props.actors.find((actor) => actor.id === props.link.from));
    const to = untrack(() => props.actors.find((actor) => actor.id === props.link.to));
    if (!element || !from || !to || prefersReducedMotion()) {
      setFlying(false);
      return;
    }
    const start = centerOf(
      seatPoint(
        from.seat,
        untrack(() => props.geometry),
      ),
    );
    const end = centerOf(
      seatPoint(
        to.seat,
        untrack(() => props.geometry),
      ),
    );
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
        class="channel-stage-packet"
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

function markActivity(activity: ChannelStageActivity): AgentMarkActivity | undefined {
  return activity === "waiting" || activity === "failed" ? undefined : activity;
}

function StageActorView(props: {
  actor: ChannelStageActor;
  geometry: Geometry;
  delegateName: string;
  /** Whether the speech bubble shows. A crowded stage gives it to the agents that need attention first. */
  bubble?: boolean;
  /** The x of the agent that gets the work, so a delegating agent leans toward it. */
  targetX: number | null;
  leaving?: boolean;
  onGone?: () => void;
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
  const anchor = () => ((SEATS[props.actor.seat]?.[0] ?? 0) < -0.1 ? "left" : "right");
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
      class="channel-stage-actor"
      data-activity={props.actor.activity}
      data-anchor={anchor()}
      data-front={(SEATS[props.actor.seat]?.[1] ?? 0) > 0.5 ? "" : undefined}
      data-lean={lean()}
      data-leaving={props.leaving ? "" : undefined}
      aria-label={`${props.actor.name}, ${t(ACTIVITY_LABEL[props.actor.activity])}`}
      style={{
        left: `${place().x}px`,
        top: `${place().y}px`,
        "z-index": place().y,
        "--stage-width": `${Math.round(FIGURE_WIDTH * place().scale)}px`,
        "--stage-height": `${Math.round(FIGURE_HEIGHT * place().scale)}px`,
        "--stage-accent": avatarMarkAccent(props.actor.hue),
        "--stage-bubble-max": `${bubbleMax()}px`,
      }}
    >
      <div
        class="channel-stage-figure"
        ref={(node) => {
          figure = node;
        }}
      >
        <Show when={logo() || modelName()}>
          <span class="channel-stage-model" aria-hidden="true">
            <Show when={logo()}>
              {(provider) => <ProviderLogo class="channel-stage-model-logo" provider={provider()} />}
            </Show>
            <span>{modelName()}</span>
          </span>
        </Show>
        <div
          class="channel-stage-hop"
          ref={(node) => {
            hop = node;
          }}
        >
          <div class="channel-stage-body">
            <AgentMark
              class="channel-stage-mark"
              animated={false}
              mood={mood()}
              activity={markActivity(props.actor.activity)}
              accent={avatarMarkAccent(props.actor.hue)}
              style={{ "--agent-mark-eyelid": String(ACTIVITY_EYELID[props.actor.activity]) }}
            />
          </div>
        </div>
      </div>
      <Show when={!props.leaving && props.bubble !== false}>
        <div class="channel-stage-bubble" data-tone={props.actor.activity}>
          <Show
            when={
              props.actor.activity === "waiting" || props.actor.activity === "failed" || props.actor.activity === "done"
            }
          >
            <span class="channel-stage-bubble-tone">{t(ACTIVITY_LABEL[props.actor.activity])}</span>
          </Show>
          <Show when={say()} keyed>
            {(sentence) => <span class="channel-stage-bubble-text">{sentence}</span>}
          </Show>
        </div>
      </Show>
      <span class="channel-stage-name" aria-hidden="true">
        <span class="channel-stage-name-text">{props.actor.name}</span>
        <span class="channel-stage-verb">{t(ACTIVITY_LABEL[props.actor.activity])}</span>
      </span>
    </li>
  );
}
