import {
  ChannelStage,
  type ChannelStageActivity,
  type ChannelStageActor,
  type ChannelStageLink,
} from "@buildersbot/ui/features/channels/ChannelStage";
import { createSignal, onCleanup, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { StoryChannelConversation } from "./channel-story-support";

/*
 * The agent stage above the messages of a channel, inside the real conversation view. The data is
 * example data: the agents, the models and the lines are made up for the story. The desktop reads the
 * same fields from the channel page (`ChannelStageHost`).
 */

const meta = {
  title: "Conversation/Channel stage",
  component: StoryChannelConversation,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof StoryChannelConversation>;

export default meta;
type Story = StoryObj<typeof meta>;

function actor(
  id: string,
  name: string,
  provider: ChannelStageActor["provider"],
  model: string,
  seat: number,
  activity: ChannelStageActivity,
  line: string | null = null,
): ChannelStageActor {
  return {
    id,
    name,
    provider,
    model,
    hue: null,
    activity,
    line,
    delegatesTo: null,
    seat,
  };
}

const REQUEST = { title: "Fix the sign-in flow and cover it with tests", parts: 4, done: 1 };

/** Four agents at work: the lead at the back, the others in fixed seats, and a hand-off line. */
export const AtWork: Story = {
  render: () => (
    <StoryChannelConversation
      stage={
        <ChannelStage
          collapsed={false}
          overflow={0}
          request={REQUEST}
          links={[{ key: "t1", from: "lead", to: "back" }]}
          actors={[
            { ...actor("lead", "Chief", "claude", "claude-opus-5-5", 0, "delegating", null), delegatesTo: "back" },
            actor("back", "Backend", "codex", "gpt-5.5", 2, "editing", "Making the requested changes…"),
            actor("qa", "QA", "claude", "claude-sonnet-5-5", 1, "running", "Checking the work…"),
            actor(
              "research",
              "Research",
              "claude",
              "claude-haiku-5-5",
              3,
              "reading",
              "Gathering the relevant information…",
            ),
          ]}
        />
      }
    />
  ),
};

/** The 8 behaviours at once, in the order the stage model gives: the ones that need attention first. */
export const Behaviors: Story = {
  render: () => (
    <StoryChannelConversation
      stage={
        <ChannelStage
          collapsed={false}
          overflow={2}
          request={{ ...REQUEST, done: 2 }}
          links={[]}
          actors={[
            actor("f", "Wait", "grok", "grok-4", 5, "waiting"),
            actor("g", "Fail", "codex", "gpt-5.5", 6, "failed"),
            actor("e", "Hand", "claude", "claude-sonnet-5-5", 4, "delegating"),
            actor("a", "Chief", "claude", "claude-opus-5-5", 0, "thinking"),
            actor("b", "Read", "claude", "claude-sonnet-5-5", 1, "reading", "Gathering the relevant information…"),
            actor("c", "Edit", "codex", "gpt-5.5", 2, "editing", "Making the requested changes…"),
            actor("d", "Run", "claude", "claude-haiku-5-5", 3, "running", "Checking the work…"),
            actor("h", "Done", "claude", "claude-opus-5-5", 7, "done"),
          ]}
        />
      }
    />
  ),
};

/** Nobody works and the reader chose to fold the stage: a strip, and nothing runs in it. */
export const Folded: Story = {
  render: () => (
    <StoryChannelConversation stage={<ChannelStage collapsed overflow={0} request={null} links={[]} actors={[]} />} />
  ),
};

/** Nobody works and the stage stays open. */
export const Empty: Story = {
  render: () => (
    <StoryChannelConversation
      stage={<ChannelStage collapsed={false} overflow={0} request={null} links={[]} actors={[]} />}
    />
  ),
};

interface Step {
  at: number;
  actors: ChannelStageActor[];
  links: ChannelStageLink[];
  parts: number;
}

/** A short run in time: agents arrive one by one, hand work on, finish and leave. */
function script(): Step[] {
  const lead = (activity: ChannelStageActivity, line: string | null = null) =>
    actor("lead", "Chief", "claude", "claude-opus-5-5", 0, activity, line);
  const back = (activity: ChannelStageActivity, line: string | null = null) =>
    actor("back", "Backend", "codex", "gpt-5.5", 2, activity, line);
  const qa = (activity: ChannelStageActivity, line: string | null = null) =>
    actor("qa", "QA", "claude", "claude-sonnet-5-5", 1, activity, line);
  const link = (to: string): ChannelStageLink => ({ key: `t-${to}`, from: "lead", to });
  return [
    { at: 0, actors: [], links: [], parts: 0 },
    { at: 1200, actors: [lead("thinking")], links: [], parts: 3 },
    {
      at: 3500,
      actors: [{ ...lead("delegating"), delegatesTo: "back" }, back("thinking")],
      links: [link("back")],
      parts: 3,
    },
    {
      at: 5500,
      actors: [lead("thinking"), back("reading", "Gathering the relevant information…")],
      links: [link("back")],
      parts: 3,
    },
    {
      at: 8000,
      actors: [lead("thinking"), back("editing", "Making the requested changes…")],
      links: [link("back")],
      parts: 3,
    },
    {
      at: 10500,
      actors: [{ ...lead("delegating"), delegatesTo: "qa" }, back("editing"), qa("thinking")],
      links: [link("back"), link("qa")],
      parts: 3,
    },
    {
      at: 12500,
      actors: [lead("thinking"), back("waiting"), qa("running", "Checking the work…")],
      links: [link("back"), link("qa")],
      parts: 3,
    },
    {
      at: 15500,
      actors: [lead("thinking"), back("done"), qa("running", "Checking the work…")],
      links: [link("qa")],
      parts: 3,
    },
    { at: 18500, actors: [lead("thinking"), qa("failed")], links: [link("qa")], parts: 3 },
    { at: 21500, actors: [lead("done")], links: [], parts: 3 },
    { at: 24500, actors: [], links: [], parts: 0 },
  ];
}

function Scripted() {
  const steps = script();
  const [step, setStep] = createSignal(steps[0] ?? { at: 0, actors: [], links: [], parts: 0 });
  onSettled(() => {
    const timers = steps.map((next) => setTimeout(() => setStep(next), next.at));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  });
  onCleanup(() => {});
  return (
    <StoryChannelConversation
      stage={
        <ChannelStage
          collapsed={step().actors.length === 0}
          overflow={0}
          request={
            step().parts > 0
              ? {
                  title: "Fix the sign-in flow and cover it with tests",
                  parts: step().parts,
                  done: Math.min(step().parts, Math.floor(step().at / 9000)),
                }
              : null
          }
          links={step().links}
          actors={step().actors}
        />
      }
    />
  );
}

/** Agents arrive, hand work on, wait, finish and leave. Plays once. */
export const Run: Story = { render: () => <Scripted /> };
