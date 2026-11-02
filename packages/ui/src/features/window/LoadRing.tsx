import {
  type AgentLimitPreference,
  type AutoRecoveryPreference,
  DEFAULT_AGENT_TABS,
  type LoadLanePreference,
  type LoadSnapshot,
  type RunningWork,
  type StoppedWork,
  type TaskWatchPreference,
  type TaskWatchState,
} from "@buildersbot/contracts/ipc";
import {
  Button,
  ChevronDown,
  CircleAlert,
  Clock3,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  MessageSquare,
  PanelTop,
  SettingsSection,
  SlidersHorizontal,
  Square,
  SwitchField,
} from "@buildersbot/ui";
import { useText } from "@buildersbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import {
  activeAgentLimit,
  clampAgentLimit,
  clampAgentTabs,
  clampRecoveryMinutes,
  clampWatchMinutes,
  elapsedMinutes,
  formatGigabytes,
  type LoadTone,
  loadAgentArc,
  loadLaneRows,
  loadMemoryPercent,
  loadRecentEvents,
  loadRingTone,
  recoveryEventText,
  requestText,
  stoppedCount,
  stoppedTone,
  taskWatchEventText,
  toggledKey,
  withChannelFirst,
} from "./load-view";

/** Two tracks do not fit here: one ring in the 34px box the usage rings use. */
const RING = { size: 34, stroke: 2.5 };

export interface LoadRailProps {
  /** The last reading, or null before the first one. */
  snapshot: LoadSnapshot | null;
  /**
   * Opens the load page of Settings, where the person acts on the work. `ring` is the button of the
   * ring: it takes the focus back when Settings closes.
   */
  onOpen: (ring: HTMLElement) => void;
}

/**
 * The load of this computer as one ring in the rail: the number inside is how many agents run now, and
 * the arc is that count of ten (more can run, and the arc stays full), or of the cap when the person set
 * one, so a full circle is the cap reached. The memory is the colour of the
 * ring, and the tooltip gives it. A red mark on the ring counts the work that stopped. The pointer over
 * the ring gives a one-line summary; a click opens the load page of Settings, where the person can stop
 * what runs, act on many stopped runs at once, and let the app recover work by itself.
 */
export function LoadRing(props: LoadRailProps) {
  const { t } = useText();
  const tone = (): LoadTone => (props.snapshot ? loadRingTone(props.snapshot) : "ok");
  const agents = () => props.snapshot?.activeAgents ?? 0;
  const limit = () => (props.snapshot ? activeAgentLimit(props.snapshot) : null);
  const arc = () => loadAgentArc(agents(), limit());
  /** The count, or the count of the cap: "3" or "3 of 10". */
  const agentsText = () => {
    const cap = limit();
    return cap === null ? String(agents()) : t("app.rail.load.agentsOfLimit", { agents: agents(), limit: cap });
  };
  const stopped = () => (props.snapshot ? stoppedCount(props.snapshot) : 0);
  const radius = (RING.size - RING.stroke) / 2;
  const memory = () => {
    const snapshot = props.snapshot;
    if (!snapshot || snapshot.memory.usedMb === null) return null;
    return { used: formatGigabytes(snapshot.memory.usedMb), total: formatGigabytes(snapshot.memory.totalMb) };
  };
  const label = () => {
    const used = memory();
    const base = used
      ? t("app.rail.load.ring", { agents: agentsText(), used: used.used, total: used.total })
      : t("app.rail.load.ringUnmeasured", { agents: agentsText() });
    return stopped() > 0 ? `${base} ${t("app.rail.load.stoppedAlert", { count: stopped() })}` : base;
  };
  /** The line that shows when the pointer rests on the ring. */
  const summary = () => {
    const used = memory();
    if (!used) return label();
    return stopped() > 0
      ? t("app.rail.load.summary", { agents: agentsText(), stopped: stopped(), used: used.used, total: used.total })
      : t("app.rail.load.summaryQuiet", { agents: agentsText(), used: used.used, total: used.total });
  };
  return (
    <Button
      variant="ghost"
      type="button"
      class="window-rail-button window-rail-usage window-rail-load"
      aria-label={label()}
      title={summary()}
      onClick={(event) => props.onOpen(event.currentTarget)}
    >
      <svg class="window-rail-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
        <circle
          class="window-rail-usage-track"
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={radius}
          stroke-width={RING.stroke}
        />
        <Show when={arc() > 0}>
          <circle
            class="window-rail-usage-arc"
            data-load-tone={tone()}
            cx={RING.size / 2}
            cy={RING.size / 2}
            r={radius}
            stroke-width={RING.stroke}
            stroke-linecap="round"
            pathLength={100}
            stroke-dasharray={`${arc()} 100`}
          />
        </Show>
      </svg>
      <span class="window-rail-load-count" aria-hidden="true">
        {agents()}
      </span>
      <Show when={stopped() > 0}>
        <span class="window-rail-load-alert" aria-hidden="true">
          {Math.min(stopped(), 9)}
          {stopped() > 9 ? "+" : ""}
        </span>
      </Show>
    </Button>
  );
}

