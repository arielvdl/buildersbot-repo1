import type { AppInfo } from "@buildersbot/contracts/ipc";
import { ComposerPresetsSection } from "@buildersbot/ui/features/settings/ComposerPresetsSection";
import {
  addComposerPreset,
  removeComposerPreset,
  updateComposerPreset,
  useComposerPresets,
} from "../../composer-presets-preference";
import { currentDevicePlatform } from "../../send-shortcut-preference";

export interface SettingsPromptShortcutsTabProps {
  platform: AppInfo["platform"] | undefined;
}

/** The saved prompts, in a tab of their own: the list can grow without crowding the general settings. */
export function SettingsPromptShortcutsTab(props: SettingsPromptShortcutsTabProps) {
  const presets = useComposerPresets();
  return (
    <ComposerPresetsSection
      embedded
      presets={presets()}
      devicePlatform={props.platform ?? currentDevicePlatform()}
      onAdd={addComposerPreset}
      onUpdate={updateComposerPreset}
      onRemove={removeComposerPreset}
    />
  );
}
