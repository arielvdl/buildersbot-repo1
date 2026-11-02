/**
 * Settings › Agents, through the section the app builds: the default backup model saves over the
 * bridge and shows at once. The fake port clones every payload, as IPC does, because the settings
 * come from a store proxy and a proxy cannot cross the bridge.
 */
import {
  DEFAULT_START_RETRY_SETTINGS,
  type StartRetrySettings,
  type StartRetryState,
} from "@buildersbot/contracts/ipc";
import { DEFAULT_GENERAL_SETTINGS } from "@buildersbot/ui/features/settings/app-settings";
import { TextProvider } from "@buildersbot/ui/text";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { createSettingsAgentsSection } from "./SettingsAgentsSection";

const models = [
  { provider: "codex", id: "gpt-6.1-sol", name: "GPT-6.1-Sol" },
  { provider: "codex", id: "gpt-6.1-terra", name: "GPT-6.1 Terra" },
];

function portWith(state: () => StartRetryState, setStartRetry: (settings: StartRetrySettings) => void) {
  return {
    getStartRetry: async () => state(),
    // As the preload does: a store proxy that reaches here would throw a DataCloneError.
    setStartRetry: async (settings: StartRetrySettings) => {
      setStartRetry(structuredClone(settings));
      return state();
    },
    agent: { listAgents: async () => [], listModels: async () => models },
    backgroundProcesses: { list: async () => [] },
  };
}

function show() {
  render(() => {
    const section = createSettingsAgentsSection({
      visible: () => true,
      value: () => DEFAULT_GENERAL_SETTINGS,
      onValueChange: () => undefined,
    });
    const Panel = section.Panel;
    return (
      <TextProvider locale="pt">
        <Panel menuMount={undefined} />
      </TextProvider>
    );
  });
}

async function pick(optionKey: string): Promise<void> {
  const trigger = await screen.findByRole("button", { name: /Modelo de reserva padrão/ });
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
  const list = await screen.findByRole("listbox", { name: /Modelo de reserva padrão/ });
  const option = within(list)
    .getAllByRole("option")
    .find((item) => (item.getAttribute("data-key") ?? "").endsWith(optionKey));
  if (!option) throw new Error(`There is no option ${optionKey}.`);
  fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
  fireEvent.click(option);
}

describe("the default backup model", () => {
  it("saves the chosen model and shows it", async () => {
    let saved: StartRetryState = { settings: DEFAULT_START_RETRY_SETTINGS, breakers: [] };
    const setStartRetry = vi.fn<(settings: StartRetrySettings) => void>((settings) => {
      saved = { settings, breakers: [] };
    });
    Object.assign(window, { buildersbot: portWith(() => saved, setStartRetry) });
    show();

    await pick("gpt-6.1-sol");

    await waitFor(() => expect(setStartRetry).toHaveBeenCalled());
    expect(saved.settings.defaultFallback).toEqual({ provider: "codex", model: "gpt-6.1-sol" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Modelo de reserva padrão/ }).textContent).toContain("GPT-6.1-Sol"),
    );
  });
});
