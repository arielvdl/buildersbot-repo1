// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cleanQuickChatTitle, quickChatTitlePrompt } from "./quick-chat-title";

describe("cleanQuickChatTitle", () => {
  it("keeps one plain line", () => {
    expect(cleanQuickChatTitle('"Análise da extensão do Chrome."\n\nOutra linha')).toBe(
      "Análise da extensão do Chrome",
    );
  });
  it("drops a label and markdown", () => {
    expect(cleanQuickChatTitle("Title: **Fix the login bug**")).toBe("Fix the login bug");
    expect(cleanQuickChatTitle("Título: Plano de viagem")).toBe("Plano de viagem");
  });
  it("limits the length", () => {
    expect(cleanQuickChatTitle("a".repeat(200))?.length).toBe(80);
  });
  it("answers null when nothing is left", () => {
    expect(cleanQuickChatTitle("  \n ")).toBeNull();
    expect(cleanQuickChatTitle('""')).toBeNull();
  });
});

describe("quickChatTitlePrompt", () => {
  it("cuts a long message and a long answer", () => {
    const prompt = quickChatTitlePrompt("q".repeat(5000), "a".repeat(5000));
    expect(prompt.length).toBeLessThan(2000);
  });
});
