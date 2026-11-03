import {
  type ComposerPreset,
  isReservedPresetShortcut,
  parseComposerPresets,
} from "@buildersbot/ui/features/conversation/composer-presets";
import { createSignal } from "solid-js";

const STORAGE_KEY = "buildersbot:composer-presets:v1";

/** The presets after the browser did not save them. They win over an older saved value. */
let unsavedPresets: ComposerPreset[] | undefined;

/** The presets of this device and browser. Reading `window.localStorage` throws when storage is blocked. */
function readComposerPresets(): ComposerPreset[] {
  if (unsavedPresets !== undefined) return unsavedPresets;
  try {
    return parseComposerPresets(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function writeComposerPresets(presets: ComposerPreset[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    unsavedPresets = undefined;
  } catch {
    // Blocked or full storage keeps the presets for this page only.
    unsavedPresets = presets;
  }
}

const [composerPresets, setComposerPresetsSignal] = createSignal<ComposerPreset[]>(readComposerPresets());

if (typeof window !== "undefined") {
  const readFromStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    setComposerPresetsSignal(readComposerPresets());
  };
  window.addEventListener("storage", readFromStorage);
  import.meta.hot?.dispose(() => window.removeEventListener("storage", readFromStorage));
}

/** The shared reactive list. The "+" menu, the keys and Settings follow the same signal. */
export function useComposerPresets(): () => readonly ComposerPreset[] {
  return composerPresets;
}

function commit(next: ComposerPreset[]): void {
  writeComposerPresets(next);
  setComposerPresetsSignal(next);
}

/** A combination goes to one preset: the preset that held it before loses it. */
function releaseShortcut(presets: readonly ComposerPreset[], shortcut: string | null, keepId?: string) {
  return presets.map((preset) =>
    shortcut !== null && preset.shortcut === shortcut && preset.id !== keepId ? { ...preset, shortcut: null } : preset,
  );
}

export function addComposerPreset(
  input: Pick<ComposerPreset, "name" | "prompt" | "shortcut"> & Partial<Pick<ComposerPreset, "sendOnClick">>,
): string {
  const id = crypto.randomUUID();
  const shortcut = input.shortcut && !isReservedPresetShortcut(input.shortcut) ? input.shortcut : null;
  commit([
    ...releaseShortcut(composerPresets(), shortcut),
    { id, name: input.name, prompt: input.prompt, shortcut, sendOnClick: input.sendOnClick === true },
  ]);
  return id;
}

export function updateComposerPreset(
  id: string,
  change: Partial<Pick<ComposerPreset, "name" | "prompt" | "shortcut" | "sendOnClick">>,
): void {
  const shortcut =
    change.shortcut === undefined
      ? undefined
      : change.shortcut && !isReservedPresetShortcut(change.shortcut)
        ? change.shortcut
        : null;
  const released = shortcut ? releaseShortcut(composerPresets(), shortcut, id) : composerPresets();
  commit(
    released.map((preset) =>
      preset.id === id ? { ...preset, ...change, ...(shortcut === undefined ? {} : { shortcut }) } : preset,
    ),
  );
}

export function removeComposerPreset(id: string): void {
  commit(composerPresets().filter((preset) => preset.id !== id));
}
