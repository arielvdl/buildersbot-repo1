import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/quick";

export const messages = {
  "quick.agentName": "Schnellchat",
  "quick.rail.label": "Schnellchat",
  "quick.page.label": "Schnellchat",
  "quick.page.loading": "Schnellchat wird geladen",
  "quick.owner.name": "Schnell",
  "quick.empty.title": "Was möchtest du lösen?",
  "quick.list.label": "Schnellchat-Unterhaltungen",
  "quick.list.title": "Schnellchat",
  "quick.list.new": "Neu",
  "quick.list.search": "Unterhaltungen suchen",
  "quick.list.loading": "Unterhaltungen werden geladen",
  "quick.list.empty": "Noch keine Unterhaltungen",
  "quick.list.noResults": "Keine Unterhaltung gefunden",
  "quick.list.group.today": "Heute",
  "quick.list.group.yesterday": "Gestern",
  "quick.list.group.week": "Letzte 7 Tage",
  "quick.list.group.older": "Älter",
  "quick.list.archived": "Archiviert",
  "quick.list.queued": "In Warteschlange",
  "quick.list.rowActions": "Aktionen für {title}",
  "quick.header.new": "Neue Unterhaltung",
  "quick.notice.modelChanged":
    "Das Modell für den Schnellchat ist nicht mehr verfügbar. Es wurde auf den Standard umgestellt.",
  "quick.signIn.title": "Verbinde einen Anbieter, um den Schnellchat zu nutzen",
  "quick.signIn.action": "Anbieter öffnen",
  "quick.error.agentGone": "Dieser Agent ist nicht mehr verfügbar.",
  "quick.error.title": "Der Schnellchat konnte nicht geöffnet werden",
  "quick.error.retry": "Wiederholen",
} as const satisfies PartialTranslation<typeof source>;
