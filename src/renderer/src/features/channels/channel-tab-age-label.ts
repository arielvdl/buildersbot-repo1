import type { TextValue } from "@buildersbot/ui/text";
import { channelTabAge } from "./channel-tab-overview-model";

/** How long ago a tab changed, written for the person: "5 min ago", or a short date past a month. */
export function channelTabAgeLabel({ t, format }: Pick<TextValue, "t" | "format">, value: string): string {
  const age = channelTabAge(value);
  switch (age.unit) {
    case "now":
      return t("channel.topic.age.now");
    case "minute":
      return t("channel.topic.age.minute", { count: age.count });
    case "hour":
      return t("channel.topic.age.hour", { count: age.count });
    case "day":
      return t("channel.topic.age.day", { count: age.count });
    default:
      return format.date(age.at, { month: "short", day: "numeric" });
  }
}
