// The bridge calls behind an agent's Folders row, the Folders page, the chat's folder drop and the
// Instructions page. Only the local server has them here. The mobile app changes the folders of a
// joined server through `agent-folders-v1`; the desktop does not use it yet.

import type { AgentFolderCalls } from "@buildersbot/ui/features/conversation/AgentFolders";
import type {
  AgentInstructionsCalls,
  AgentInstructionsFileCalls,
} from "@buildersbot/ui/features/conversation/AgentInstructionsView";

/** Read on each call: tests and stories replace `window.buildersbot` per case. */
export function agentFolderCalls(): AgentFolderCalls {
  return {
    list: (agentId) => window.buildersbot.agent.listAgentFolders(agentId),
    choose: (agentId, replace) =>
      window.buildersbot.agent.chooseAgentFolder(replace === undefined ? { agentId } : { agentId, replace }),
    add: (agentId, path) => window.buildersbot.agent.addAgentFolder({ agentId, path }),
    remove: (agentId, path) => window.buildersbot.agent.removeAgentFolder({ agentId, path }),
    drop: (agentId, folder) => window.buildersbot.agent.addDroppedAgentFolder(agentId, folder),
    exclude: (agentId) => window.buildersbot.agent.chooseAgentExclusion(agentId),
    addExclusion: (agentId, path) => window.buildersbot.agent.addAgentExclusion({ agentId, path }),
    include: (agentId, path) => window.buildersbot.agent.removeAgentExclusion({ agentId, path }),
  };
}

type InstructionsWatcher = Parameters<AgentInstructionsFileCalls["watch"]>[0];

/** The Instructions page and each chat line show the file. A save in one of them updates the others. */
const instructionsWatchers = new Set<InstructionsWatcher>();

/** The instruction file in a local agent's workspace. The Team API does not carry it. */
export function agentInstructionsCalls(): Omit<AgentInstructionsCalls, "openLink"> {
  return {
    read: (agentId) => window.buildersbot.agent.readAgentInstructions(agentId),
    save: async (agentId, text, expected) => {
      const file = await window.buildersbot.agent.saveAgentInstructions({ agentId, text, expected });
      for (const watcher of instructionsWatchers) watcher(agentId, file);
      return file;
    },
    watch: (watcher) => {
      instructionsWatchers.add(watcher);
      return () => instructionsWatchers.delete(watcher);
    },
    reveal: (agentId) => window.buildersbot.agent.revealAgentInstructions(agentId),
  };
}
