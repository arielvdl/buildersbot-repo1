/**
 * What the user can do with the chats picked in the list (⌘/Ctrl-click, Shift-click): move them to a
 * section together, start a section with them, hide the agents, or end the pick. The bar sticks to the
 * bottom of the list while a pick exists. The right click on a picked row opens the same actions.
 * Dragging a picked row moves them all (see `layout-actions.ts`).
 */

import {
  Button,
  buttonVariants,
  ChevronRight,
  ContextMenu,
  DropdownMenu,
  Folder,
  FolderInput,
  FolderPlus,
  Moon,
  X,
} from "@buildersbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { useSidebarScope } from "./sidebar-scope";

/** The part of the menu that Kobalte's dropdown and context menus share. */
type MenuApi = Pick<typeof DropdownMenu, "Item" | "Separator">;

/** The sections to move the picked chats to, "Unassigned", and "New section". */
function MoveItems(props: { Menu: MenuApi }) {
  const { assignChatsSection, props: sidebar, sectionRail, selection } = useSidebarScope();
  const { t } = useText();
  const move = (sectionId: string | null) => {
    assignChatsSection(selection.ids(), sectionId);
    selection.clear();
  };
  return (
    <>
      <For each={sidebar.layout.sections}>
        {(section) => (
          <props.Menu.Item onSelect={() => move(section.id)}>
            <Folder class="agent-context-icon size-4" aria-hidden="true" />
            <span>{section.name}</span>
          </props.Menu.Item>
        )}
      </For>
      <props.Menu.Item onSelect={() => move(null)}>
        <Folder class="agent-context-icon size-4" aria-hidden="true" />
        <span>{t("sidebar.section.unassigned")}</span>
      </props.Menu.Item>
      <Show when={sidebar.sectionRail}>
        <props.Menu.Separator />
        <props.Menu.Item
          onSelectAfterClose={() => sectionRail.openNameDialog({ kind: "create", agentIds: selection.ids() })}
        >
          <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
          <span>{t("sidebar.selection.newSection")}</span>
        </props.Menu.Item>
      </Show>
    </>
  );
}

/** The picked chats that are agents: the only kind that can be hidden. */
function useHidableAgentIds() {
  const { props, selection } = useSidebarScope();
  return () => {
    const agentIds = new Set(props.agents.map((agent) => agent.id));
    return props.onHideAgent ? selection.ids().filter((id) => agentIds.has(id)) : [];
  };
}

export function SidebarSelectionBar() {
  const { props, selection } = useSidebarScope();
  const { t } = useText();
  const hidable = useHidableAgentIds();
  return (
    <Show when={selection.count() > 0}>
      <div class="sidebar-selection-bar" role="toolbar" aria-label={t("sidebar.selection.label")}>
        <span class="sidebar-selection-count" role="status" aria-live="polite" aria-atomic="true">
          {t("sidebar.selection.count", { count: selection.count() })}
        </span>
        <DropdownMenu.Root placement="top-end" gutter={4}>
          <DropdownMenu.Trigger class={buttonVariants({ variant: "secondary", size: "xs" })}>
            <FolderInput aria-hidden="true" />
            <span>{t("sidebar.moveTo")}</span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="agent-context-menu" aria-label={t("sidebar.moveTo")}>
              <MoveItems Menu={DropdownMenu} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Show when={hidable().length > 0}>
          <Button
            size="xs"
            variant="ghost"
            type="button"
            onClick={() => {
              for (const id of hidable()) props.onHideAgent?.(id);
              selection.clear();
            }}
          >
            <Moon aria-hidden="true" />
            <span>{t("sidebar.selection.hide")}</span>
          </Button>
        </Show>
        <Button
          size="xs"
          variant="ghost"
          type="button"
          class="sidebar-selection-clear"
          aria-label={t("sidebar.selection.clear")}
          title={t("sidebar.selection.clear")}
          onClick={selection.clear}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </Show>
  );
}

/** The right-click menu of a picked row while more than one chat is picked. */
export function SidebarSelectionContextMenu() {
  const { props, selection } = useSidebarScope();
  const { t } = useText();
  const hidable = useHidableAgentIds();
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.selection.label")}>
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger>
            <FolderInput class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("sidebar.selection.moveCount", { count: selection.count() })}</span>
            <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              class="ui-action-menu agent-context-menu agent-context-submenu"
              aria-label={t("sidebar.moveTo")}
            >
              <MoveItems Menu={ContextMenu} />
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
        <Show when={hidable().length > 0}>
          <ContextMenu.Item
            onSelectAfterClose={() => {
              for (const id of hidable()) props.onHideAgent?.(id);
              selection.clear();
            }}
          >
            <Moon class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("sidebar.selection.hide")}</span>
          </ContextMenu.Item>
        </Show>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={selection.clear}>
          <X class="agent-context-icon size-4" aria-hidden="true" />
          <span>{t("sidebar.selection.clear")}</span>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
