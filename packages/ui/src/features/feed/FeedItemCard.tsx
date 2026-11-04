import type { AvatarHue, FeedItem } from "@buildersbot/contracts/ipc";
import { Button, Checkbox, ChevronDown, ChevronUp, ExternalLink } from "@buildersbot/ui";
import { useText } from "@buildersbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import { FeedCardActions } from "./FeedCardActions";
import {
  type FeedCardControl,
  type FeedCardIntent,
  feedCan,
  feedCardShortcuts,
  feedShownItem,
} from "./feed-actions-view";
import { FEED_STATE_LABEL } from "./feed-view";

export interface FeedAvatar {
  seed: string;
  hue: AvatarHue | null;
  url: string | null;
}

export interface FeedItemCardProps {
  item: FeedItem;
  avatar: FeedAvatar;
  /** The place of the card in the rows, from 1, and the number of rows, for `aria-posinset`. */
  position: number;
  total: number;
  expanded: boolean;
  onToggleSteps: () => void;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  /** What the person does on this card now. */
  control?: FeedCardControl | undefined;
  /** Whether the card is in the selection of stopped work. */
  selected?: boolean | undefined;
  /** The actions on the card. Absent: the card is read only. */
  onIntent?: ((intent: FeedCardIntent) => void) | undefined;
}

/** The time of day of an ISO time, as the reader's locale writes it. */
function useClock() {
  const { format } = useText();
  return (iso: string) => format.date(Date.parse(iso), { hour: "2-digit", minute: "2-digit" });
}

/**
 * One run on the timeline. It changes in place as the run goes on: the state, the step it does now,
 * what it waits for. It shows summaries only; the conversation holds the rest, one click away. With
 * `onIntent`, the person acts on it here: approve, deny, answer, stop, resume, reassign.
 */
