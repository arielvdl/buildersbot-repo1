import type { ChannelTabOutcome } from "@buildersbot/contracts/ipc";
import { Button, ConfirmDialog, type ConfirmDialogProps, Heading, UserAvatar } from "@buildersbot/ui";
import { ChannelTabCloseOutcome } from "@buildersbot/ui/features/channels/ChannelTabCloseOutcome";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

type DemoProps = Omit<ConfirmDialogProps, "open" | "onCancel"> & {
  triggerLabel: string;
  initiallyOpen?: boolean;
  onCancel?: () => void;
  /** Shows the close answer of a channel tab in the body, with the confirm button locked until it is complete. */
  tabClose?: { outcome: ChannelTabOutcome | null; note: string };
};

/** Owns the open state the way a caller does: the trigger opens, cancel and a finished confirm close. */
function ConfirmDialogDemo(props: DemoProps) {
  const [open, setOpen] = createSignal(props.initiallyOpen ?? false);
  const [outcome, setOutcome] = createSignal<ChannelTabOutcome | null>(props.tabClose?.outcome ?? null);
  const [note, setNote] = createSignal(props.tabClose?.note ?? "");
  const answered = () => outcome() !== null && (outcome() !== "other" || note().trim() !== "");
  return (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Confirmation dialog
      </Heading>
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>
        {props.triggerLabel}
      </Button>
      <ConfirmDialog
        {...props}
        confirmDisabled={props.tabClose ? !answered() : props.confirmDisabled}
        open={open()}
        onCancel={() => {
          props.onCancel?.();
          setOpen(false);
        }}
        onConfirm={async () => {
          await props.onConfirm();
          setOpen(false);
        }}
      >
        {props.tabClose ? (
          <ChannelTabCloseOutcome
            outcome={outcome()}
            note={note()}
            onOutcomeChange={setOutcome}
            onNoteChange={setNote}
          />
        ) : (
          props.children
        )}
      </ConfirmDialog>
    </main>
  );
}

const meta = {
  title: "Foundations/ConfirmDialog",
  component: ConfirmDialogDemo,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: {
    triggerLabel: "Delete folder",
    initiallyOpen: true,
    title: "Delete Research?",
    description: "The agents in this folder move to the top of the sidebar. Their conversations are kept.",
    confirmLabel: "Delete",
    pendingLabel: "Deleting…",
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConfirmDialogDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {};

export const WithAvatar: Story = {
  args: {
    triggerLabel: "Delete agent",
    title: "Delete Nova?",
    description:
      "This removes the agent and its Builders Bot conversation from the app. Its queue, memories, routines, and workspace are deleted.",
    media: <UserAvatar user={{ name: "Nova", email: "nova@example.com", avatarUrl: null }} decorative />,
  },
};

export const Neutral: Story = {
  args: {
    triggerLabel: "Always allow",
    tone: "default",
    title: "Always allow Nova?",
    description:
      "Nova can run commands and edit files in its workspace without asking first. You can change this later.",
    confirmLabel: "Always allow",
    pendingLabel: undefined,
    initialFocus: "cancel",
  },
};

export const Pending: Story = {
  args: { pending: true },
};

export const WithError: Story = {
  args: { error: "Could not delete Research. Try again." },
};

export const WithDetails: Story = {
  args: {
    triggerLabel: "Uninstall plugin",
    title: "Uninstall Linear?",
    description: "Builders Bot removes these items from this computer:",
    confirmLabel: "Uninstall",
    pendingLabel: "Uninstalling…",
    children: (
      <ul>
        <li>3 skills</li>
        <li>1 MCP server</li>
        <li>Saved plugin settings</li>
      </ul>
    ),
  },
};

export const KeyboardFlow: Story = {
  args: { initiallyOpen: false },
};

const closeTab = {
  triggerLabel: "Close tab",
  title: "Close this tab?",
  description: "Its conversation is deleted.",
  confirmLabel: "Close tab",
  pendingLabel: undefined,
  initialFocus: "cancel",
} as const;

/** Done is chosen when the dialog opens, so Close tab is ready. */
export const ChannelTabClose: Story = {
  args: { ...closeTab, tabClose: { outcome: "done", note: "" } },
};

/** Other asks for a note, and the button stays locked while the note is empty. */
export const ChannelTabCloseOther: Story = {
  args: { ...closeTab, tabClose: { outcome: "other", note: "" } },
};

export const ChannelTabCloseDone: Story = {
  args: { ...closeTab, tabClose: { outcome: "done", note: "Shipped and checked on the test server." } },
};

export const ChannelTabCloseBusy: Story = {
  args: {
    ...closeTab,
    title: "Close tab with work in progress?",
    description: "The agents stop and this tab’s conversation is deleted.",
    tabClose: { outcome: "not-done", note: "" },
  },
};
