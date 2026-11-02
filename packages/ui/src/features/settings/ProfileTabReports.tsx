import type { ChannelTabOutcome, ChannelTabReport } from "@buildersbot/contracts/ipc";
import type { AppTextKey } from "@buildersbot/i18n";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorReference,
  IconButton,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  SlidingTabs,
  Text,
  Trash2,
} from "@buildersbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";

export type ProfileTabReportsPeriod = "week" | "month" | "year";
export type ProfileTabReportsPhase = "loading" | "ready" | "error" | "unsupported";

/** The closed tabs of this computer for one period, as the store keeps them: only the pages that were asked for. */
export interface ProfileTabReportsState {
  phase: ProfileTabReportsPhase;
  period: ProfileTabReportsPeriod;
  totals: Readonly<Record<ChannelTabOutcome, number>> | null;
  reports: readonly ChannelTabReport[];
  hasMore: boolean;
  loadingMore: boolean;
  errorReference: string | null;
  onPeriodChange: (period: ProfileTabReportsPeriod) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Deletes one record, then reads the first page again. False when the delete failed. */
  onDelete: (id: string) => Promise<boolean>;
  /** The reason a record cannot continue in a new tab, such as a channel that is gone. Null when it can. */
  continueBlocked?: ((report: ChannelTabReport) => AppTextKey | null) | undefined;
  /** Opens a new tab in the channel of the record, with a short summary in its message box. False when it failed. */
  onContinue?: ((report: ChannelTabReport) => Promise<boolean>) | undefined;
}

const PERIODS = [
  { value: "week", label: "settings.profile.tabReports.period.week" },
  { value: "month", label: "settings.profile.tabReports.period.month" },
  { value: "year", label: "settings.profile.tabReports.period.year" },
] as const satisfies readonly { value: ProfileTabReportsPeriod; label: AppTextKey }[];

const OUTCOMES = [
  { value: "done", label: "settings.profile.tabReports.total.done", badge: "success-light" },
  { value: "not-done", label: "settings.profile.tabReports.total.notDone", badge: "warning-light" },
  { value: "other", label: "settings.profile.tabReports.total.other", badge: "secondary" },
] as const satisfies readonly { value: ChannelTabOutcome; label: AppTextKey; badge: string }[];

const REPORT_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Closed tabs" of the Profile: how many tabs ended Done, Not done or Other in a period, and the
 * newest records with their note and what the agents did. Nothing shows when the host cannot list
 * them. The store loads the pages; this component only draws what it is given.
 */
