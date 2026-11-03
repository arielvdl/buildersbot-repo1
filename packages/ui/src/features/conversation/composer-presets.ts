import { isDynamicRecord } from "@buildersbot/contracts/runtime-values";

/**
 * The DOM-free rules of the prompt presets: a saved prompt that the "+" menu of a message box, or a
 * key combination, writes into the draft. Shared UI owns the rules; the renderer owns where the
 * presets are saved.
 */

export const COMPOSER_PRESET_NAME_MAX = 60;
export const COMPOSER_PRESET_PROMPT_MAX = 8000;

export interface ComposerPreset {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  /** A key combination such as `Meta+Alt+KeyK`, or no key combination. */
  readonly shortcut: string | null;
}

interface PresetKeyEvent {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** Combinations that already do something in a message box or in the window. */
const RESERVED_SHORTCUTS: ReadonlySet<string> = new Set([
  "Meta+KeyA",
  "Meta+KeyC",
  "Meta+KeyV",
  "Meta+KeyX",
  "Meta+KeyZ",
  "Meta+KeyY",
  "Meta+KeyF",
  "Meta+KeyK",
  "Meta+Comma",
  "Meta+Enter",
  "Ctrl+KeyA",
  "Ctrl+KeyC",
  "Ctrl+KeyV",
  "Ctrl+KeyX",
  "Ctrl+KeyZ",
  "Ctrl+KeyY",
  "Ctrl+KeyF",
  "Ctrl+KeyK",
  "Ctrl+Comma",
  "Ctrl+Enter",
]);

const KEY_CODE =
  /^(?:Key[A-Z]|Digit\d|F(?:[1-9]|1\d|2[0-4])|Numpad\d|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote|Period)$/u;
const MODIFIERS = ["Ctrl", "Meta", "Alt", "Shift"] as const;

/** The combination that this keydown makes, or null while it holds only a modifier or a key that cannot be used. */
export function presetShortcutFromEvent(event: PresetKeyEvent): string | null {
  if (!KEY_CODE.test(event.code)) return null;
  const held = [event.ctrlKey, event.metaKey, event.altKey, event.shiftKey];
  const parts = MODIFIERS.filter((_, index) => held[index]);
  // A letter with no Ctrl, Cmd or Alt is a letter that the user types.
  if (!parts.some((part) => part !== "Shift")) return null;
  return [...parts, event.code].join("+");
}

/** Whether a message box or the window already uses the combination. */
export function isReservedPresetShortcut(shortcut: string): boolean {
  return RESERVED_SHORTCUTS.has(shortcut);
}

/** The preset that this keydown calls, if one is set to it. */
export function presetForKeyEvent(
  presets: readonly ComposerPreset[],
  event: PresetKeyEvent,
): ComposerPreset | undefined {
  const shortcut = presetShortcutFromEvent(event);
  return shortcut === null ? undefined : presets.find((preset) => preset.shortcut === shortcut);
}

function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  const symbols: Record<string, string> = {
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
    Period: ".",
  };
  return symbols[code] ?? code;
}

/** The combination as the keyboard of this device shows it: ⌃⌘⌥⇧K on a Mac, Ctrl+Alt+K elsewhere. */
export function formatPresetShortcut(shortcut: string, devicePlatform: "darwin" | "win32" | "linux"): string {
  const parts = shortcut.split("+");
  const code = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (devicePlatform === "darwin") {
    const symbols: Record<string, string> = { Ctrl: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" };
    return `${modifiers.map((part) => symbols[part] ?? part).join("")}${keyLabel(code)}`;
  }
  const names: Record<string, string> = { Meta: "Win" };
  return [...modifiers.map((part) => names[part] ?? part), keyLabel(code)].join("+");
}

/** The draft with the prompt added on a new line, so a preset never overwrites what the user typed. */
export function appendPresetPrompt(text: string, prompt: string): string {
  const line = prompt.trim();
  if (!line) return text;
  return text.trim() ? `${text}\n${line}` : line;
}

/**
 * The presets that a stored value holds. A value from another version or a damaged one reads as the
 * presets that are valid in it; a repeated id or a repeated combination keeps the first.
 */
export function parseComposerPresets(value: unknown): ComposerPreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const shortcuts = new Set<string>();
  const presets: ComposerPreset[] = [];
  for (const item of value) {
    if (!isDynamicRecord(item)) continue;
    const { id, name, prompt, shortcut } = item;
    if (typeof id !== "string" || !id || ids.has(id)) continue;
    if (typeof name !== "string" || typeof prompt !== "string") continue;
    const cleanName = name.trim().slice(0, COMPOSER_PRESET_NAME_MAX);
    const cleanPrompt = prompt.slice(0, COMPOSER_PRESET_PROMPT_MAX);
    if (!cleanName || !cleanPrompt.trim()) continue;
    const key = typeof shortcut === "string" && shortcut && !shortcuts.has(shortcut) ? shortcut : null;
    ids.add(id);
    if (key) shortcuts.add(key);
    presets.push({ id, name: cleanName, prompt: cleanPrompt, shortcut: key });
  }
  return presets;
}
