import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/quick";

export const messages = {
  "quick.agentName": "Chat rápido",
  "quick.rail.label": "Chat rápido",
  "quick.page.label": "Chat rápido",
  "quick.page.loading": "Carregando o Chat rápido",
  "quick.empty.title": "O que você quer resolver?",
  "quick.composer.label": "Mensagem",
  "quick.composer.placeholder": "Pergunte qualquer coisa",
} as const satisfies PartialTranslation<typeof source>;
