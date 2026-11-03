import {
  applyQuickChatFilter,
  type QuickChatRow,
  splitByFolder,
} from "@buildersbot/ui/features/quick-chat/quick-chat-groups";
import { describe, expect, it } from "vitest";
import {
  addQuickChatFolder,
  moveQuickChatRow,
  readQuickChatFolders,
  removeQuickChatFolder,
  renameQuickChatFolder,
} from "./quick-chat-folders";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function row(
  key: string,
  createdAt: string,
  updatedAt: string,
  kind: "idle" | "working" | "failed" = "idle",
): QuickChatRow {
  return {
    key,
    agentId: "a",
    taskId: key,
    title: key,
    firstMessage: "",
    preview: "",
    createdAt,
    updatedAt,
    status: { kind },
    owner: { name: "Q", quick: true },
  };
}

describe("quick chat folders", () => {
  it("keeps folders and moves rows per server", () => {
    const store = memory();
    const first = addQuickChatFolder("s1", "  Work  ", store).folders[0];
    expect(first?.name).toBe("Work");
    expect(addQuickChatFolder("s1", "   ", store).folders).toHaveLength(1);
    expect(readQuickChatFolders("s2", store).folders).toEqual([]);
    const moved = moveQuickChatRow("s1", "a:1", first?.id ?? "", store);
    expect(moved.assignments).toEqual({ "a:1": first?.id });
    expect(moveQuickChatRow("s1", "a:2", "missing", store).assignments).toEqual({ "a:1": first?.id });
    expect(renameQuickChatFolder("s1", first?.id ?? "", "Home", store).folders[0]?.name).toBe("Home");
    expect(removeQuickChatFolder("s1", first?.id ?? "", store)).toEqual({ folders: [], assignments: {} });
  });

  it("survives broken storage", () => {
    const store = memory();
    store.setItem("buildersbot:quick-chat-folders:v1", "{nope");
    expect(readQuickChatFolders("s1", store).folders).toEqual([]);
  });
});

describe("quick chat filters", () => {
  const rows = [
    row("a", "2026-01-01", "2026-01-05"),
    row("b", "2026-01-03", "2026-01-04", "working"),
    row("c", "2026-01-02", "2026-01-06", "failed"),
  ];
  it("lists the running, the newest created and the newest finished", () => {
    expect(applyQuickChatFilter(rows, "running").map((r) => r.key)).toEqual(["b"]);
    expect(applyQuickChatFilter(rows, "created").map((r) => r.key)).toEqual(["b", "c", "a"]);
    expect(applyQuickChatFilter(rows, "finished").map((r) => r.key)).toEqual(["c", "a"]);
  });
  it("puts a row with a missing folder in no folder", () => {
    const split = splitByFolder(rows, [{ id: "f", name: "F" }], { a: "f", b: "gone" });
    expect(split.byFolder.get("f")?.map((r) => r.key)).toEqual(["a"]);
    expect(split.loose.map((r) => r.key)).toEqual(["b", "c"]);
  });
});
