import type { SidebarChannelStageFlag } from "@buildersbot/ui/features/sidebar/sidebar-types";
import {
  channelStageSettingsFor,
  updateChannelStage,
  withChannelStageCollapse,
  withChannelStageEnabled,
  withChannelStageScope,
} from "./channel-stage-preference";

/** The flag of the section rail, from the saved preference of the scope and the open channel. */
export function createChannelStageFlag(
  scope: () => string,
  channelId: () => string | null,
): () => SidebarChannelStageFlag {
  return () => {
    const settings = channelStageSettingsFor(scope(), channelId());
    return {
      ...settings,
      channelOpen: channelId() !== null,
      onEnabledChange: (enabled) =>
        updateChannelStage(scope(), (current) =>
          withChannelStageEnabled(current, channelId(), settings.scope, enabled),
        ),
      onCollapseChange: (collapse) =>
        updateChannelStage(scope(), (current) => withChannelStageCollapse(current, collapse)),
      onScopeChange: (next) =>
        updateChannelStage(scope(), (current) => withChannelStageScope(current, channelId(), next)),
    };
  };
}
