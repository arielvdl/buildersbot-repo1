import { CHANNEL_TAB_NOTE_LIMIT, type ChannelTabOutcome } from "@buildersbot/contracts/ipc";
import { Check, Field, RadioGroup, Text, Textarea } from "@buildersbot/ui";
import { For } from "solid-js";
import { useText } from "../../text";

/** The three answers, in the order they show. The text of each is an interface key. */
const OUTCOMES = [
  { value: "done", label: "channel.topic.outcome.done" },
  { value: "not-done", label: "channel.topic.outcome.notDone" },
  { value: "other", label: "channel.topic.outcome.other" },
] as const satisfies readonly { value: ChannelTabOutcome; label: string }[];

export interface ChannelTabCloseOutcomeProps {
  /** The answer, or null while the person has not chosen: no option starts selected. */
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
                <RadioGroup.ItemIndicator class="channel-tab-outcome-check">
                  <Check aria-hidden="true" />
                </RadioGroup.ItemIndicator>
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
