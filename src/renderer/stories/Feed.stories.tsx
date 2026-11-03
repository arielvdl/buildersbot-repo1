import { AVATAR_HUES, type FeedItem } from "@buildersbot/contracts/ipc";
import { FeedPage } from "@buildersbot/ui/features/feed/FeedPage";
import type { FeedAgentProfile } from "@buildersbot/ui/features/feed/feed-tables-model";
import { feedAgentKey } from "@buildersbot/ui/features/feed/feed-view";
import { createSignal, onSettled } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createFeedStore } from "../src/features/feed/stores/feed-store";
import { createMockFeed, MOCK_FEED_AGENTS, mockFeedActionItems, mockFeedItem } from "../src/preview/mock-feed";
import "./feed-story.css";

/** The faces of the agents of the fixtures. */
function storyAgents(): FeedAgentProfile[] {
  return MOCK_FEED_AGENTS.map((agent, index) => ({
    key: feedAgentKey({ serverId: "local", agentId: agent.id }),
    avatarSeed: agent.id,
    avatarHue: AVATAR_HUES[index % AVATAR_HUES.length] ?? null,
    avatarUrl: null,
  }));
}

/**
 * The feed page with the preview mock behind the real store: a full read, then the deltas, as main
 * sends them. `live` adds a card and a step on a timer.
 */
function FeedStory(props: {
  items: number;
  live?: number;
  /** The cards of the actions story instead of a normal day. */
  actions?: boolean;
  onOpen: (item: FeedItem) => void;
}) {
  const api = createMockFeed({
    items: props.actions ? mockFeedActionItems() : props.items,
    live: props.live ? { intervalMs: props.live } : undefined,
    actionDelayMs: 600,
  });
  const feed = createFeedStore(
    () => api,
    (cause) => String(cause),
  );
  const agents = storyAgents();
  return (
    <div class="feed-story">
      <FeedPage
        items={feed.items()}
        agents={agents}
        loading={feed.state.loading}
        error={feed.state.error}
        onOpen={props.onOpen}
        onAct={api.act}
      />
    </div>
  );
}

const STORY_MODELS = [
  { provider: "claude", model: "claude-opus-5-5" },
  { provider: "claude", model: "claude-sonnet-5-5" },
  { provider: "codex", model: "gpt-5.5" },
  { provider: "claude", model: "claude-haiku-5-5" },
] as const;

/** The agents of the fixtures with a provider and a model, as the window knows them. */
function storyProfiles(): FeedAgentProfile[] {
  return storyAgents().map((agent, index) => ({ ...STORY_MODELS[index % STORY_MODELS.length], ...agent }));
}

const TABLE_PROJECTS = ["Hub", "Site", "iMasters", "naia", "Docs", "Mobile", "Billing", "Infra"];
const TABLE_STEPS = [
  "Gathering the relevant information…",
  "Making the requested changes…",
  "Checking the work…",
  "Searching for current information…",
  "Coordinating with another agent…",
];

/** One card for a table: an agent of the fixtures in a state, with the host's progress line. */
function tableCard(
  index: number,
  project: number,
  state: FeedItem["state"],
  options: { serverId?: string; endedAt?: number; step?: string } = {},
): FeedItem {
  const base = mockFeedItem(index, 40);
  const agent = MOCK_FEED_AGENTS[index % MOCK_FEED_AGENTS.length];
  const step = options.step ?? TABLE_STEPS[index % TABLE_STEPS.length] ?? "";
  const now = Date.now();
  return {
    ...base,
    id: `${options.serverId ?? "local"}:t:table-${index}`,
    serverId: options.serverId ?? "local",
    agentId: agent?.id ?? `agent-${index}`,
    agentName: agent?.name ?? `Agent ${index}`,
    projectId: `section-${project}`,
    projectName: TABLE_PROJECTS[project] ?? null,
    title: `Example task ${index + 1}`,
    state,
    updatedAt: new Date(now - index * 1000).toISOString(),
    endedAt: options.endedAt ? new Date(options.endedAt).toISOString() : null,
    lastStep: { at: new Date(now).toISOString(), kind: "progress", text: step },
    need: state === "needs-you" ? base.need : null,
    actions: ["open"],
  };
}

