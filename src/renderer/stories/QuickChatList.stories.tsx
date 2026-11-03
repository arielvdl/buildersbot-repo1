import { QuickChatList } from "@buildersbot/ui/features/quick-chat/QuickChatList";
import { type QuickChatRow, quickChatRowKey } from "@buildersbot/ui/features/quick-chat/quick-chat-groups";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const quick = { name: "Quick", quick: true };

function row(
  id: string,
  title: string,
  preview: string,
  ageMs: number,
  status: QuickChatRow["status"] = { kind: "idle" },
): QuickChatRow {
  return {
    key: quickChatRowKey("quick", id),
    agentId: "quick",
    taskId: id,
    title,
    firstMessage: preview,
    preview,
    createdAt: new Date(Date.now() - ageMs - HOUR).toISOString(),
    updatedAt: new Date(Date.now() - ageMs).toISOString(),
    status,
    owner: quick,
  };
}

const rows = [
  row("a", "Next step of the quick chat", "Close T0 and confirm the plan", 20 * 60_000),
  row("b", "Welcome message for the team", "Write a short welcome message for the team today", 3 * HOUR),
  row("c", "Sum values by month in Sheets", "How do I sum values by month in a sheet?", DAY + HOUR),
  row("d", "Names for the morning routine", "Give me ten names for a morning routine", 4 * DAY),
  row("e", "Reunião de alinhamento", "Resume a reunião de ontem em três linhas", 21 * DAY),
];

const meta = {
  title: "Quick chat/QuickChatList",
  component: QuickChatList,
  args: {
    rows,
    archived: [],
    selectedKey: rows[1]?.key ?? null,
    loading: false,
    onSelect: fn(),
    onNew: fn(),
    onArchive: fn(),
    onRestore: fn(),
    onRestoreMany: fn(async () => {}),
    onDeleteMany: fn(async () => {}),
    onDelete: fn(),
  },
  decorators: [
    (Story) => (
      <div class="app-window" style={{ height: "100vh", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuickChatList>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Today, yesterday, the last 7 days and older, with the open conversation marked. */
export const Groups: Story = {};

/** A message that opened with an @ tag started the conversation in that agent, so its row shows the agent. */
export const OtherAgent: Story = {
  args: {
    rows: [
      {
        ...row("r", "Sources for the launch", "Find sources about the launch", 5 * 60_000),
        agentId: "research",
        key: quickChatRowKey("research", "r"),
        owner: {
          name: "Research",
          quick: false,
          agent: { avatarSeed: "research", avatarHue: 170, avatarUrl: null, title: "Research" },
        },
      },
      ...rows,
    ],
  },
};

/** A new conversation is open: no row is marked. */
export const NewConversation: Story = {
  args: { selectedKey: null },
};

/** A reply runs, a conversation waits for a free turn, and one failed. */
export const Statuses: Story = {
  args: {
    rows: [
      row("w", "Running now", "Summarize this report", 60_000, { kind: "working" }),
      row("q", "Waits for a turn", "Rewrite this email", 2 * 60_000, { kind: "queued" }),
      row("f", "Failed", "Explain this error", 5 * 60_000, { kind: "failed" }),
      ...rows,
    ],
  },
};

/** The archived conversations open in a dialog from the row under the list. */
export const Archived: Story = {
  args: {
    archived: [
      row("x", "Old idea", "A list of ideas for the launch", 40 * DAY),
      row("y", "Draft of a post", "Draft a post", 50 * DAY),
    ],
  },
};

/** A long archive: the dialog draws one page and "Show more" adds the next. */
export const LongArchive: Story = {
  args: {
    archived: Array.from({ length: 300 }, (_, index) =>
      row(`old-${index}`, `Old conversation ${index + 1}`, "A list of ideas for the launch", (index + 8) * DAY),
    ),
  },
};

export const Empty: Story = {
  args: { rows: [], archived: [] },
};

export const Loading: Story = {
  args: { loading: true },
};
