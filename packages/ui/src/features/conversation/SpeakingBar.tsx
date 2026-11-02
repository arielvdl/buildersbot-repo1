import { Button } from "@buildersbot/ui";
import type { AgentProfile } from "@buildersbot/ui/data";
import { AgentAvatar } from "@buildersbot/ui/features/agents/AgentAvatar";
import { StopIcon } from "@buildersbot/ui/features/conversation/ConversationIcons";
import { VoiceWaveform } from "@buildersbot/ui/features/conversation/VoiceRecordingMorph";
import { useText } from "@buildersbot/ui/text";

export interface SpeakingBarProps {
  agent: AgentProfile;
  /** The part of the reply that plays now. */
  caption: string;
  /** The loudness of the voice, oldest first, from 0 to 1. */
  levels: readonly number[];
  onStop: () => void;
}

/** Above the composer while a reply is read aloud: the agent, its voice, the part that plays now, and Stop. */
export function SpeakingBar(props: SpeakingBarProps) {
  const { t } = useText();
  return (
    <section class="speaking-bar" aria-label={t("conversation.speech.label", { name: props.agent.name })}>
      <AgentAvatar agent={props.agent} mood="responded" motion="always" class="speaking-bar-avatar" />
      <VoiceWaveform levels={props.levels} class="speaking-bar-waveform" />
      <p class="speaking-bar-caption">{props.caption}</p>
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        class="speaking-bar-stop"
        aria-label={t("conversation.speech.stop")}
        title={t("conversation.speech.stop")}
        onClick={() => props.onStop()}
      >
        <StopIcon />
      </Button>
    </section>
  );
}
