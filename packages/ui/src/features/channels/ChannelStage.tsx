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
 * screen or the window is hidden. A folded stage draws a strip and nothing else, and a hidden one
 * draws nothing: no observer, no animation.
 */

import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { Button } from "../../button";
import { useText } from "../../text";
import { createTaskListPlayState } from "../conversation/TaskList";
import type { StageActorData } from "../stage/StageActor";
import { StageBoard } from "../stage/StageBoard";
import type { StageLinkData } from "../stage/StageLinks";
import type { StageActivity } from "../stage/stage-activity";
import type { StageGeometry } from "../stage/stage-geometry";
import "../stage/agent-stage.css";
import "./channel-stage.css";

export type ChannelStageActivity = StageActivity;
export type ChannelStageActor = StageActorData;
export type ChannelStageLink = StageLinkData;

export interface ChannelStageRequest {
  title: string;
  parts: number;
  done: number;
}

export interface ChannelStageProps {
  actors: readonly ChannelStageActor[];
  overflow: number;
  request: ChannelStageRequest | null;
  links: readonly ChannelStageLink[];
  /** The reader folded the stage of this channel by hand: a strip with the button that unfolds it. */
  folded: boolean;
  /** Nobody works and the reader chose to hide the stage then: nothing shows. A fold by hand wins. */
  hidden: boolean;
  /** Folds or unfolds the stage of this channel. */
  onToggleFold: () => void;
}

/** The height of the panel: the board, the folded strip, or nothing. */
type StageShape = "open" | "strip" | "gone";

/**
 * Folding is sequential: the figures fade out, then the panel folds. Unfolding is the reverse: the
 * panel opens, then the figures come back. `channel-stage.css` holds the durations of the two steps.
 */
const FIGURES_OUT_MS = 320;
const PANEL_OPEN_MS = 520;

export function ChannelStage(props: ChannelStageProps) {
  const { t } = useText();
  const playState = createTaskListPlayState();
  const target = (): StageShape => (props.folded ? "strip" : props.hidden ? "gone" : "open");
  // `shape` drives the panel height, `mounted` the board and its figures, `closing` their fade-out.
  // The first frame takes the target as it is: a channel that opens does not play a fold.
  const [shape, setShape] = createSignal<StageShape>(untrack(target));
  // `figures` is what `mounted` holds, for the effect below; that effect must not run again on it.
  let figures = untrack(target) === "open";
  const [mounted, setMounted] = createSignal(figures);
  const showFigures = (show: boolean) => {
    figures = show;
    setMounted(show);
  };
  const [closing, setClosing] = createSignal<StageShape | null>(null);
  createEffect(target, (next) => {
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (next === "open") {
      setClosing(null);
      setShape("open");
      timer = setTimeout(() => showFigures(true), instant ? 0 : PANEL_OPEN_MS);
    } else if (figures) {
      setClosing(next);
      timer = setTimeout(
        () => {
          showFigures(false);
          setClosing(null);
          setShape(next);
        },
        instant ? 0 : FIGURES_OUT_MS,
      );
    } else {
      // No figures on the panel: the strip and the hidden stage change height at once.
      setClosing(null);
      setShape(next);
    }
    return () => clearTimeout(timer);
  });
  return (
    <div class="channel-stage-frame" data-gone={shape() === "gone" ? "" : undefined}>
      <section
        class="channel-stage"
        aria-label={t("channel.stage.label")}
        data-collapsed={shape() === "strip" ? "" : undefined}
        data-gone={shape() === "gone" ? "" : undefined}
        data-closing={closing() ?? undefined}
      >
        <Show when={shape() !== "gone"}>
          {/* A disclosure: one name, and `aria-expanded` says whether the stage is open. */}
          <Button
            variant="unstyled"
            type="button"
            class="channel-stage-fold"
            aria-expanded={props.folded ? "false" : "true"}
            aria-label={t("channel.stage.label")}
            title={props.folded ? t("channel.stage.unfold") : t("channel.stage.fold")}
            onClick={() => props.onToggleFold()}
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
              data-folded={props.folded ? "" : undefined}
            >
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
        </Show>
        <Show when={shape() === "strip"}>
          <p class="channel-stage-strip">{t("channel.stage.label")}</p>
        </Show>
        <Show when={mounted()}>
          <StageBoard
            actors={props.actors}
            links={props.links}
            suspended={playState() === "paused"}
            overlay={(geometry) => (
              <Show when={props.request}>{(request) => <StageRequest request={request()} geometry={geometry} />}</Show>
            )}
          >
            <Show when={props.overflow > 0}>
              <span
                class="channel-stage-more"
                role="img"
                aria-label={t("channel.stage.moreLabel", { count: props.overflow })}
              >
                {t("channel.stage.more", { count: props.overflow })}
              </span>
            </Show>
          </StageBoard>
        </Show>
      </section>
    </div>
  );
}

/** The request on the table: its title and a bar for each part. A bar fills when its part is done. */
function StageRequest(props: { request: ChannelStageRequest; geometry: StageGeometry }) {
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
