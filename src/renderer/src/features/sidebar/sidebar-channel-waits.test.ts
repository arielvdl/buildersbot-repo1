import { sidebarChannelWaits } from "@buildersbot/ui/features/sidebar/sidebar-agent-states";
import { describe, expect, it } from "vitest";

const channels = [
  {
    id: "channel-1",
    archived: false,
    threads: [
      { agentId: "agent-a", threadId: "thread-tab-1", topicId: "tab-1" },
      { agentId: "agent-a", threadId: "thread-tab-2", topicId: "tab-2" },
    ],
  },
  { id: "channel-2", archived: false, threads: [{ agentId: "agent-b", threadId: "thread-b" }] },
];

describe("sidebarChannelWaits", () => {
  it("names the tab whose thread waits, so a click opens it", () => {
    const waits = sidebarChannelWaits({
      channels,
      prompts: [{ agentId: "agent-a", threadId: "thread-tab-2", questions: [{ question: "Merge?" }] }],
      takeovers: [],
      approvals: [],
    });
    expect(waits["channel-1"]).toEqual({ kind: "waiting", reason: "question", detail: "Merge?", topicId: "tab-2" });
  });

  it("leaves the tab out when the host does not name it", () => {
    const waits = sidebarChannelWaits({
      channels,
      prompts: [],
      takeovers: [],
      approvals: [{ agentId: "agent-b", threadId: "thread-b", command: "ls", reason: null }],
    });
    expect(waits["channel-2"]).toEqual({ kind: "waiting", reason: "approval", detail: "ls" });
  });
});
