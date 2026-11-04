import { serializeEditor } from "@buildersbot/ui/features/conversation/composer-dom";
import {
  createStorePlatformToken,
  createStoreToolToken,
  renderEditorValue,
} from "@buildersbot/ui/features/conversation/composer-tokens";
import { describe, expect, it } from "vitest";

const ACTIONS = {
  tooltipId: "t",
  open: () => undefined,
  showTooltip: () => undefined,
  hideTooltip: () => undefined,
  remove: () => undefined,
};
const TEXT = "Veja [tool-catalog: Company data by domain (company.enrich)] para a empresa";

describe("a store tool chip in the message box", () => {
  it("shows the text of a draft as a chip and sends the same text back", () => {
    const editor = document.createElement("div");
    renderEditorValue(editor, TEXT, [], [], [], [], ACTIONS);
    const chip = editor.querySelector<HTMLElement>("[data-store-endpoint-id]");
    expect(chip?.dataset.storeEndpointId).toBe("company.enrich");
    expect(chip?.textContent).toContain("Company data by domain");
    expect(serializeEditor(editor)).toBe(TEXT);
  });

  it("keeps a bracket that is not a tool as plain text", () => {
    const editor = document.createElement("div");
    renderEditorValue(editor, "[tool-catalog: sem id]", [], [], [], [], ACTIONS);
    expect(editor.querySelector("[data-store-endpoint-id]")).toBeNull();
    expect(serializeEditor(editor)).toBe("[tool-catalog: sem id]");
  });

  it("serializes a chip made by the picker to the same text", () => {
    const editor = document.createElement("div");
    editor.append(createStoreToolToken("Company [x]", "company.enrich"));
    expect(serializeEditor(editor)).toBe("[tool-catalog: Company x (company.enrich)]");
  });
});

describe("a store platform chip in the message box", () => {
  const PLATFORM_TEXT =
    "Use [tool-catalog platform: YouTube (youtube)] e [tool-catalog: Company data (company.enrich)] aqui";

  it("shows both kinds of chip from a draft and sends the same text back", () => {
    const editor = document.createElement("div");
    renderEditorValue(editor, PLATFORM_TEXT, [], [], [], [], ACTIONS);
    expect(editor.querySelector<HTMLElement>("[data-store-platform-id]")?.dataset.storePlatformId).toBe("youtube");
    expect(editor.querySelector<HTMLElement>("[data-store-endpoint-id]")?.dataset.storeEndpointId).toBe(
      "company.enrich",
    );
    expect(serializeEditor(editor)).toBe(PLATFORM_TEXT);
  });

  it("serializes a chip made by the picker to the same text", () => {
    const editor = document.createElement("div");
    editor.append(createStorePlatformToken("YouTube", "youtube"));
    expect(serializeEditor(editor)).toBe("[tool-catalog platform: YouTube (youtube)]");
  });
});
