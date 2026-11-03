import { chatTagReferences } from "@buildersbot/contracts/chat-tag-references";
import type { InstalledSkill, ServerSummary } from "@buildersbot/contracts/ipc";
import { createEffect, createMemo, createSignal } from "solid-js";
import { conversationRuntime } from "../conversation-runtime";
import type { ConversationProps } from "../conversation-types";

/**
 * The agents whose skills a channel message may use: the ones that the draft tags, or the only agent of a
 * channel that has one. A skill belongs to one agent, so a channel with several agents and no tag has none.
 */
export function channelSkillAgentIds(
  draftText: string,
  members: readonly { readonly id: string }[],
): readonly string[] {
  const known = new Set(members.map((member) => member.id));
  const tagged = chatTagReferences(draftText)
    .filter((reference) => reference.kind === "agent" && known.has(reference.id))
    .map((reference) => reference.id);
  if (tagged.length > 0) return [...new Set(tagged)];
  return members.length === 1 && members[0] ? [members[0].id] : [];
}

/** A joined server that predates the list of installed skills has none to offer. */
function skillsSupported(server: ServerSummary | undefined): boolean {
  return server?.kind !== "remote" || server.compatibility?.capabilities.includes("installed-skills") === true;
}

export interface ChannelSkillsDeps {
  props: ConversationProps;
  /** The text of the draft, with its tags as markers. */
  draftText: () => string;
  /** The agents of the channel that a message can reach. */
  members: () => readonly { readonly id: string }[];
}

/** The skills of the agents that the draft of a channel message addresses. */
export function createChannelSkills(deps: ChannelSkillsDeps) {
  const agentIds = createMemo(() => channelSkillAgentIds(deps.draftText(), deps.members()).join("\0"));
  const [skills, setSkills] = createSignal<InstalledSkill[]>([]);
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  let request = 0;
  createEffect(
    () => ({
      ids: agentIds(),
      supported: skillsSupported(deps.props.server),
      connection: deps.props.server?.connectionSequence ?? 0,
      retry: retry(),
    }),
    ({ ids, supported }) => {
      const current = ++request;
      if (!ids || !supported) {
        setSkills([]);
        setLoadFailed(false);
        return;
      }
      const agent = conversationRuntime(deps.props).agent;
      void Promise.all(ids.split("\0").map((id) => agent.listInstalledSkills(id)))
        .then((lists) => {
          if (current !== request) return;
          const seen = new Set<string>();
          setSkills(lists.flat().filter((skill) => !seen.has(skill.skillId) && seen.add(skill.skillId)));
          setLoadFailed(false);
        })
        .catch(() => {
          if (current !== request) return;
          setLoadFailed(true);
        });
    },
  );
  return {
    skills,
    loadFailed,
    /** True while no agent is addressed, so an empty list asks for a mention. */
    needsMention: () => agentIds() === "",
    reload: () => setRetry((count) => count + 1),
  };
}
