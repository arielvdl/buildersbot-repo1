// The Hub client of a local server (docs/architecture/hub-connections.md, "Local servers"). It holds no
// Cultura Builder session and no token: each operation goes to the desktop app over the private channel
// of `hub-delegate-protocol.ts`, and the app runs it with the one `HubConnectionClient` that it has.
//
// `HubConnectionTools` reads two things without waiting: whether the person is signed in, and the ids of
// the connections. The app pushes both as a snapshot, and every answer carries the current one, so
// neither reads the channel. The delegate keeps no other cache: the app's client already caches the
// session and the catalog, and a cache here would outlive a sign-out.
//
// Every failure of the channel (no hello yet, a closed pipe, a line that is too long, no answer in time)
// is the failure `offline`, so the tools fail closed with their own fixed text.

import type {
  HubAccessRequestAnswer,
  HubConfirmationStatus,
  HubConnectionCatalog,
  HubConnectionUsage,
  HubSessionConnections,
  ToolCatalogCallOutcome,
  ToolCatalogCallRequest,
  ToolCatalogDescribeAnswer,
  ToolCatalogSearchAnswer,
  ToolCatalogSearchRequest,
} from "@buildersbot/contracts/hub-connections";
import { isDynamicRecord, isNumber, isString } from "@buildersbot/contracts/runtime-values";
import { Effect } from "effect";
import {
  HUB_CLIENT_FAILURES,
  type HubClientFailureCode,
  HubConnectionFailure,
  type HubOperationOutcome,
} from "./hub-connection-client";
import type { HubConnectionPort } from "./hub-connection-port";
import {
  EMPTY_SNAPSHOT,
  HUB_DELEGATE_LIMITS,
  HUB_DELEGATE_PREFIX,
  type HubDelegateMethod,
  type HubDelegateSnapshot,
  openFrame,
  readHello,
  readSnapshot,
  sealFrame,
} from "./hub-delegate-protocol";

export interface HubConnectionDelegateOptions {
  /** Writes one line, without its newline, to the app (the standard output of this process). False when it cannot. */
  readonly send: (line: string) => boolean;
  /** Tests only. */
  readonly timeoutMs?: number;
}

type Answer =
  | { readonly ok: true; readonly payload: string }
  | { readonly ok: false; readonly failure: HubConnectionFailure };

interface Pending {
  readonly resolve: (answer: Answer) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function failureCode(value: unknown): HubClientFailureCode | null {
  return HUB_CLIENT_FAILURES.find((code) => code === value) ?? null;
}

function offline(): HubConnectionFailure {
  return new HubConnectionFailure({ code: "offline" });
}

export class HubConnectionDelegate implements HubConnectionPort {
  readonly #send: (line: string) => boolean;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, Pending>();
  #key: Buffer | null = null;
  #snapshot: HubDelegateSnapshot = EMPTY_SNAPSHOT;
  #lastId = 0;
  #closed = false;

  constructor(options: HubConnectionDelegateOptions) {
    this.#send = options.send;
    this.#timeoutMs = options.timeoutMs ?? HUB_DELEGATE_LIMITS.childTimeoutMs;
  }

  /** One line of the app: the hello with the key, then answers and snapshots. Other lines are ignored. */
  receive(line: string): void {
    if (this.#closed) return;
    if (this.#key === null) {
      const hello = readHello(line);
      if (!hello) return;
      this.#key = hello.key;
      this.#snapshot = hello.snapshot;
      return;
    }
    if (!line.startsWith(HUB_DELEGATE_PREFIX)) return;
    const payload = openFrame(
      this.#key,
      "response",
      line.slice(HUB_DELEGATE_PREFIX.length),
      HUB_DELEGATE_LIMITS.responseChars,
    );
    if (payload === null) return;
    let message: unknown;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (!isDynamicRecord(message)) return;
    if (message.type === "snapshot") {
      const snapshot = readSnapshot(message.snapshot);
      if (snapshot) this.#snapshot = snapshot;
      return;
    }
    if (!isNumber(message.id)) return;
    const snapshot = readSnapshot(message.snapshot);
    if (snapshot) this.#snapshot = snapshot;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok === true) {
      pending.resolve({ ok: true, payload });
      return;
    }
    const code = failureCode(message.code);
    pending.resolve({
      ok: false,
      failure: code
        ? new HubConnectionFailure({
            code,
            ...(isNumber(message.status) ? { status: message.status } : {}),
            ...(isString(message.tokenError) ? { tokenError: message.tokenError } : {}),
          })
        : offline(),
    });
  }

  /** The app's end of the channel closed: it stopped, or it stopped serving. Nothing is answered after it. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#snapshot = EMPTY_SNAPSHOT;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      pending.resolve({ ok: false, failure: offline() });
    }
  }

  signedIn(): boolean {
    return this.#snapshot.signedIn;
  }

  knownConnectionIds(): string[] {
    return [...this.#snapshot.connectionIds];
  }

  /** The app's own sign-in and sign-out decide: this process holds no session to forget. */
  forget(): void {}

