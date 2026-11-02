import { CHANNEL_TOPIC_LIMIT, type ChannelSummary, type ChannelTabReport } from "@buildersbot/contracts/ipc";
import type { AppTextKey } from "@buildersbot/i18n";
import type { TextValue } from "@buildersbot/ui/text";

const OUTCOME_LABEL = {
  done: "settings.profile.tabReports.total.done",
  "not-done": "settings.profile.tabReports.total.notDone",
  other: "settings.profile.tabReports.total.other",
} as const satisfies Record<ChannelTabReport["outcome"], AppTextKey>;

/**
 * Why a record cannot continue in a new tab, or null when it can: its channel is gone or deleted, or
 * already has the most tabs a channel can have.
 */
export function tabReportContinueBlock(channel: ChannelSummary | undefined): AppTextKey | null {
  if (!channel) return "settings.profile.tabReports.continue.unavailable.gone";
  if (channel.archived) return "settings.profile.tabReports.continue.unavailable.archived";
  return (channel.topics?.length ?? 0) >= CHANNEL_TOPIC_LIMIT
    ? "settings.profile.tabReports.continue.unavailable.full"
    : null;
}

/**
 * The short block that fills the message box of the new tab: the title, how it ended, the note and the
 * last result. The person reads it and sends it, or not; nothing is sent from here.
 */
export function tabReportDraftText(report: ChannelTabReport, text: Pick<TextValue, "t">): string {
  const { t } = text;
  return [
    t("settings.profile.tabReports.continue.draftIntro", {
      tab: report.topicName,
      outcome: t(OUTCOME_LABEL[report.outcome]),
    }),
    ...(report.note ? [t("settings.profile.tabReports.continue.draftNote", { note: report.note })] : []),
    ...(report.lastResult
      ? [t("settings.profile.tabReports.continue.draftResult", { result: report.lastResult })]
      : []),
  ].join("\n");
}
