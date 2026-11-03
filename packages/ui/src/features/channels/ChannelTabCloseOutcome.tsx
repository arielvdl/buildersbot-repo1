import { CHANNEL_TAB_NOTE_LIMIT, type ChannelTabOutcome } from "@buildersbot/contracts/ipc";
import { Field, RadioGroup, Text, Textarea } from "@buildersbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

/** The three answers, in the order they show. The text of each is an interface key. */
const OUTCOMES = [
  { value: "done", label: "channel.topic.outcome.done" },
  { value: "not-done", label: "channel.topic.outcome.notDone" },
  { value: "other", label: "channel.topic.outcome.other" },
] as const satisfies readonly { value: ChannelTabOutcome; label: string }[];

/** One figure of the tab being closed, already written for the person (the caller owns the text and the numbers). */
export interface ChannelTabCloseStat {
  label: string;
  value: string;
  /** `working` marks a tab that still has agents at work; the figure then takes the warning colour. */
  tone?: "idle" | "working";
}

export interface ChannelTabCloseOutcomeProps {
  /** The tab's name and figures, shown above the question so the person sees what goes away. */
  summary?: { name: string; stats: readonly ChannelTabCloseStat[] } | undefined;
  /** The answer, or null while none is chosen (the caller starts with `done`). */
  outcome: ChannelTabOutcome | null;
  note: string;
  onOutcomeChange: (outcome: ChannelTabOutcome) => void;
  onNoteChange: (note: string) => void;
}

/**
 * How a channel tab ended: Done, Not done or Other, and a short note. The note is optional, except
 * with Other, where it says what happened. The caller keeps the state and decides when the answer is
 * complete (`other` needs a note that is not empty).
 */
export function ChannelTabCloseOutcome(props: ChannelTabCloseOutcomeProps) {
  const { t } = useText();
  const noteRequired = () => props.outcome === "other";
  const noteLabel = () => t(noteRequired() ? "channel.topic.outcome.noteRequired" : "channel.topic.outcome.note");
  return (
    <div class="channel-tab-outcome">
      <Show when={props.summary}>
        {(summary) => (
          <div class="channel-tab-outcome-summary">
            <Text as="p" variant="caption" class="channel-tab-outcome-tab">
              {summary().name}
            </Text>
            <dl class="channel-tab-outcome-stats">
              <For each={summary().stats}>
                {(stat) => (
                  <div class="channel-tab-outcome-stat" data-tone={stat.tone}>
                    <dt>{stat.label}</dt>
                    <dd>{stat.value}</dd>
                  </div>
                )}
              </For>
            </dl>
          </div>
        )}
      </Show>
      <RadioGroup.Root
        class="channel-tab-outcome-options"
        aria-label={t("channel.topic.outcome.label")}
        value={props.outcome ?? ""}
        onChange={(value: string) => {
          const choice = OUTCOMES.find((item) => item.value === value);
          if (choice) props.onOutcomeChange(choice.value);
        }}
      >
        <RadioGroup.Label class="channel-tab-outcome-label">{t("channel.topic.outcome.label")}</RadioGroup.Label>
        <For each={OUTCOMES}>
          {(item) => (
            <RadioGroup.Item class="channel-tab-outcome-option" value={item.value}>
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="channel-tab-outcome-control">
                <RadioGroup.ItemLabel class="channel-tab-outcome-option-label">{t(item.label)}</RadioGroup.ItemLabel>
              </RadioGroup.ItemControl>
            </RadioGroup.Item>
          )}
        </For>
      </RadioGroup.Root>
      <Field
        label={noteLabel()}
        description={t("channel.topic.outcome.noteCount", { count: props.note.length, max: CHANNEL_TAB_NOTE_LIMIT })}
      >
        <Textarea
          rows={3}
          maxlength={CHANNEL_TAB_NOTE_LIMIT}
          value={props.note}
          required={noteRequired()}
          onValueChange={props.onNoteChange}
        />
      </Field>
      <Text as="p" variant="caption" class="channel-tab-outcome-record">
        {t("channel.topic.closeRecord")}
      </Text>
    </div>
  );
}
