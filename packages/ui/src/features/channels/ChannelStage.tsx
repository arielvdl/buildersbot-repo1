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

import { For, Show } from "solid-js";
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
  /** Fold the stage into a strip. The desktop sets it while nobody works and the reader chose to fold. */
  collapsed: boolean;
  /** The reader folded the stage by hand. The button then unfolds it, also while nobody works. */
  folded: boolean;
  /** Folds or unfolds the stage of this channel. */
  onToggleFold: () => void;
}

export function ChannelStage(props: ChannelStageProps) {
  const { t } = useText();
  const playState = createTaskListPlayState();
  return (
    <div class="channel-stage-frame">
      <section
        class="channel-stage"
        aria-label={t("channel.stage.label")}
        data-collapsed={props.collapsed ? "" : undefined}
      >
        <Show when={!props.collapsed || props.folded}>
          <Button
            variant="unstyled"
            type="button"
            class="channel-stage-fold"
            aria-expanded={props.folded ? "false" : "true"}
            aria-label={props.folded ? t("channel.stage.unfold") : t("channel.stage.fold")}
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
        <Show
          when={!props.collapsed}
          fallback={
            <p class="channel-stage-strip">{props.folded ? t("channel.stage.label") : t("channel.stage.empty")}</p>
          }
        >
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
