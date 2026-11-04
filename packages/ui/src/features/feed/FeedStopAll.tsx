import { Button, Spinner } from "@buildersbot/ui";
import { useText } from "@buildersbot/ui/text";
import { createEffect, Show } from "solid-js";

export interface FeedStopAllProps {
  /** The runs that Stop can end now. */
  count: number;
  /** The person asked, and the page waits for the second step. */
  armed: boolean;
  /** The stops run. */
  busy: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Stop every run that works now. The first click only asks: the second step names how many runs end,
 * and Escape or Cancel takes it back. Each card keeps its own answer, so a run that main refuses shows why.
 */
export function FeedStopAll(props: FeedStopAllProps) {
  const { t } = useText();
  let confirmButton: HTMLButtonElement | undefined;

  // The second step takes the focus, so Enter confirms and Escape cancels.
  createEffect(
    () => props.armed,
    (armed) => {
      if (armed) queueMicrotask(() => confirmButton?.focus());
      else confirmButton = undefined;
    },
  );

  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    props.onCancel();
  };

  return (
    <Show
      when={!props.busy}
      fallback={
        <span class="feed-stop-all-pending" role="status">
          <Spinner size="sm" />
          {t("app.feed.pending.stop")}
        </span>
      }
    >
      <Show
        when={props.armed}
        fallback={
          <Button
            variant="destructive-ghost"
            size="sm"
            type="button"
            class="feed-stop-all"
            disabled={props.count === 0}
            onClick={() => props.onArm()}
          >
            <span class="feed-stop-glyph" aria-hidden="true" />
            {t("app.feed.stopAll", { count: props.count })}
          </Button>
        }
      >
        <fieldset class="feed-stop-all-confirm" aria-label={t("app.feed.stopAll", { count: props.count })}>
          <span class="feed-stop-all-hint">{t("app.feed.stopAll.hint", { count: props.count })}</span>
          <Button
            ref={(element: HTMLButtonElement) => {
              confirmButton = element;
            }}
            variant="destructive"
            size="sm"
            type="button"
            onKeyDown={cancelOnEscape}
            onClick={() => props.onConfirm()}
          >
            {t("app.feed.stopAll.confirm")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onKeyDown={cancelOnEscape}
            onClick={() => props.onCancel()}
          >
            {t("app.feed.action.cancel")}
          </Button>
        </fieldset>
      </Show>
    </Show>
  );
}
