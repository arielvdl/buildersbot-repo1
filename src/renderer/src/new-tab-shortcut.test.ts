import { describe, expect, it } from "vitest";
import { isNewTabKey } from "./new-tab-shortcut";

const key = (init: Partial<Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">>) =>
  ({ key: "t", altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, ...init }) satisfies Pick<
    KeyboardEvent,
    "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey"
  >;

describe("isNewTabKey", () => {
  it("takes ⌘T on a Mac and Ctrl+T elsewhere", () => {
    expect(isNewTabKey(key({ metaKey: true }), "darwin")).toBe(true);
    expect(isNewTabKey(key({ ctrlKey: true }), "win32")).toBe(true);
    expect(isNewTabKey(key({ ctrlKey: true }), "darwin")).toBe(false);
    expect(isNewTabKey(key({ metaKey: true }), "linux")).toBe(false);
  });
  it("leaves reopen and other keys alone", () => {
    expect(isNewTabKey(key({ metaKey: true, shiftKey: true }), "darwin")).toBe(false);
    expect(isNewTabKey(key({ metaKey: true, key: "w" }), "darwin")).toBe(false);
  });
});