  forgetCatalog(): void {
    this.#notify("forget_catalog", {});
  }

  forgetCapabilities(): void {
    this.#notify("forget_capabilities", {});
  }

  forgetOrg(orgId: string): void {
    this.#notify("forget_org", { orgId });
  }

  // `fresh` is not sent: the app reads again when its own caches end, or after a `forget_*` notice.
  capabilities(_fresh = false): Effect.Effect<HubSessionConnections, HubConnectionFailure> {
    return this.#ask("capabilities", {});
  }

  catalog(_fresh = false): Effect.Effect<HubConnectionCatalog, HubConnectionFailure> {
    return this.#ask("catalog", {});
  }

  search(
    orgId: string,
    body: ToolCatalogSearchRequest,
  ): Effect.Effect<HubOperationOutcome<ToolCatalogSearchAnswer>, HubConnectionFailure> {
    return this.#ask("search", { orgId, body });
  }

  describe(
    orgId: string,
    endpointId: string,
  ): Effect.Effect<HubOperationOutcome<ToolCatalogDescribeAnswer>, HubConnectionFailure> {
    return this.#ask("describe", { orgId, endpointId });
  }

  call(
    orgId: string,
    body: ToolCatalogCallRequest,
    idempotencyKey: string,
  ): Effect.Effect<ToolCatalogCallOutcome, HubConnectionFailure> {
    return this.#ask("call", { orgId, body, idempotencyKey });
  }

  confirmation(
    orgId: string,
    confirmationId: string,
  ): Effect.Effect<HubOperationOutcome<HubConfirmationStatus>, HubConnectionFailure> {
    return this.#ask("confirmation", { orgId, confirmationId });
  }

  // The person's own screens read usage and ask the admins for access. A local server has no such
  // screen, and the app does not serve either one to it.
  usage(): Effect.Effect<HubOperationOutcome<HubConnectionUsage>, HubConnectionFailure> {
    return Effect.fail(new HubConnectionFailure({ code: "disabled" }));
  }

  requestAccess(): Effect.Effect<HubOperationOutcome<HubAccessRequestAnswer>, HubConnectionFailure> {
    return Effect.fail(new HubConnectionFailure({ code: "disabled" }));
  }

  /** The line for a request, or null when it is too long or there is no key yet. */
  #line(method: HubDelegateMethod, args: unknown): { id: number; line: string } | null {
    if (this.#closed || this.#key === null) return null;
    const id = this.#lastId + 1;
    const payload = JSON.stringify({ id, method, args });
    if (payload.length > HUB_DELEGATE_LIMITS.requestChars) return null;
    this.#lastId = id;
    return { id, line: `${HUB_DELEGATE_PREFIX}${sealFrame(this.#key, "request", payload)}` };
  }

  #notify(method: HubDelegateMethod, args: unknown): void {
    const request = this.#line(method, args);
    if (!request) return;
    try {
      this.#send(request.line);
    } catch {
      // The pipe is gone: the next request fails by its own.
    }
  }

  /**
   * One request. The answer is trusted: the app decoded it with the contract decoders before it sent it,
   * and the channel is private and authenticated, so it is not decoded again. Its type is the one of the
   * method, which the callers above fix.
   */
  #ask<Value>(method: HubDelegateMethod, args: unknown): Effect.Effect<Value, HubConnectionFailure> {
    return Effect.callback<Value, HubConnectionFailure>((resume) => {
      const request = this.#line(method, args);
      if (!request) return resume(Effect.fail(offline()));
      const timer = setTimeout(() => {
        this.#pending.delete(request.id);
        resume(Effect.fail(offline()));
      }, this.#timeoutMs);
      this.#pending.set(request.id, {
        timer,
        resolve: (answer) =>
          resume(answer.ok ? Effect.succeed(trustedValue<Value>(answer.payload)) : Effect.fail(answer.failure)),
      });
      let sent = false;
      try {
        sent = this.#send(request.line);
      } catch {
        sent = false;
      }
      if (!sent) {
        clearTimeout(timer);
        this.#pending.delete(request.id);
        resume(Effect.fail(offline()));
        return;
      }
      // An interrupted wait (the turn ended) forgets its answer, which the app still sends.
      return Effect.sync(() => {
        clearTimeout(timer);
        this.#pending.delete(request.id);
      });
    });
  }
}

/**
 * The value of an answer, typed by the method that asked. `JSON.parse` gives the type its caller names:
 * the shape is the app's, which decoded it with the contract decoders, and is not checked again here.
 */
function trustedValue<Value>(payload: string): Value {
  const answer: { readonly value: Value } = JSON.parse(payload);
  return answer.value;
}
