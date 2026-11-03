import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { SidebarChatTabStrip } from "../../../../../packages/ui/src/features/sidebar/SidebarChatTabStrip";
import { type SidebarScope, SidebarScopeContext } from "../../../../../packages/ui/src/features/sidebar/sidebar-scope";
import type { SidebarChatRowItem, SidebarProps } from "../../../../../packages/ui/src/features/sidebar/sidebar-types";
import { createSidebarTabStripStore } from "../../../../../packages/ui/src/features/sidebar/stores/tab-strip-store";

const tabs = {
  tabs: [
    { id: "a", title: "aws" },
    { id: "b", title: "Correção do Feed" },
  ],
  activeId: "a",
};

/** The strip needs only the props and the strip store of the scope. */
function scopeWith(props: Partial<SidebarProps>): SidebarScope {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the strip reads two members of the scope, so the test builds only those.
  return { props, tabStrips: createSidebarTabStripStore() } as unknown as SidebarScope;
}

function renderStrip(kind: "channel" | "agent", props: Partial<SidebarProps>) {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the strip reads only the kind and the id of the chat.
  const chat = { kind, id: "c1" } as unknown as SidebarChatRowItem;
  render(() => (
    <SidebarScopeContext value={scopeWith(props)}>
      <SidebarChatTabStrip chat={chat} tabs={tabs} onOpen={() => undefined} />
    </SidebarScopeContext>
  ));
}

describe("the new tab item of a channel's tab list", () => {
  it("is the last item of the list and opens a new tab of that channel", () => {
    const onNewChannelTab = vi.fn<(channelId: string) => void>();
    renderStrip("channel", { onNewChannelTab });
    const items = screen.getAllByRole("listitem");
    const last = items[items.length - 1];
    expect(last).toHaveTextContent("New tab");
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(onNewChannelTab).toHaveBeenCalledExactlyOnceWith("c1");
  });

  it("is absent without the handler", () => {
    renderStrip("channel", {});
    expect(screen.queryByRole("button", { name: "New tab" })).toBeNull();
  });

  it("is not offered to an agent", () => {
    renderStrip("agent", { onNewChannelTab: vi.fn() });
    expect(screen.queryByRole("button", { name: "New tab" })).toBeNull();
  });
});
