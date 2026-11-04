import type { AgentEvent } from "@buildersbot/contracts/ipc";
import type { BuildersBotDatabase } from "../buildersbot-database";
import type { ConversationRuntime } from "./conversation-runtime";

export interface PendingDeltaInput {
  agentId: string;
  externalThreadId: string;
  publicThreadId: string;
  turnId: string;
  messageId: string;
  text: string;
  createdAt: string;
}

interface BufferedDelta extends PendingDeltaInput {
  timer: NodeJS.Timeout | null;
}

export interface DeltaBufferHooks {
  emit(event: AgentEvent): void;
}

export interface DeltaBufferOptions {
  conversation: ConversationRuntime;
  database: BuildersBotDatabase;
  hooks: DeltaBufferHooks;
}

/** The debounce of a flush when one or two messages stream. */
const BASE_FLUSH_MS = 100;
/** The longest debounce, so a streaming reply still moves about twice a second. */
const MAX_FLUSH_MS = 500;

/**
 * The debounce of a message that starts to wait, given how many other messages wait now. Each flush is
 * a write to the database and an event on the main process, so with many agents that stream together
 * the flushes of all of them filled the main loop (F-20: 750 ms p99 with 4 to 8 turns, 3 ms idle).
 * One or two streams keep 100 ms. Each two more streams add 100 ms, up to 500 ms.
 */
export function flushDelayMs(waiting: number): number {
  return Math.min(MAX_FLUSH_MS, BASE_FLUSH_MS * Math.max(1, Math.ceil(waiting / 2)));
}

/**
 * Coalesces `item/agentMessage/delta` notifications into `conversation-delta`
 * events. Deltas accumulate per message and flush on a debounce of 100 ms
 * (`flushDelayMs` makes it longer while many messages stream), an
 * 8 KiB cap, item completion, or turn completion — whichever comes first.
 *
 * Owns the pending map and its timers. Persistence goes through the database,
 * snapshots through the conversation runtime, delivery through `emit`; the
 * class never imports the facade.
 */
export class DeltaBuffer {
  readonly #conversation: ConversationRuntime;
  readonly #database: BuildersBotDatabase;
  readonly #hooks: DeltaBufferHooks;
  readonly #pending = new Map<string, BufferedDelta>();

  constructor(options: DeltaBufferOptions) {
    this.#conversation = options.conversation;
    this.#database = options.database;
    this.#hooks = options.hooks;
  }

  buffer(delta: PendingDeltaInput): void {
    const key = `${delta.externalThreadId}:${delta.turnId}:${delta.messageId}`;
    const existing = this.#pending.get(key);
    if (existing) {
      existing.text += delta.text;
      if (Buffer.byteLength(existing.text, "utf8") >= 8 * 1024) this.flush(key);
      return;
    }
    const pending: BufferedDelta = { ...delta, timer: null };
    pending.timer = setTimeout(() => this.flush(key), flushDelayMs(this.#pending.size));
    this.#pending.set(key, pending);
  }

  flush(key: string): void {
    const pending = this.#pending.get(key);
    if (!pending) return;
    this.#pending.delete(key);
    if (pending.timer) clearTimeout(pending.timer);
    const snapshot = this.#conversation.ensureSnapshot(pending.agentId, pending.publicThreadId);
    // Only the streamed message changed, and a flush lands ten times a second per streaming
    // message. Writing the whole thread here made the cost of one flush grow with the thread's
    // whole history, which is what saturated the main process when several agents streamed at once.
    snapshot.revision = this.#database.persistStreamingMessage({
      snapshot,
      messageId: pending.messageId,
      eventType: "response.delta-flushed",
      detail: {
        turnId: pending.turnId,
        messageId: pending.messageId,
        bytes: Buffer.byteLength(pending.text, "utf8"),
      },
    });
    this.#hooks.emit({
      type: "conversation-delta",
      agentId: pending.agentId,
      threadId: pending.publicThreadId,
      turnId: pending.turnId,
      messageId: pending.messageId,
      delta: pending.text,
      createdAt: pending.createdAt,
      revision: snapshot.revision,
    });
  }

  flushTurn(turnId: string): void {
    for (const [key, pending] of this.#pending) {
      if (pending.turnId === turnId) this.flush(key);
    }
  }

  dispose(): void {
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.#pending.clear();
  }
}
