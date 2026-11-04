import { INPUT_LIMITS } from "@buildersbot/contracts/input-limits";
import type { ChannelMemory } from "@buildersbot/contracts/ipc";
import { sourceText } from "@buildersbot/i18n/source";
import type { BuildersBotDatabase } from "./buildersbot-database";
import { MemoryStore, type MemoryTables } from "./memory-store";

const CHANNEL_MEMORY_TABLES: MemoryTables = {
  table: "projection_channel_memories",
  ownerColumn: "channel_id",
  ownerKey: "channelId",
  aggregateType: "channel-memory",
  limit: () => INPUT_LIMITS.channelMemories,
  limitMessage: (limit) => sourceText("error.backend.channelMemoryLimit", { limit }),
};

/**
 * An automatic memory that no turn updated for this long expires. A memory that a person wrote or
 * edited (`origin` `manual`) is fixed: it never expires.
 */
export const CHANNEL_MEMORY_EXPIRY_DAYS = 45;
/** The count of memories at which the packet tells the lead to fold related ones (`INPUT_LIMITS.channelMemories` is 32). */
export const CHANNEL_MEMORY_FOLD_AT = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The channel twin of `AgentMemoryStore`: the same `MemoryStore`, with a channel for an owner. */
export class ChannelMemoryStore extends MemoryStore {
  constructor(database: BuildersBotDatabase) {
    super(database, CHANNEL_MEMORY_TABLES);
  }

  override list(channelId: string): ChannelMemory[] {
    return super.list(channelId).map((memory) => ({ ...memory, channelId }));
  }

  override get(channelId: string, memoryId: string): ChannelMemory | null {
    const memory = super.get(channelId, memoryId);
    return memory && { ...memory, channelId };
  }

  override createManual(channelId: string, text: string): ChannelMemory {
    return { ...super.createManual(channelId, text), channelId };
  }

  override updateManual(channelId: string, memoryId: string, text: string): ChannelMemory {
    return { ...super.updateManual(channelId, memoryId, text), channelId };
  }

  /**
   * A channel tool writes at call time, so there is no `expectedUpdatedAt` race to guard. `commandId`
   * is the call's own receipt key: a retried tool call reads it and saves nothing more.
   */
  saveFromTool(channelId: string, text: string, sourceTurnId: string, commandId: string): ChannelMemory {
    const memory = this.saveAutomaticEntry(channelId, { text, sourceTurnId, commandId });
    if (!memory) throw new Error(sourceText("error.backend.memoryGone"));
    return { ...memory, channelId };
  }

  /**
   * Deletes the automatic memories of a channel that no turn updated for `CHANNEL_MEMORY_EXPIRY_DAYS`.
   * Every memory goes in each packet, so an old fact that nobody saved again competes with the current
   * ones. A manual memory is fixed and stays. Returns how many it deleted.
   */
  expireStale(channelId: string, nowMs: number = Date.now(), maxAgeDays: number = CHANNEL_MEMORY_EXPIRY_DAYS): number {
    const limit = nowMs - maxAgeDays * DAY_MS;
    let deleted = 0;
    for (const memory of this.list(channelId)) {
      const updated = Date.parse(memory.updatedAt);
      if (
        memory.origin === "automatic" &&
        Number.isFinite(updated) &&
        updated < limit &&
        this.delete(channelId, memory.id)
      )
        deleted += 1;
    }
    return deleted;
  }

  /**
   * `channel_forget_memory` names the text, not an id: the model never sees a memory id. An exact,
   * case-sensitive match wins first: `MemoryStore#save` does not merge entries that differ only by
   * case, so two such entries can coexist, and forgetting one must not delete the other instead.
   * Only when no exact match exists does this fall back to a case-insensitive match, since a model
   * or user retypes the fact from memory rather than copying it verbatim.
   */
  deleteByText(channelId: string, text: string): boolean {
    const target = text.trim();
    const entries = this.list(channelId);
    const exact = entries.find((entry) => entry.text === target);
    const memory = exact ?? entries.find((entry) => entry.text.toLowerCase() === target.toLowerCase());
    return memory ? this.delete(channelId, memory.id) : false;
  }
}
