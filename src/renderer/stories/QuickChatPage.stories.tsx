import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { QuickChatPage } from "../src/features/quick-chat/QuickChatPage";

/** The real Quick chat page in a card the size of the middle pane. */
function QuickChatPageStory() {
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <QuickChatPage />
    </div>
  );
}

const meta = {
  title: "Quick chat/Page",
  component: QuickChatPageStory,
} satisfies Meta<typeof QuickChatPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A new draft: the field has the focus, so the person can type at once. */
export const Empty: Story = {};
