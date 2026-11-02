import type { AvatarHue } from "@buildersbot/contracts/ipc";
import { For } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";

interface TeamMember {
  seed: string;
  /** Not shown: it only picks the role symbol on the mark. */
  role: string;
  hue: AvatarHue | null;
  followPointer: boolean;
}

// The tallest is in the middle (the second child; `auth.css` sizes it). Each seed gives the mark its
// own phase, so the three do not move together.
const TEAM: readonly TeamMember[] = [
  { seed: "login-team-research", role: "Research", hue: 185, followPointer: false },
  { seed: "login-team-code", role: "Code", hue: null, followPointer: true },
  { seed: "login-team-design", role: "Design", hue: 320, followPointer: false },
];

/**
 * The top of the sign-in screen: three agents as a team. The group only decorates, so it is hidden
 * from assistive technology and the title below it names the screen. The motion is CSS on the mark,
 * and only the middle one follows the pointer.
 */
export function AccountLoginTeam() {
  return (
    <div class="account-login-team" aria-hidden="true">
      <For each={TEAM}>
        {(member) => (
          <AgentAvatar
            class="account-login-team-member"
            seed={member.seed}
            title={member.role}
            hue={member.hue}
            mood="idle"
            motion="always"
            followPointer={member.followPointer}
          />
        )}
      </For>
    </div>
  );
}
