/**
 * The flag at the foot of the section rail. It opens the settings of the agent stage: show it, fold
 * it while nobody works, and whether the choice is for the open channel or for all channels. The
 * rail keeps no state of its own: the desktop gives the values and takes the changes.
 */

import { Button, Flag, MotionTooltip, Popover, RadioGroup, SwitchField } from "@buildersbot/ui";
import { createSignal } from "solid-js";
import { useText } from "../../text";
import type { SidebarChannelStageFlag as StageFlag } from "./sidebar-types";

export function SidebarChannelStageFlag(props: { stage: StageFlag }) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  return (
    <Popover.Root open={open()} onOpenChange={setOpen} placement="right-end" gutter={8}>
      {/* The tooltip would cover the settings while they are open. */}
      <MotionTooltip content={t("channel.stage.flag.label")} suppressed={open()}>
        <Popover.Trigger
          as={Button}
          variant="ghost"
          type="button"
          class="server-rail-button section-rail-stage-flag"
          aria-label={t("channel.stage.flag.label")}
          data-active={props.stage.enabled ? "" : undefined}
        >
          <Flag class="section-rail-stage-flag-icon" aria-hidden="true" />
        </Popover.Trigger>
      </MotionTooltip>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface section-rail-stage-settings">
          <Popover.Title class="section-rail-stage-title">{t("channel.stage.flag.title")}</Popover.Title>
          <SwitchField
            checked={props.stage.enabled}
            onChange={props.stage.onEnabledChange}
            label={t("channel.stage.flag.enable")}
            description={t("channel.stage.flag.enableHint")}
          />
          <SwitchField
            checked={props.stage.collapse}
            onChange={props.stage.onCollapseChange}
            label={t("channel.stage.flag.collapse")}
            description={t("channel.stage.flag.collapseHint")}
          />
          <RadioGroup.Root
            class="section-rail-stage-scope"
            aria-label={t("channel.stage.flag.scope")}
            value={props.stage.scope}
            onChange={(value: string) => {
              if (value === "channel" || value === "all") props.stage.onScopeChange(value);
            }}
          >
            <RadioGroup.Label class="section-rail-stage-scope-label">{t("channel.stage.flag.scope")}</RadioGroup.Label>
            <RadioGroup.Item
              class="section-rail-stage-scope-option"
              value="channel"
              disabled={!props.stage.channelOpen}
            >
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="section-rail-stage-scope-dot" />
              <RadioGroup.ItemLabel>{t("channel.stage.flag.scopeChannel")}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
            <RadioGroup.Item class="section-rail-stage-scope-option" value="all">
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="section-rail-stage-scope-dot" />
              <RadioGroup.ItemLabel>{t("channel.stage.flag.scopeAll")}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
          </RadioGroup.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
