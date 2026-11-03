import { describe, expect, it } from "vitest";
import { isCloseTabKey } from "./close-tab-shortcut";

const key = (init: Partial<Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">>) =>
  ({ key: "w", altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, ...init }) satisfies Pick<
    KeyboardEvent,
    "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey"
  >;

describe("isCloseTabKey", () => {
  it("takes ⌘W on a Mac and Ctrl+W elsewhere", () => {
    expect(isCloseTabKey(key({ metaKey: true }), "darwin")).toBe(true);
    expect(isCloseTabKey(key({ key: "W", metaKey: true }), "darwin")).toBe(true);
    expect(isCloseTabKey(key({ ctrlKey: true }), "win32")).toBe(true);
    expect(isCloseTabKey(key({ ctrlKey: true }), "darwin")).toBe(false);
    expect(isCloseTabKey(key({ metaKey: true }), "linux")).toBe(false);
  });
  it("leaves close window, other modifiers and other keys alone", () => {
    expect(isCloseTabKey(key({ metaKey: true, shiftKey: true }), "darwin")).toBe(false);
    expect(isCloseTabKey(key({ metaKey: true, altKey: true }), "darwin")).toBe(false);
    expect(isCloseTabKey(key({ metaKey: true, key: "t" }), "darwin")).toBe(false);
    expect(isCloseTabKey(key({}), "darwin")).toBe(false);
  });
});