export function ProfileTabReports(props: { state: ProfileTabReportsState }) {
  const { t, format } = useText();
  const [deleting, setDeleting] = createSignal<ChannelTabReport | null>(null);
  const [deleteFailed, setDeleteFailed] = createSignal(false);
  /** The record that opens a new tab now, and the one whose last try failed. */
  const [continuing, setContinuing] = createSignal<string | null>(null);
  const [continueFailed, setContinueFailed] = createSignal<string | null>(null);
  const outcome = (value: ChannelTabOutcome) => OUTCOMES.find((item) => item.value === value) ?? OUTCOMES[2];
  const duration = (report: ChannelTabReport) => {
    const span = Math.max(0, Date.parse(report.closedAt) - Date.parse(report.openedAt));
    if (span < HOUR)
      return t("settings.profile.tabReports.duration.minute", { count: Math.max(1, Math.round(span / MINUTE)) });
    if (span < DAY) return t("settings.profile.tabReports.duration.hour", { count: Math.round(span / HOUR) });
    return t("settings.profile.tabReports.duration.day", { count: Math.round(span / DAY) });
  };
  const details = (report: ChannelTabReport) =>
    [
      format.date(Date.parse(report.closedAt), REPORT_TIME_FORMAT),
      t("settings.profile.tabReports.duration", { duration: duration(report) }),
      t("settings.profile.tabReports.tasks", {
        completed: report.tasks.completed,
        failed: report.tasks.failed,
        open: report.tasks.open,
      }),
      ...(report.agents.length > 0
        ? [t("settings.profile.tabReports.agents", { names: format.list(report.agents.map((agent) => agent.name)) })]
        : []),
    ].join(" · ");
  async function continueTab(report: ChannelTabReport, onContinue: (report: ChannelTabReport) => Promise<boolean>) {
    if (continuing() !== null) return;
    setContinuing(report.id);
    setContinueFailed(null);
    const opened = await onContinue(report);
    setContinuing(null);
    if (!opened) setContinueFailed(report.id);
  }
  async function confirmDelete(): Promise<void> {
    const target = deleting();
    if (!target) return;
    setDeleteFailed(false);
    if (await props.state.onDelete(target.id)) setDeleting(null);
    else setDeleteFailed(true);
  }
  return (
    <Show when={props.state.phase !== "unsupported"}>
      <SettingsSection
        title={t("settings.profile.tabReports.title")}
        description={t("settings.profile.tabReports.description")}
        actions={
          <SlidingTabs.Root
            value={props.state.period}
            onChange={(value) => {
              const period = PERIODS.find((item) => item.value === value);
              if (period) props.state.onPeriodChange(period.value);
            }}
          >
            <SlidingTabs.List aria-label={t("settings.profile.tabReports.period.label")}>
              <For each={PERIODS}>
                {(period) => <SlidingTabs.Trigger value={period.value}>{t(period.label)}</SlidingTabs.Trigger>}
              </For>
            </SlidingTabs.List>
          </SlidingTabs.Root>
        }
      >
        <Show when={props.state.phase === "error"}>
          <div class="profile-card profile-activity-placeholder">
            <Text role="alert" class="settings-modal-error">
              {t("settings.profile.tabReports.error")}
              <ErrorReference reference={props.state.errorReference} />
            </Text>
            <Button variant="secondary" onClick={props.state.onRetry}>
              {t("common.retry")}
            </Button>
          </div>
        </Show>
        <Show when={props.state.phase === "loading" && props.state.totals === null}>
          <div class="profile-card profile-activity-placeholder" role="status">
            <Text tone="muted">{t("settings.profile.tabReports.loading")}</Text>
          </div>
        </Show>
        <Show when={props.state.phase === "ready" ? props.state.totals : null}>
          {(totals) => (
            <>
              <dl class="profile-tiles">
                <For each={OUTCOMES}>
                  {(item) => (
                    <div class="profile-tile">
                      <dt>{t(item.label)}</dt>
                      <dd>
                        <strong>{format.number(totals()[item.value])}</strong>
                      </dd>
                    </div>
                  )}
                </For>
              </dl>
              <Show
                when={props.state.reports.length > 0}
                fallback={
                  <div class="profile-card profile-activity-placeholder">
                    <Text tone="muted">{t("settings.profile.tabReports.empty")}</Text>
                  </div>
                }
              >
                <ItemGroup class="settings-modal-card">
                  <For each={props.state.reports} keyed={(report) => report.id}>
                    {(report) => (
                      <Item class="profile-tab-report">
                        <ItemContent>
                          <ItemTitle class="profile-tab-report-title">
                            <Badge variant={outcome(report().outcome).badge}>
                              {t(outcome(report().outcome).label)}
                            </Badge>
                            <span class="profile-tab-report-name">
                              {report().topicName} · {report().channelName}
                            </span>
                          </ItemTitle>
                          <Show when={report().note}>
                            {(note) => <ItemDescription class="profile-tab-report-note">{note()}</ItemDescription>}
                          </Show>
                          <ItemDescription>{details(report())}</ItemDescription>
                          <Show when={props.state.continueBlocked?.(report())}>
                            {(reason) => (
                              <ItemDescription class="profile-tab-report-blocked">{t(reason())}</ItemDescription>
                            )}
                          </Show>
                          <Show when={continueFailed() === report().id}>
                            <ItemDescription role="alert" class="profile-tab-report-failed">
                              {t("settings.profile.tabReports.continue.failed")}
                            </ItemDescription>
                          </Show>
                          <Show when={report().lastResult}>
                            {(result) => (
                              <ItemDescription class="profile-tab-report-result" title={result()}>
                                {t("settings.profile.tabReports.lastResult", { result: result() })}
                              </ItemDescription>
                            )}
                          </Show>
                        </ItemContent>
                        <ItemActions>
                          <Show when={props.state.onContinue}>
                            {(onContinue) => (
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={t("settings.profile.tabReports.continue.label", {
                                  name: report().topicName,
                                })}
                                disabled={props.state.continueBlocked?.(report()) != null}
                                loading={continuing() === report().id}
                                onClick={() => void continueTab(report(), onContinue())}
                              >
                                {t("settings.profile.tabReports.continue.action")}
                              </Button>
                            )}
                          </Show>
                          <IconButton
                            variant="ghost"
                            label={t("settings.profile.tabReports.delete.label", { name: report().topicName })}
                            onClick={() => {
                              setDeleteFailed(false);
                              setDeleting(report());
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                          </IconButton>
                        </ItemActions>
                      </Item>
                    )}
                  </For>
                </ItemGroup>
                <Show when={props.state.hasMore}>
                  <div class="profile-tab-reports-more">
                    <Button variant="outline" loading={props.state.loadingMore} onClick={props.state.onLoadMore}>
                      {t("settings.profile.tabReports.more")}
                    </Button>
                  </div>
                </Show>
              </Show>
            </>
          )}
        </Show>
        <ConfirmDialog
          open={deleting() !== null}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
          title={t("settings.profile.tabReports.delete.title")}
          description={t("settings.profile.tabReports.delete.description")}
          confirmLabel={t("settings.profile.tabReports.delete.confirm")}
          pendingLabel={t("settings.profile.tabReports.delete.pending")}
          error={deleteFailed() ? t("settings.profile.tabReports.delete.failed") : undefined}
        />
      </SettingsSection>
    </Show>
  );
}
