import {
  appendPresetPrompt,
  formatPresetShortcut,
  isReservedPresetShortcut,
  parseComposerPresets,
  presetForKeyEvent,
  presetShortcutFromEvent,
} from "@buildersbot/ui/features/conversation/composer-presets";
import { describe, expect, test } from "vitest";

const key = (
  code: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>,
) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("composer presets", () => {
  test("a key combination needs Ctrl, Cmd or Alt", () => {
    expect(presetShortcutFromEvent(key("KeyK", {}))).toBeNull();
    expect(presetShortcutFromEvent(key("KeyK", { shiftKey: true }))).toBeNull();
    expect(presetShortcutFromEvent(key("ShiftLeft", { shiftKey: true, altKey: true }))).toBeNull();
    expect(presetShortcutFromEvent(key("KeyK", { altKey: true, shiftKey: true }))).toBe("Alt+Shift+KeyK");
    expect(presetShortcutFromEvent(key("Digit1", { ctrlKey: true, metaKey: true }))).toBe("Ctrl+Meta+Digit1");
  });

  test("reserved combinations are refused", () => {
    expect(isReservedPresetShortcut("Meta+KeyC")).toBe(true);
    expect(isReservedPresetShortcut("Alt+KeyK")).toBe(false);
  });

  test("a keydown finds its preset", () => {
    const presets = parseComposerPresets([
      { id: "a", name: "Review", prompt: "Review the code", shortcut: "Alt+KeyR" },
      { id: "b", name: "Test", prompt: "Write tests", shortcut: null },
    ]);
    expect(presetForKeyEvent(presets, key("KeyR", { altKey: true }))?.id).toBe("a");
    expect(presetForKeyEvent(presets, key("KeyT", { altKey: true }))).toBeUndefined();
  });

  test("the keys show as the device shows them", () => {
    expect(formatPresetShortcut("Ctrl+Alt+Shift+KeyK", "darwin")).toBe("⌃⌥⇧K");
    expect(formatPresetShortcut("Ctrl+Alt+KeyK", "win32")).toBe("Ctrl+Alt+K");
    expect(formatPresetShortcut("Meta+Digit3", "linux")).toBe("Win+3");
  });

  test("a prompt goes on a new line and never replaces the draft", () => {
    expect(appendPresetPrompt("", "Hello")).toBe("Hello");
    expect(appendPresetPrompt("Draft", "Hello")).toBe("Draft\nHello");
    expect(appendPresetPrompt("Draft", "  ")).toBe("Draft");
  });

  test("a damaged stored value keeps only the valid presets, with no limit on how many", () => {
    expect(parseComposerPresets("x")).toEqual([]);
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, name: `N${index}`, prompt: "text" }));
    const parsed = parseComposerPresets([
      ...many,
      { id: "p0", name: "Repeated id", prompt: "text" },
      { id: "x", name: " ", prompt: "text" },
      { id: "y", name: "No prompt", prompt: "  " },
      null,
    ]);
    expect(parsed).toHaveLength(12);
    expect(parsed[0]?.shortcut).toBeNull();
  });

  test("a repeated combination stays with the first preset", () => {
    const parsed = parseComposerPresets([
      { id: "a", name: "A", prompt: "a", shortcut: "Alt+KeyK" },
      { id: "b", name: "B", prompt: "b", shortcut: "Alt+KeyK" },
    ]);
    expect(parsed.map((preset) => preset.shortcut)).toEqual(["Alt+KeyK", null]);
  });
});