/** Eight projects at work, one agent of a joined server, more agents than seats at one table. */
function busyTables(): FeedItem[] {
  const items: FeedItem[] = [];
  let index = 0;
  const seat = (project: number, state: FeedItem["state"], options = {}) =>
    items.push(tableCard(index++, project, state, options));
  seat(0, "working");
  seat(0, "working");
  seat(0, "needs-you");
  seat(1, "working");
  seat(1, "working");
  seat(1, "working");
  seat(1, "working");
  seat(1, "working");
  seat(2, "working");
  seat(2, "failed", { endedAt: Date.now() });
  seat(3, "working", { serverId: "invited" });
  seat(4, "working");
  seat(5, "needs-you");
  seat(6, "working");
  seat(7, "working");
  return items;
}

function TablesStory(props: { script?: boolean; folded?: boolean; onOpen: (item: FeedItem) => void }) {
  const [items, setItems] = createSignal<FeedItem[]>(busyTables());
  onSettled(() => {
    if (!props.script) return;
    // An agent finishes, another one fails, a third starts: the tables show each change once.
    const timers = [
      setTimeout(
        () =>
          setItems((current) =>
            current.map((item, at) =>
              at === 1 ? { ...item, state: "done", endedAt: new Date().toISOString() } : item,
            ),
          ),
        4000,
      ),
      setTimeout(
        () =>
          setItems((current) => [...current, tableCard(20, 3, "working", { step: "Making the requested changes…" })]),
        7000,
      ),
      setTimeout(
        () =>
          setItems((current) =>
            current.map((item, at) =>
              at === 5 ? { ...item, state: "failed", endedAt: new Date().toISOString() } : item,
            ),
          ),
        10000,
      ),
    ];
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  });
  return (
    <div class="feed-story">
      <FeedPage
        items={items()}
        agents={storyProfiles()}
        loading={false}
        error={null}
        tablesFolded={props.folded}
        onOpen={props.onOpen}
      />
    </div>
  );
}

const meta = {
  title: "Features/Feed",
  component: FeedStory,
  parameters: { layout: "fullscreen" },
  args: { items: 40, onOpen: fn() },
} satisfies Meta<typeof FeedStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing ran yet. */
export const Empty: Story = { args: { items: 0 } };

/** A normal day: 40 runs, the newest at the bottom, a few that work, wait, stopped or need the person. */
export const TypicalDay: Story = {};

/** The same day on the light palette. */
export const TypicalDayLight: Story = { globals: { colorScheme: "light" } };

/** The most cards main keeps. Only the cards on screen are in the DOM. */
export const FiveThousand: Story = { args: { items: 5_000 } };

/** 5,000 cards on the light palette. */
export const FiveThousandLight: Story = { args: { items: 5_000 }, globals: { colorScheme: "light" } };

/**
 * New runs come every 0.7 s. Scrolling up pauses the timeline: the new runs are counted in "N new",
 * and the button at the bottom goes back to the newest.
 */
export const Live: Story = { args: { items: 40, live: 700 } };

/** 5,000 cards while new runs come, for the scrolling check. */
export const LiveFiveThousand: Story = { args: { items: 5_000, live: 250 } };

/**
 * One card of each action: a command to approve, a question of the Guard and more access (high risk,
 * a second step), a question with choices, a question with a typed answer, two questions (for the
 * conversation), a run to stop, three stopped tasks to resume or reassign, one by one or selected
 * together, a card that main refuses, and a card of a joined server, which offers only "open".
 * Each action takes 0.6 s, so the waiting state shows.
 */
export const Actions: Story = { args: { items: 0, actions: true } };

/** The actions on the light palette. */
export const ActionsLight: Story = { args: { items: 0, actions: true }, globals: { colorScheme: "light" } };

/** One table for each project at work: a cube for each agent, in the motion of what it does. */
export const Tables: Story = { render: (args) => <TablesStory onOpen={args.onOpen} /> };

/** The tables on the light palette. */
export const TablesLight: Story = {
  render: (args) => <TablesStory onOpen={args.onOpen} />,
  globals: { colorScheme: "light" },
};

/** An agent finishes and leaves, one fails, one arrives: each change plays once. */
export const TablesRun: Story = { render: (args) => <TablesStory script onOpen={args.onOpen} /> };

/** The tables folded into a strip. */
export const TablesFolded: Story = { render: (args) => <TablesStory folded onOpen={args.onOpen} /> };
