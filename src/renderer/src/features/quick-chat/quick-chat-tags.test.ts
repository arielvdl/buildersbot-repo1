import { describe, expect, it } from "vitest";
import {
  addQuickChatTag,
  editQuickChatTag,
  readQuickChatTags,
  removeQuickChatTag,
  setQuickChatRowTag,
} from "./quick-chat-tags";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("quick chat tags", () => {
  it("makes a tag and gives it to the row", () => {
    const storage = memory();
    const state = addQuickChatTag("s", "a:1", "  Work  ", "#EF4444", storage);
    expect(state.tags).toHaveLength(1);
    expect(state.tags[0]).toMatchObject({ name: "Work", color: "#ef4444" });
    expect(state.assignments["a:1"]).toBe(state.tags[0]?.id);
    expect(readQuickChatTags("s", storage)).toEqual(state);
    expect(readQuickChatTags("other", storage).tags).toEqual([]);
  });

  it("ignores a blank name and a color that is not #rrggbb", () => {
    const storage = memory();
    expect(addQuickChatTag("s", "a:1", "   ", "#ef4444", storage).tags).toEqual([]);
    expect(addQuickChatTag("s", "a:1", "Work", "red; background: url(x)", storage).tags).toEqual([]);
  });

  it("moves a row between tags and takes the tag off", () => {
    const storage = memory();
    const first = addQuickChatTag("s", "a:1", "One", "#ef4444", storage);
    const second = addQuickChatTag("s", "a:2", "Two", "#3b82f6", storage);
    const id = first.tags[0]?.id ?? "";
    expect(setQuickChatRowTag("s", "a:2", id, storage).assignments["a:2"]).toBe(id);
    expect(setQuickChatRowTag("s", "a:2", "missing", storage).assignments["a:2"]).toBe(id);
    expect(setQuickChatRowTag("s", "a:2", null, storage).assignments["a:2"]).toBeUndefined();
    expect(second.tags).toHaveLength(2);
  });

  it("edits a tag for every row, and removing it leaves the rows with no tag", () => {
    const storage = memory();
    const id = addQuickChatTag("s", "a:1", "One", "#ef4444", storage).tags[0]?.id ?? "";
    setQuickChatRowTag("s", "a:2", id, storage);
    const edited = editQuickChatTag("s", id, "Uno", "#10B981", storage);
    expect(edited.tags[0]).toMatchObject({ name: "Uno", color: "#10b981" });
    const removed = removeQuickChatTag("s", id, storage);
    expect(removed.tags).toEqual([]);
    expect(removed.assignments).toEqual({});
  });

  it("survives bad stored data", () => {
    const storage = { getItem: () => "{not json", setItem: () => undefined };
    expect(readQuickChatTags("s", storage)).toEqual({ tags: [], assignments: {} });
  });
});
