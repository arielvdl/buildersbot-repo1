import {
  AGENT_TABS_MAX,
  AGENT_TABS_MIN,
  AGENTS_PER_TAB_MAX,
  AGENTS_PER_TAB_MIN,
  type AgentLimitPreference,
  DEFAULT_AGENT_TABS_MODE,
  DEFAULT_AGENTS_PER_TAB,
  defaultAgentTabs,
} from "@buildersbot/contracts/ipc";
import {
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SwitchField,
} from "@buildersbot/ui";
import { useText } from "@buildersbot/ui/text";
import { createSignal, createUniqueId } from "solid-js";
import { clampAgentTabs } from "./load-view";

/** The agents of one channel tab that run at the same time: whole, from 1 to 8, and 4 for anything else. */
function clampAgentsPerTab(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENTS_PER_TAB;
  return Math.min(AGENTS_PER_TAB_MAX, Math.max(AGENTS_PER_TAB_MIN, Math.round(value)));
}

/** A row with a number: the name and the range at the left, the field at the right, like the other rows. */
function NumberRow(props: {
  title: string;
  description: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onCommit: (value: number) => number;
}) {
  const [draft, setDraft] = createSignal<string | null>(null);
  const titleId = createUniqueId();
  const hintId = createUniqueId();
  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle id={titleId}>{props.title}</ItemTitle>
        <ItemDescription>{props.description}</ItemDescription>
        <ItemDescription id={hintId}>{props.hint}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Input
          class="window-rail-load-number"
          data-cuelume-type={undefined}
          type="number"
          min={String(props.min)}
          max={String(props.max)}
          step="1"
          inputmode="numeric"
          aria-labelledby={titleId}
          aria-describedby={hintId}
          value={draft() ?? String(props.value)}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={(event) => {
            const value = props.onCommit(Number(event.currentTarget.value));
            setDraft(null);
            event.currentTarget.value = String(value);
          }}
        />
      </ItemActions>
    </Item>
  );
}

/**
 * The lines of work of a channel that run at the same time: how many agents work in one tab, and how
 * many tabs one agent opens. Tabs follow the free memory of the computer (the default) or a fixed number;
 * with the memory the number is the ceiling. It is its own section, apart from `AgentLimitSettings`, and
 * it saves through the same preference as the other limits, so it keeps their values.
 */
export function AgentLinesSettings(props: {
  limit: AgentLimitPreference;
  onChange: (preference: AgentLimitPreference) => void;
}) {
  const { t } = useText();
  const mode = () => props.limit.tabsMode ?? DEFAULT_AGENT_TABS_MODE;
  const byMemory = () => mode() === "memory";
  const suggested = () => defaultAgentTabs(mode());
  return (
    <ItemGroup class="settings-modal-card">
      <NumberRow
        title={t("settings.load.lines.label")}
        description={t("settings.load.lines.unit")}
        hint={t("settings.load.lines.hint")}
        min={AGENTS_PER_TAB_MIN}
        max={AGENTS_PER_TAB_MAX}
        value={props.limit.agentsPerTab ?? DEFAULT_AGENTS_PER_TAB}
        onCommit={(value) => {
          const agentsPerTab = clampAgentsPerTab(value);
          props.onChange({ ...props.limit, agentsPerTab });
          return agentsPerTab;
        }}
      />
      <SwitchField
        checked={byMemory()}
        onChange={(checked) => props.onChange({ ...props.limit, tabsMode: checked ? "memory" : "fixed" })}
        label={t("settings.load.lines.modeLabel")}
        description={t("settings.load.lines.modeHint")}
      />
      <NumberRow
        title={byMemory() ? t("settings.load.lines.tabsCeilingLabel") : t("settings.load.lines.tabsFixedLabel")}
        description={t("settings.load.lines.tabsUnit", { suggested: suggested() })}
        hint={byMemory() ? t("settings.load.lines.tabsCeilingHint") : t("settings.load.lines.tabsFixedHint")}
        min={AGENT_TABS_MIN}
        max={AGENT_TABS_MAX}
        value={props.limit.tabsPerAgent ?? suggested()}
        onCommit={(value) => {
          const tabsPerAgent = clampAgentTabs(value);
          props.onChange({ ...props.limit, tabsPerAgent });
          return tabsPerAgent;
        }}
      />
    </ItemGroup>
  );
}
