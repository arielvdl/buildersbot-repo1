import {
  AGENTS_PER_TAB_MAX,
  AGENTS_PER_TAB_MIN,
  type AgentLimitPreference,
  DEFAULT_AGENTS_PER_TAB,
} from "@buildersbot/contracts/ipc";
import { Input } from "@buildersbot/ui";
import { useText } from "@buildersbot/ui/text";
import { createSignal, createUniqueId } from "solid-js";

/** The agents of one channel tab that run at the same time: whole, from 1 to 8, and 4 for anything else. */
function clampAgentsPerTab(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENTS_PER_TAB;
  return Math.min(AGENTS_PER_TAB_MAX, Math.max(AGENTS_PER_TAB_MIN, Math.round(value)));
}

/**
 * The number of agents of one channel tab that run a turn at the same time. A request over the number
 * waits in the tab, in order. It is its own section, apart from `AgentLimitSettings`, and it saves
 * through the same preference as the other limits, so it keeps their values.
 */
export function AgentLinesSettings(props: {
  limit: AgentLimitPreference;
  onChange: (preference: AgentLimitPreference) => void;
}) {
  const { t } = useText();
  const [draft, setDraft] = createSignal<string | null>(null);
  const hintId = createUniqueId();
  return (
    <section class="window-rail-load-section">
      <label class="window-rail-load-interval">
        <span>{t("settings.load.lines.label")}</span>
        <Input
          class="window-rail-load-number"
          data-cuelume-type={undefined}
          type="number"
          min={String(AGENTS_PER_TAB_MIN)}
          max={String(AGENTS_PER_TAB_MAX)}
          step="1"
          inputmode="numeric"
          aria-describedby={hintId}
          value={draft() ?? String(props.limit.agentsPerTab ?? DEFAULT_AGENTS_PER_TAB)}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={(event) => {
            const agentsPerTab = clampAgentsPerTab(Number(event.currentTarget.value));
            setDraft(null);
            event.currentTarget.value = String(agentsPerTab);
            props.onChange({ ...props.limit, agentsPerTab });
          }}
        />
        <span>{t("settings.load.lines.unit")}</span>
      </label>
      <p id={hintId} class="window-rail-load-hint">
        {t("settings.load.lines.hint")}
      </p>
    </section>
  );
}
