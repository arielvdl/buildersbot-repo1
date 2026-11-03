import type { AwaitingReplyItem } from "@buildersbot/ui/features/conversation/AwaitingReplies";
import { QuickChatAgentStrip } from "@buildersbot/ui/features/quick-chat/QuickChatAgentStrip";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { quickChatStripModel } from "../src/features/quick-chat/quick-chat-agent-strip-model";
import { StoryChannelConversation } from "./channel-story-support";
import { requireFixture, STORY_AGENTS } from "./fixtures";

/*
 * The strip of the agents that a Quick chat conversation called, above the messages. The data is example
 * data: the agents and the lines are made up for the story. The desktop reads the same fields from the
 * conversation's requests and the agents' running turns (`QuickChatAgentStripHost`).
 */

const meta = {
  title: "Conversation/Quick chat agent strip",
  component: StoryChannelConversation,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof StoryChannelConversation>;

export default meta;
type Story = StoryObj<typeof meta>;

const agent = (id: string) =>
  requireFixture(
    STORY_AGENTS.find((candidate) => candidate.id === id),
    id,
  );
const SELF = agent("chief");
const RESEARCH = agent("research");
const SALES = agent("sales");

function rows(states: [AwaitingReplyItem["state"], AwaitingReplyItem["state"]]): AwaitingReplyItem[] {
  return [
    { id: "m1:research", agent: RESEARCH, name: RESEARCH.name, state: states[0] },
    { id: "m1:sales", agent: SALES, name: SALES.name, state: states[1] },
  ];
}

const LINES = {
  "turn-research": [{ id: "turn-research:0", text: "Reading the pricing pages", at: 0, kind: "read" as const }],
};

function Strip(props: { states: [AwaitingReplyItem["state"], AwaitingReplyItem["state"]]; open?: boolean }) {
  const [open, setOpen] = createSignal(props.open ?? false);
  const model = () =>
    quickChatStripModel({
      rows: rows(props.states),
      self: SELF,
      activeTurns: { [RESEARCH.id]: "turn-research" },
      stepLines: LINES,
    });
  return (
    <QuickChatAgentStrip
      agents={model().agents}
      actors={model().actors}
      links={model().links}
      finished={!model().live}
      open={open()}
      onToggle={() => setOpen((value) => !value)}
    />
  );
}

/** Two agents called: one reads, one waits its turn. The strip is folded. */
export const AtWork: Story = {
  render: () => <StoryChannelConversation stage={<Strip states={["working", "asked"]} />} />,
};

/** The same work with the stage unfolded: the Quick chat agent at the head of the table. */
export const Unfolded: Story = {
  render: () => <StoryChannelConversation stage={<Strip states={["working", "asked"]} open />} />,
};

/** Every agent has answered: the strip says so for a moment before it goes. */
export const Finished: Story = {
  render: () => <StoryChannelConversation stage={<Strip states={["replied", "replied"]} />} />,
};