export function FeedItemCard(props: FeedItemCardProps) {
  const { t } = useText();
  const clock = useClock();
  /** The card as it shows: while an answer runs, it waits for nothing. */
  const item = createMemo(() => feedShownItem(props.item, props.control?.pending));
  const titleId = () => `feed-title-${props.item.id}`;
  const stepsId = () => `feed-steps-${props.item.id}`;
  const title = () =>
    props.item.title || t("app.feed.chatWith", { name: props.item.agentName || t("app.feed.unnamedAgent") });
  const answersHere = () =>
    Boolean(props.onIntent) && (props.item.actions.includes("approve") || props.item.actions.includes("answer"));
  const needLabel = () => {
    const need = item().need;
    if (!need) return "";
    if (need.kind === "prompt") return t("app.feed.need.prompt", { count: need.questionCount ?? 1 });
    if (need.approvalKind === "file-change") return t("app.feed.need.fileChange");
    if (need.approvalKind === "permissions") return t("app.feed.need.permissions");
    return need.label ? t("app.feed.need.command", { program: need.label }) : t("app.feed.need.commandUnnamed");
  };
  const stopLabel = () => {
    const stop = item().stop;
    if (!stop) return "";
    if (stop.source === "usage-limit")
      return stop.resetsAt
        ? t("app.feed.stop.resetsAt", { time: clock(stop.resetsAt) })
        : t("app.feed.stop.usageLimit");
    if (stop.source === "interrupted") return t("app.feed.stop.interrupted");
    if (stop.source === "task-watch") return t("app.feed.stop.taskWatch");
    if (stop.source === "error") return t("app.feed.stop.error");
    return t("app.feed.stop.stoppedWork");
  };
  const waitLabel = () => (item().queued ? t("app.feed.queued", { count: item().queued ?? 0 }) : t("app.feed.waits"));
  const ended = () => item().endedAt;
  const agentName = () => props.item.agentName || t("app.feed.unnamedAgent");
  /** The longer names stay in the tooltip: the row cuts them, and the project is there too. */
  const who = () => (props.item.projectName ? `${agentName()} · ${props.item.projectName}` : agentName());
  /**
   * The part under the row opens only when the card has something to decide or to say: a request, a
   * stop, a slow run, an action that runs or waits for a second step, or the steps that the reader opened.
   */
  const detail = () => {
    const control = props.control;
    return Boolean(
      item().need ||
        item().stop ||
        item().quiet ||
        props.expanded ||
        control?.confirming ||
        control?.pending ||
        control?.notice,
    );
  };
  const canStop = () => Boolean(props.onIntent) && feedCan(props.item, props.control, "stop");
  const stateLine = () => {
    const last = item().lastStep;
    if (item().state === "waiting") return waitLabel();
    return last ? last.text : "";
  };
  return (
    <article
      class="feed-card"
      data-state={item().state}
      data-detail={detail() ? "" : undefined}
      data-feed-id={props.item.id}
      data-pending={props.control?.pending ? props.control.pending.action : undefined}
      tabindex="0"
      aria-labelledby={titleId()}
      aria-posinset={props.position}
      aria-setsize={props.total}
      aria-keyshortcuts={props.onIntent ? feedCardShortcuts(props.item) : undefined}
      aria-busy={props.control?.pending && !props.control.pending.done ? "true" : undefined}
      onKeyDown={props.onKeyDown}
    >
      <div class="feed-card-row">
        <Show when={props.onIntent && props.item.actions.includes("resume")}>
          <Checkbox
            class="feed-card-select"
            checked={props.selected ?? false}
            aria-label={t("app.feed.action.select", { title: title() })}
            onChange={(event) => props.onIntent?.({ type: "select", selected: event.currentTarget.checked })}
          />
        </Show>
        <span class="feed-card-state" data-state={item().state}>
          <span class="feed-dot" aria-hidden="true" />
          <span class="sr-only">{t(FEED_STATE_LABEL[item().state])}</span>
        </span>
        <AgentAvatar
          seed={props.avatar.seed}
          hue={props.avatar.hue}
          url={props.avatar.url}
          motion="still"
          animated={false}
          class="feed-avatar"
        />
        <span class="feed-card-agent" title={who()}>
          {agentName()}
        </span>
        <h3 class="feed-card-title" id={titleId()} title={title()}>
          {title()}
        </h3>
        <p class="feed-card-step" data-live={item().state === "working" ? "" : undefined} title={stateLine()}>
          {stateLine()}
        </p>
        <time class="feed-card-time" datetime={props.item.updatedAt}>
          {clock(props.item.updatedAt)}
        </time>
        <span class="feed-card-quick">
          <Show when={canStop() && !detail()}>
            <Button
              variant="destructive-ghost"
              size="xs"
              type="button"
              class="feed-card-action feed-card-stop-action"
              onClick={() => props.onIntent?.({ type: "stop" })}
            >
              <span class="feed-stop-glyph" aria-hidden="true" />
              {t("app.feed.action.stop")}
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="xs"
            class="feed-card-action"
            aria-label={props.item.channelId ? t("app.feed.openChannel") : t("app.feed.openConversation")}
            title={props.item.channelId ? t("app.feed.openChannel") : t("app.feed.openConversation")}
            onClick={() => props.onOpen()}
          >
            <ExternalLink aria-hidden="true" />
          </Button>
          <Show when={props.item.steps.length > 0}>
            <Button
              variant="ghost"
              size="xs"
              class="feed-card-action"
              aria-label={props.expanded ? t("app.feed.hideSteps") : t("app.feed.showSteps")}
              title={props.expanded ? t("app.feed.hideSteps") : t("app.feed.showSteps")}
              aria-expanded={props.expanded ? "true" : "false"}
              aria-controls={stepsId()}
              onClick={() => props.onToggleSteps()}
            >
              <Show when={props.expanded} fallback={<ChevronDown aria-hidden="true" />}>
                <ChevronUp aria-hidden="true" />
              </Show>
            </Button>
          </Show>
        </span>
      </div>
      <Show when={detail()}>
        <div class="feed-card-detail">
          <Show when={item().need}>
            {(need) => (
              <p class="feed-card-need">
                <strong>{needLabel()}</strong>
                <Show when={need().guard}>
                  <span class="feed-chip">{t("app.feed.need.guard")}</span>
                </Show>
                <Show when={need().kind === "prompt" && need().label}>
                  <span class="feed-card-need-detail">{need().label}</span>
                </Show>
                <span class="feed-card-need-hint">
                  {answersHere() ? t("app.feed.need.answerHere") : t("app.feed.need.hint")}
                </span>
              </p>
            )}
          </Show>
          <Show when={item().stop}>
            {(stop) => (
              <p class="feed-card-stop">
                <strong>{stopLabel()}</strong>
                <Show when={stop().reason}>
                  <span class="feed-card-need-detail">{stop().reason}</span>
                </Show>
              </p>
            )}
          </Show>
          <Show when={item().quiet}>
            {(quiet) => (
              <p class="feed-card-quiet" data-quiet={quiet().state}>
                {quiet().state === "stalled"
                  ? t("app.feed.quiet.stalled", { count: quiet().minutes })
                  : t("app.feed.quiet.slow", { count: quiet().minutes })}
              </p>
            )}
          </Show>
          <Show when={props.onIntent}>
            {(onIntent) => (
              <FeedCardActions
                item={item()}
                source={props.item}
                title={title()}
                control={props.control}
                onIntent={onIntent()}
              />
            )}
          </Show>
          <Show when={props.expanded}>
            <p class="feed-card-meta">
              <Show
                when={props.item.stepCount > 0}
              >{`${t("app.feed.steps", { count: props.item.stepCount })} · `}</Show>
              {t("app.feed.startedAt", { time: clock(props.item.startedAt) })}
              <Show when={ended()}>{(end) => ` · ${t("app.feed.endedAt", { time: clock(end()) })}`}</Show>
            </p>
            <ol class="feed-card-steps" id={stepsId()} aria-label={t("app.feed.stepsLabel", { title: title() })}>
              <For each={props.item.steps} keyed={false}>
                {(step) => (
                  <li>
                    <time datetime={step().at}>{clock(step().at)}</time>
                    <span>{step().text}</span>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </div>
      </Show>
    </article>
  );
}
