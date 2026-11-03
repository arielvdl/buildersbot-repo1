// @vitest-environment node

import { stripAttachmentReferences } from "@buildersbot/contracts/attachment-references";
import { describe, expect, it } from "vitest";

describe("stripAttachmentReferences", () => {
  it("keeps the words and drops the markers", () => {
    expect(stripAttachmentReferences("@[image.png](attachment:abc)O motivo do resumo")).toBe("O motivo do resumo");
    expect(stripAttachmentReferences("Veja @[a.png](attachment:1) e @[b.png](attachment:2) agora")).toBe(
      "Veja e agora",
    );
  });
  it("keeps the lines", () => {
    expect(stripAttachmentReferences("@[a.png](attachment:1)\n\nSegunda linha")).toBe("Segunda linha");
  });
  it("answers empty when the text is only files", () => {
    expect(stripAttachmentReferences("@[a.png](attachment:1) @[b.png](attachment:2)")).toBe("");
  });
});
