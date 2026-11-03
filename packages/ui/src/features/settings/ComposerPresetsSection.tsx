import {
  Button,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Plus,
  SettingsSection,
  Text,
  Textarea,
  Trash2,
} from "@buildersbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import {
  COMPOSER_PRESET_NAME_MAX,
  COMPOSER_PRESET_PROMPT_MAX,
  type ComposerPreset,
  formatPresetShortcut,
  isReservedPresetShortcut,
  presetShortcutFromEvent,
} from "../conversation/composer-presets";

export interface ComposerPresetInput {
  name: string;
  prompt: string;
  shortcut: string | null;
}

export interface ComposerPresetsSectionProps {
  presets: readonly ComposerPreset[];
  /** The device with the keyboard, so the keys show as ⌘ or as Ctrl. */
  devicePlatform: "darwin" | "win32" | "linux";
  onAdd: (input: ComposerPresetInput) => void;
  onUpdate: (id: string, input: ComposerPresetInput) => void;
  onRemove: (id: string) => void;
}

/** The key combination of a preset, taken from the keyboard. Esc cancels; a reserved combination is refused. */
function ShortcutField(props: {
  value: string | null;
  devicePlatform: ComposerPresetsSectionProps["devicePlatform"];
  onChange: (shortcut: string | null) => void;
}) {
  const { t } = useText();
  const [capturing, setCapturing] = createSignal(false);
  const [reserved, setReserved] = createSignal(false);
  const label = () =>
    capturing()
      ? t("settings.presets.shortcutPress")
      : props.value
        ? formatPresetShortcut(props.value, props.devicePlatform)
        : t("settings.presets.shortcutNone");

  function take(event: KeyboardEvent): void {
    if (!capturing()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setCapturing(false);
      return;
    }
    if (event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    const shortcut = presetShortcutFromEvent(event);
    // A modifier on its own is half a combination: wait for the key that follows.
    if (shortcut === null) return;
    if (isReservedPresetShortcut(shortcut)) {
      setReserved(true);
      return;
    }
    setReserved(false);
    setCapturing(false);
    props.onChange(shortcut);
  }

  return (
    <div class="composer-presets-shortcut">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("settings.presets.shortcut")}
        onClick={() => {
          setReserved(false);
          setCapturing(true);
        }}
        onKeyDown={take}
        onBlur={() => setCapturing(false)}
      >
        {label()}
      </Button>
      <Show when={props.value && !capturing()}>
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onChange(null)}>
          {t("settings.presets.shortcutClear")}
        </Button>
      </Show>
      <Text tone="muted" variant="caption">
        {reserved() ? t("settings.presets.shortcutReserved") : t("settings.presets.shortcutHint")}
      </Text>
    </div>
  );
}

function PresetForm(props: {
  initial: ComposerPresetInput;
  devicePlatform: ComposerPresetsSectionProps["devicePlatform"];
  onSave: (input: ComposerPresetInput) => void;
  onCancel: () => void;
}) {
  const { t } = useText();
  const [name, setName] = createSignal(props.initial.name);
  const [prompt, setPrompt] = createSignal(props.initial.prompt);
  const [shortcut, setShortcut] = createSignal<string | null>(props.initial.shortcut);
  const valid = () => name().trim().length > 0 && prompt().trim().length > 0;
  return (
    <form
      class="composer-presets-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid()) props.onSave({ name: name().trim(), prompt: prompt(), shortcut: shortcut() });
      }}
    >
      <Field label={t("settings.presets.name")}>
        <Input
          value={name()}
          maxlength={COMPOSER_PRESET_NAME_MAX}
          placeholder={t("settings.presets.namePlaceholder")}
          onValueChange={setName}
        />
      </Field>
      <Field label={t("settings.presets.prompt")}>
        <Textarea
          value={prompt()}
          rows={4}
          maxlength={COMPOSER_PRESET_PROMPT_MAX}
          placeholder={t("settings.presets.promptPlaceholder")}
          onValueChange={setPrompt}
        />
      </Field>
      <Field label={t("settings.presets.shortcut")}>
        <ShortcutField value={shortcut()} devicePlatform={props.devicePlatform} onChange={setShortcut} />
      </Field>
      <div class="composer-presets-form-actions">
        <Button type="submit" size="sm" disabled={!valid()}>
          {t("common.save")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The prompt presets of the reader. There is no limit: the "+" menu of the message box lists all of
 * them, and each one can have its own keys.
 */
export function ComposerPresetsSection(props: ComposerPresetsSectionProps) {
  const { t } = useText();
  // The id of the preset in the form, "new" for a preset not made yet, or nothing.
  const [editing, setEditing] = createSignal<string | null>(null);
  return (
    <SettingsSection
      data-settings-row="settings.presets.title"
      title={t("settings.presets.title")}
      description={t("settings.presets.description")}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          {t("settings.presets.add")}
        </Button>
      }
    >
      <Show when={editing() === "new"}>
        <PresetForm
          initial={{ name: "", prompt: "", shortcut: null }}
          devicePlatform={props.devicePlatform}
          onSave={(input) => {
            props.onAdd(input);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      </Show>
      <Show
        when={props.presets.length > 0}
        fallback={
          <Show when={editing() !== "new"}>
            <Text tone="muted">{t("settings.presets.empty")}</Text>
          </Show>
        }
      >
        <ItemGroup class="settings-modal-card">
          <For each={props.presets}>
            {(preset) => (
              <Show
                when={editing() === preset.id}
                fallback={
                  <Item class="settings-modal-row">
                    <ItemContent>
                      <ItemTitle>{preset.name}</ItemTitle>
                      <ItemDescription class="composer-presets-preview">{preset.prompt}</ItemDescription>
                      <Show when={preset.shortcut}>
                        {(shortcut) => (
                          <kbd class="composer-presets-keys">
                            {formatPresetShortcut(shortcut(), props.devicePlatform)}
                          </kbd>
                        )}
                      </Show>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("settings.presets.editLabel", { name: preset.name })}
                        onClick={() => setEditing(preset.id)}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("settings.presets.deleteLabel", { name: preset.name })}
                        onClick={() => props.onRemove(preset.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </ItemActions>
                  </Item>
                }
              >
                <PresetForm
                  initial={{ name: preset.name, prompt: preset.prompt, shortcut: preset.shortcut }}
                  devicePlatform={props.devicePlatform}
                  onSave={(input) => {
                    props.onUpdate(preset.id, input);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </Show>
            )}
          </For>
        </ItemGroup>
      </Show>
    </SettingsSection>
  );
}
