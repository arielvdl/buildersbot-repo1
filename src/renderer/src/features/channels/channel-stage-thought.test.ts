import { describe, expect, it } from "vitest";
import { stageThoughtLine } from "./channel-stage-thought";

describe("stageThoughtLine", () => {
  it("takes the last finished sentence of the thought", () => {
    expect(stageThoughtLine("Ajusto dois detalhes. Agora integro na rota do Meta.")).toBe(
      "Agora integro na rota do Meta.",
    );
  });

  it("leaves out the sentence that is still being written", () => {
    expect(stageThoughtLine("Typecheck limpo. Rodo os testes existentes afet")).toBe("Typecheck limpo.");
  });

  it("does not end a sentence at a file name or a number", () => {
    expect(stageThoughtLine("Integro em `metaai-route.ts` com 16.476 testes passando.")).toBe(
      "Integro em metaai-route.ts com 16.476 testes passando.",
    );
  });

  it("shows nothing while the first sentence is short and unfinished", () => {
    expect(stageThoughtLine("Estou lend")).toBeNull();
  });

  it("shows the head of a long first sentence, cut at a word, so the bubble stays still as it grows", () => {
    const head =
      "Enquanto a medição roda, escrevo o executor da cadeia com a lição já aprendida sobre a resposta vazia";
    const one = stageThoughtLine(`${head} da Surplus`);
    const two = stageThoughtLine(`${head} da Surplus é falha de passo e há limite`);
    expect(one).toBe(two);
    expect(one).not.toBeNull();
  });

  it("cuts a very long finished sentence at a word with an ellipsis", () => {
    const line = stageThoughtLine(`${"palavra ".repeat(40)}fim.`);
    expect(line?.length).toBeLessThanOrEqual(110);
    expect(line?.endsWith("…")).toBe(true);
  });

  it("ignores markdown and empty text", () => {
    expect(stageThoughtLine("**Vou ler** o arquivo.")).toBe("Vou ler o arquivo.");
    expect(stageThoughtLine("  \n ")).toBeNull();
  });
});