/** What the load page of Settings shows besides the stopped work, and the changes it makes. */
export interface LoadOverviewProps {
  snapshot: LoadSnapshot;
  channelName: (channelId: string) => string;
  onLaneChange: (preference: LoadLanePreference) => void;
  onRunNow: (channelId: string) => void;
  onStop: (work: RunningWork) => void;
  onRecoveryChange: (preference: AutoRecoveryPreference) => void;
  onAgentLimitChange: (preference: AgentLimitPreference) => void;
  /** The task reviewer: its switch and its threshold. */
  onTaskWatchChange: (preference: TaskWatchPreference) => void;
  /** Opens the page of the task reviewer in Settings. */
  onOpenTaskReviewerSettings?: (() => void) | undefined;
}

/**
 * The load of this computer on the load page of Settings, below the stopped work: the memory, what waits
 * for a place and what runs (with Stop), the one-channel-at-a-time mode, the cap on agents, and the
 * automatic recovery with the task reviewer.
 */
export function LoadOverview(props: LoadOverviewProps) {
  const { t } = useText();
  const memory = () => props.snapshot.memory;
  const rows = () => loadLaneRows(props.snapshot);
  const queued = () => rows().filter((row) => row.status === "queued");
  const recent = () => loadRecentEvents(props.snapshot);
  // The requests that the person opened. They close again with the page.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => setExpanded((keys) => toggledKey(keys, key));
  const runningKey = (work: RunningWork) => `running:${work.turnId}`;
  return (
    <div class="window-rail-load-body">
      <Show when={props.snapshot.memory.pressure}>
        {(pressure) => (
          <Show when={pressure().level !== "ok"}>
            <p class="window-rail-load-pressure" data-level={pressure().level} role="status">
              {t(pressure().level === "critical" ? "app.rail.load.pressureCritical" : "app.rail.load.pressureLow", {
                percent: pressure().freePercent,
              })}
            </p>
          </Show>
        )}
      </Show>
      <Show when={props.snapshot.waiting.length > 0}>
        <section class="window-rail-load-work">
          <header class="window-rail-load-section-head">
            <h3>{t("app.rail.load.waitingTitle")}</h3>
          </header>
          <ul class="window-rail-load-list">
            <For each={props.snapshot.waiting} keyed={(work) => work.agentId}>
              {(work) => (
                <li class="window-rail-load-item">
                  <div class="window-rail-load-item-head">
                    <span class="window-rail-load-item-name">{work().agentName}</span>
                  </div>
                  <p class="window-rail-load-item-meta">
                    <span>{t("app.rail.load.waitingReason", { count: props.snapshot.agentLimit.max })}</span>
                  </p>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <section class="window-rail-load-work">
        <header class="window-rail-load-section-head">
          <h3>{t("app.rail.load.runningTitle")}</h3>
        </header>
        <Show
          when={props.snapshot.running.length > 0}
          fallback={<p class="window-rail-load-empty">{t("app.rail.load.nothingRuns")}</p>}
        >
          <ul class="window-rail-load-list">
            <For each={props.snapshot.running} keyed={runningKey}>
              {(work) => (
                <RunningRow
                  work={work()}
                  expanded={expanded().has(runningKey(work()))}
                  onToggle={() => toggle(runningKey(work()))}
                  onStop={props.onStop}
                />
              )}
            </For>
          </ul>
        </Show>
      </section>
      <ItemGroup class="settings-modal-card">
        <StatRow
          label={t("app.rail.load.agents")}
          value={
            activeAgentLimit(props.snapshot) === null
              ? String(props.snapshot.activeAgents)
              : t("app.rail.load.agentsOfLimit", {
                  agents: props.snapshot.activeAgents,
                  limit: props.snapshot.agentLimit.max,
                })
          }
        />
        <StatRow
          label={t("app.rail.load.memory")}
          value={
            memory().usedMb !== null
              ? t("app.rail.load.memoryValue", {
                  used: formatGigabytes(memory().usedMb ?? 0),
                  total: formatGigabytes(memory().totalMb),
                  percent: loadMemoryPercent(props.snapshot) ?? 0,
                })
              : t("app.rail.load.unmeasured")
          }
        />
        <Show when={memory().agentsMb !== null}>
          <StatRow label={t("app.rail.load.agentsMemory")} value={formatGigabytes(memory().agentsMb ?? 0)} />
          <StatRow label={t("app.rail.load.processes")} value={String(props.snapshot.providerProcesses)} />
        </Show>
      </ItemGroup>
      <ItemGroup class="settings-modal-card">
        <SwitchField
          checked={props.snapshot.lane.enabled}
          onChange={(enabled) => props.onLaneChange({ enabled, order: props.snapshot.lane.order })}
          label={t("app.rail.load.lane")}
          description={t("app.rail.load.laneHint")}
        />
        <Show when={props.snapshot.lane.enabled}>
          <div class="window-rail-load-lane-block">
            <ul class="window-rail-load-lane">
              <For each={rows()} keyed={(row) => row.id}>
                {(row) => (
                  <li class="window-rail-load-channel" data-status={row().status}>
                    <span class="window-rail-load-channel-name">{props.channelName(row().id)}</span>
                    <Show
                      when={row().status === "queued"}
                      fallback={<span class="window-rail-load-channel-state">{t("app.rail.load.running")}</span>}
                    >
                      <span class="window-rail-load-channel-state">
                        {t("app.rail.load.waiting", { position: row().position ?? 0 })}
                      </span>
                      <span class="window-rail-load-channel-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={row().position === 1}
                          onClick={() => props.onLaneChange(withChannelFirst(props.snapshot, row().id))}
                        >
                          {t("app.rail.load.first")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("app.rail.load.nowHint")}
                          onClick={() => props.onRunNow(row().id)}
                        >
                          {t("app.rail.load.now")}
                        </Button>
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <Show when={rows().length === 0}>
              <p class="window-rail-load-empty">{t("app.rail.load.noneRunning")}</p>
            </Show>
            <Show when={rows().length > 0 && queued().length === 0}>
              <p class="window-rail-load-empty">{t("app.rail.load.noneWaiting")}</p>
            </Show>
          </div>
        </Show>
        <AgentLimitSettings limit={props.snapshot.agentLimit} onChange={props.onAgentLimitChange} />
      </ItemGroup>
      <ItemGroup class="settings-modal-card">
        <RecoverySettings
          recovery={props.snapshot.recovery}
          taskWatch={props.snapshot.taskWatch}
          onChange={props.onRecoveryChange}
          onTaskWatchChange={props.onTaskWatchChange}
          onOpenTaskReviewerSettings={props.onOpenTaskReviewerSettings}
        />
      </ItemGroup>
      <Show when={props.snapshot.recovery.enabled && recent().length > 0}>
        <SettingsSection title={t("app.rail.load.recoveryRecent")}>
          <ItemGroup class="settings-modal-card">
            <For
              each={recent()}
              keyed={(item) => `${item.by}:${item.event.at}:${item.event.action}:${item.event.channelName}`}
            >
              {(item) => {
                const entry = item();
                return (
                  <Item
                    size="compact"
                    class="settings-modal-row window-rail-load-recent-row"
                    title={
                      entry.by === "recovery"
                        ? undefined
                        : t(entry.event.by === "model" ? "app.rail.load.watchByModel" : "app.rail.load.watchByLocal")
                    }
                  >
                    <ItemContent>
                      <ItemDescription>
                        {entry.by === "recovery"
                          ? recoveryEventText(entry.event, t)
                          : taskWatchEventText(entry.event, t)}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                );
              }}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>
    </div>
  );
}

export interface WorkRowProps {
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Why a task stopped, as the icon at the right of its channel: red for a failed task, amber for a paused
 * one. The reason is its tooltip and its accessible name, in the reader's language when it is the
 * English of a source key. The reason is in the tooltip only, because most tasks stop for the same
 * reason and the same sentence on each one hid the requests.
 */
export function StoppedState(props: { work: Pick<StoppedWork, "state" | "reason"> }) {
  const { sourceText } = useText();
  const tone = () => stoppedTone(props.work.state);
  return (
    <IconButton
      variant="ghost"
      size="icon-xs"
      class="window-rail-load-state"
      data-tone={tone()}
      label={sourceText(props.work.reason)}
    >
      <Show when={tone() === "danger"} fallback={<Clock3 aria-hidden="true" />}>
        <CircleAlert aria-hidden="true" />
      </Show>
    </IconButton>
  );
}

/** One turn that runs, in the layout of a stopped task: where it runs, the request, the agent, and Stop. */
function RunningRow(props: WorkRowProps & { work: RunningWork; onStop: (work: RunningWork) => void }) {
  const { t } = useText();
  return (
    <li class="window-rail-load-item">
      <div class="window-rail-load-item-head">
        <span class="window-rail-load-item-name">{props.work.channelName ?? props.work.agentName}</span>
        <span class="window-rail-load-item-time">
          {t("app.rail.load.minutes", { minutes: elapsedMinutes(props.work.startedAt, Date.now()) })}
        </span>
      </div>
      <Show
        when={props.work.channelName !== null}
        fallback={
          <p class="window-rail-load-item-place">
            <MessageSquare aria-hidden="true" />
            <span class="window-rail-load-item-place-name">{t("app.rail.load.inChat")}</span>
          </p>
        }
      >
        <WorkTab name={props.work.topicName} />
      </Show>
      <Show when={props.work.title}>
        <WorkRequest request={props.work.title} expanded={props.expanded} onToggle={props.onToggle} />
      </Show>
      <Show when={props.work.channelName !== null}>
        <p class="window-rail-load-item-meta">
          <span>{t("app.rail.load.runningWith", { agent: props.work.agentName })}</span>
          {/* The task reviewer finds this run slow or stalled: it says why. */}
          <Show when={props.work.quiet}>
            {(quiet) => (
              <span data-tone={quiet().state === "stalled" ? "danger" : undefined}>
                {quiet().state === "stalled"
                  ? t("app.rail.load.quietStalled", { minutes: quiet().minutes })
                  : t("app.rail.load.quietSlow", { minutes: quiet().minutes })}
              </span>
            )}
          </Show>
        </p>
      </Show>
      <div class="window-rail-load-item-actions">
        <Button
          variant="secondary"
          size="sm"
          class="window-rail-load-action"
          aria-label={t("app.rail.load.stopLabel", { agent: props.work.agentName })}
          onClick={() => props.onStop(props.work)}
        >
          <Square aria-hidden="true" />
          {t("app.rail.load.stop")}
        </Button>
      </div>
    </li>
  );
}

/** The tab of the channel that holds the work. No line when the tab is not known. */
export function WorkTab(props: { name: string | null }) {
  const { t } = useText();
  return (
    <Show when={props.name}>
      {(name) => (
        <p class="window-rail-load-item-place">
          <PanelTop aria-hidden="true" />
          <span class="sr-only">{`${t("app.rail.load.tab")} `}</span>
          <span class="window-rail-load-item-place-name">{name()}</span>
        </p>
      )}
    </Show>
  );
}

/**
 * The request on one line. The chevron shows the whole request, and a click on the line does the same:
 * the chevron's hit area covers the line while it is closed. Open, the text can be selected and scrolls
 * after eight lines.
 */
export function WorkRequest(props: WorkRowProps & { request: string }) {
  const { t } = useText();
  const id = `window-rail-load-request-${createUniqueId()}`;
  const request = () => requestText(props.request);
  const [clipped, setClipped] = createSignal(false);
  let line: HTMLParagraphElement | undefined;
  onSettled(() => {
    const element = line;
    if (!element || typeof ResizeObserver === "undefined") return;
    // A request that fits on its line has nothing to show. An open request wraps, so it is measured closed.
    const observer = new ResizeObserver(() => {
      if (!props.expanded) setClipped(element.scrollWidth > element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
  return (
    <div class="window-rail-load-request" data-expanded={props.expanded ? "" : undefined}>
      <p
        id={id}
        ref={(element) => {
          line = element;
        }}
        class="window-rail-load-request-text"
        data-empty={request().text ? undefined : ""}
      >
        {request().text || t("app.rail.load.attachmentOnly")}
      </p>
      <Show when={props.expanded || clipped()}>
        <Button
          variant="ghost"
          size="icon-xs"
          class="window-rail-load-request-toggle"
          aria-label={props.expanded ? t("app.rail.load.collapseRequest") : t("app.rail.load.expandRequest")}
          aria-expanded={props.expanded ? "true" : "false"}
          aria-controls={id}
          onClick={() => props.onToggle()}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      </Show>
    </div>
  );
}

/** One reading of the load, as a settings row: its name at the left and its value at the right. */
function StatRow(props: { label: string; value: string }) {
  return (
    <Item size="compact" class="settings-modal-row window-rail-load-stat">
      <ItemContent>
        <ItemTitle>{props.label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <span class="window-rail-load-stat-value">{props.value}</span>
      </ItemActions>
    </Item>
  );
}

/**
 * A settings row with a number: the name and its range at the left, the field at the right. The range
 * and the hints are the description, so the row keeps the layout of every other row of Settings.
 */
function NumberRow(props: {
  title: string;
  description: JSX.Element;
  hint?: string;
  min: number;
  max: number;
  step: number;
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
        <Show when={props.hint}>
          <ItemDescription id={hintId}>{props.hint}</ItemDescription>
        </Show>
      </ItemContent>
      <ItemActions>
        <Input
          class="window-rail-load-number"
          data-cuelume-type={undefined}
          type="number"
          min={String(props.min)}
          max={String(props.max)}
          step={String(props.step)}
          inputmode="numeric"
          aria-labelledby={titleId}
          aria-describedby={props.hint ? hintId : undefined}
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
 * The switch and the number of the cap on the agents that run at the same time, and the number of
 * channel tabs of one agent that run at the same time, which applies with the cap on or off. These are
 * rows of the card of the page, not a section of their own.
 */
function AgentLimitSettings(props: {
  limit: AgentLimitPreference;
  onChange: (preference: AgentLimitPreference) => void;
}) {
  const { t } = useText();
  return (
    <>
      <SwitchField
        checked={props.limit.enabled}
        onChange={(enabled) => props.onChange({ ...props.limit, enabled })}
        label={t("app.rail.load.limitTitle")}
        description={t("app.rail.load.limitHint")}
      />
      <Show when={props.limit.enabled}>
        <NumberRow
          title={t("app.rail.load.limitMax")}
          description={t("app.rail.load.limitUnit")}
          min={1}
          max={64}
          step={1}
          value={props.limit.max}
          onCommit={(value) => {
            const max = clampAgentLimit(value);
            props.onChange({ ...props.limit, enabled: true, max });
            return max;
          }}
        />
      </Show>
      <NumberRow
        title={t("app.rail.load.tabsTitle")}
        description={t("app.rail.load.tabsUnit")}
        hint={t("app.rail.load.tabsHint")}
        min={1}
        max={4}
        step={1}
        value={props.limit.tabsPerAgent ?? DEFAULT_AGENT_TABS}
        onCommit={(value) => {
          const tabsPerAgent = clampAgentTabs(value);
          props.onChange({ ...props.limit, tabsPerAgent });
          return tabsPerAgent;
        }}
      />
    </>
  );
}

/**
 * The switches and the interval of the automatic recovery, and the task reviewer that looks only while it
 * is on. The switch of the task reviewer shows also while the recovery is off. What both did lately is a
 * section of its own, below.
 */
function RecoverySettings(props: {
  recovery: LoadSnapshot["recovery"];
  taskWatch: TaskWatchState;
  onChange: (preference: AutoRecoveryPreference) => void;
  onTaskWatchChange: (preference: TaskWatchPreference) => void;
  onOpenTaskReviewerSettings: (() => void) | undefined;
}) {
  const { t } = useText();
  const change = (patch: Partial<AutoRecoveryPreference>) =>
    props.onChange({
      enabled: props.recovery.enabled,
      intervalMinutes: props.recovery.intervalMinutes,
      reassign: props.recovery.reassign,
      ...patch,
    });
  return (
    <>
      <SwitchField
        checked={props.recovery.enabled}
        onChange={(enabled) => change({ enabled })}
        label={t("app.rail.load.recoveryTitle")}
        description={t("app.rail.load.recoveryHint")}
      />
      <Show when={props.recovery.enabled}>
        <NumberRow
          title={t("app.rail.load.recoveryEvery")}
          description={t("app.rail.load.recoveryUnit")}
          min={5}
          max={1440}
          step={5}
          value={props.recovery.intervalMinutes}
          onCommit={(value) => {
            const minutes = clampRecoveryMinutes(value);
            change({ intervalMinutes: minutes });
            return minutes;
          }}
        />
        <SwitchField
          checked={props.recovery.reassign}
          onChange={(reassign) => change({ reassign })}
          label={t("app.rail.load.recoveryReassign")}
          description={t("app.rail.load.recoveryReassignHint")}
        />
      </Show>
      {/* Always shown: the switch says that it acts only with "Resume by itself" on, and the Settings
          page can turn the reviewer on while "Resume by itself" is off. */}
      <TaskWatchSettings
        taskWatch={props.taskWatch}
        onChange={props.onTaskWatchChange}
        onOpenSettings={props.onOpenTaskReviewerSettings}
      />
    </>
  );
}

/** The switch of the task reviewer, which model decides, its threshold, and the way to its page in Settings. */
function TaskWatchSettings(props: {
  taskWatch: TaskWatchState;
  onChange: (preference: TaskWatchPreference) => void;
  onOpenSettings: (() => void) | undefined;
}) {
  const { t } = useText();
  return (
    <>
      <SwitchField
        checked={props.taskWatch.enabled}
        onChange={(enabled) => props.onChange({ enabled, quietMinutes: props.taskWatch.quietMinutes })}
        label={t("app.rail.load.watchTitle")}
        description={t("app.rail.load.watchHint")}
      />
      <Show when={props.taskWatch.enabled}>
        <NumberRow
          title={t("app.rail.load.watchQuiet")}
          description={t("app.rail.load.watchQuietUnit")}
          hint={props.taskWatch.modelReady ? t("app.rail.load.watchModel") : t("app.rail.load.watchModelOff")}
          min={5}
          max={120}
          step={5}
          value={props.taskWatch.quietMinutes}
          onCommit={(value) => {
            const quietMinutes = clampWatchMinutes(value);
            // A late change, sent on blur when the switch is clicked, must not turn the reviewer on again.
            props.onChange({ enabled: props.taskWatch.enabled, quietMinutes });
            return quietMinutes;
          }}
        />
      </Show>
      <Show when={props.onOpenSettings}>
        {(open) => (
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("app.rail.load.watchSettings")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button
                variant="outline"
                size="sm"
                class="window-rail-load-action window-rail-load-link"
                aria-label={t("app.rail.load.watchSettings")}
                onClick={() => open()()}
              >
                <SlidersHorizontal aria-hidden="true" />
              </Button>
            </ItemActions>
          </Item>
        )}
      </Show>
    </>
  );
}
