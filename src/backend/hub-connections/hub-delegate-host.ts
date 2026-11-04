// The app's half of the channel to a local server (`hub-delegate-protocol.ts`). It answers the requests
// of the child's `HubConnectionDelegate` with the app's one `HubConnectionClient`, which holds the
// Cultura Builder session. One host serves one child process, from its start until it exits, or until
// the person signs out. Nothing that the host sends holds a session or a token: it sends the answers
// that the contract decoders made, and a failure as a code.
//
// The child is a process of the person's own app, but its agents run commands, so the host checks each
// request as the child's own tools layer checks it, and as strictly:
// - only the methods of `HUB_DELEGATE_METHODS`, with the exact arguments each one takes;
// - a search text goes through `toolCatalogSearchRequest` and `valueRule`, as in the tools;
// - a call goes through `readCallInput` and `checkCallInput` against the endpoint's own description
//   (read from the Hub here, not taken from the child), so a refused input never leaves this computer;
// - only the fields that the tools set in a call body, and `maxCostMicros` only with a `confirmationId`;
//   and only an approval id that this host gave the child in a cost question, never another;
// - no `requestAccess` and no `usage`: those belong to the person's own screens, which a local server
//   does not have;
// - a size limit for each request, a counter of ids that only grows, at most 8 requests in flight and 240 a
//   minute, and the hourly limit of paid calls of the tools.
// A line that fails its check is dropped. After 10 of them the host stops serving this child.
// The log has fixed texts only: no id, no value and no input.

import {
  HUB_CALL_ORIGINS,
  type HubCallOrigin,
  type HubErrorAnswer,
  isHubConfirmationId,
  isHubConnectionId,
  isHubEndpointId,
  isHubOrgId,
  type ToolCatalogCallRequest,
  type ToolCatalogDescribeAnswer,
  toolCatalogSearchRequest,
} from "@buildersbot/contracts/hub-connections";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@buildersbot/contracts/runtime-values";
import { createBuildersBotLogger } from "@buildersbot/logging";
import { Duration, Effect } from "effect";
import { type HubClientFailureCode, HubConnectionFailure, type HubOperationOutcome } from "./hub-connection-client";
import { checkCallInput, readCallInput, valueRule } from "./hub-connection-input";
import type { HubConnectionPort } from "./hub-connection-port";
import {
  formatHello,
  HUB_DELEGATE_LIMITS,
  HUB_DELEGATE_PREFIX,
  type HubDelegateMethod,
  type HubDelegateRequest,
  type HubDelegateSnapshot,
  isHubDelegateMethod,
  newDelegateKey,
  openFrame,
  readRequest,
  sealFrame,
} from "./hub-delegate-protocol";

const logger = createBuildersBotLogger("hub-delegate");

/** The Hub client as the host uses it. `onForget` tells the host when a sign-out or a new sign-in happened. */
export type HubDelegateHostClient = Pick<
  HubConnectionPort,
  | "signedIn"
  | "knownConnectionIds"
  | "capabilities"
  | "catalog"
  | "search"
  | "describe"
  | "call"
  | "confirmation"
  | "forgetCatalog"
  | "forgetCapabilities"
  | "forgetOrg"
> & { onForget(listener: () => void): () => void };

export interface HubDelegateHostOptions {
  readonly client: HubDelegateHostClient;
  /** Writes one line, without its newline, to the child's standard input. False when it cannot. */
  readonly write: (line: string) => boolean;
  /** Tests only. A fixed text goes to the logger. */
  readonly warn?: (message: string) => void;
  readonly now?: () => number;
  /** Tests only. */
  readonly key?: Buffer;
  /** How often the host looks for a sign-out that did not pass through `forget`. */
  readonly snapshotCheckMs?: number;
}

type Wire =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly code: HubClientFailureCode;
      readonly status?: number;
      readonly tokenError?: string;
    };

const SNAPSHOT_CHECK_MS = 15_000;
/** A cost approval lasts 5 minutes at most (`CONFIRMATION_MS` of the tools), and at most so many are open. */
const ISSUED_MS = 10 * 60_000;
const ISSUED_LIMIT = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CALL_FIELDS = new Set(["endpointId", "origin", "query", "body", "maxCostMicros", "confirmationId"]);
const SEARCH_FIELDS = new Set(["query", "platform", "limit"]);

/** A request that the channel refuses before the Hub: the answer is a failure with a status that says why. */
function refusedWire(status: number): Wire {
  return { ok: false, code: "hub_unavailable", status };
}

function emptyArgs(args: unknown): boolean {
  return isDynamicRecord(args) && Object.keys(args).length === 0;
}

function onlyKeys(value: DynamicRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value: DynamicRecord, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function inputRefused(): HubErrorAnswer {
  return {
    kind: "error",
    error: "input_refused",
    reason: null,
    scope: null,
    retryAfterSeconds: null,
    estimateMicros: null,
    chargedMicros: null,
    providerStatus: null,
    providerMessage: null,
    field: null,
    alternatives: [],
  };
}

function rateLimited(retryAfterSeconds: number): HubErrorAnswer {
  return { ...inputRefused(), error: "rate_limited", retryAfterSeconds };
}

type ForgetMethod = "forget_catalog" | "forget_capabilities" | "forget_org";

interface ValidCall {
  readonly orgId: string;
  readonly idempotencyKey: string;
  readonly request: ToolCatalogCallRequest;
}

function isHubCallOrigin(value: unknown): value is HubCallOrigin {
  return isString(value) && HUB_CALL_ORIGINS.some((origin) => origin === value);
}

/** The call that the tools build, or null for anything else. The input is checked later, with the description. */
function readCall(args: unknown): ValidCall | null {
  if (!isDynamicRecord(args) || !hasExactKeys(args, ["orgId", "body", "idempotencyKey"])) return null;
  const { orgId, body, idempotencyKey } = args;
  if (!isHubOrgId(orgId) || !isString(idempotencyKey) || !UUID.test(idempotencyKey)) return null;
  if (!isDynamicRecord(body) || !onlyKeys(body, CALL_FIELDS) || !isHubEndpointId(body.endpointId)) return null;
  if (!isHubCallOrigin(body.origin)) return null;
  const hasCost = body.maxCostMicros !== undefined;
  const hasConfirmation = body.confirmationId !== undefined;
  // The tools set both, after the person approved on the Hub, and never one alone.
  if (hasCost !== hasConfirmation) return null;
  if (hasCost && (!isNumber(body.maxCostMicros) || !Number.isSafeInteger(body.maxCostMicros) || body.maxCostMicros < 0))
    return null;
  if (hasConfirmation && !isHubConfirmationId(body.confirmationId)) return null;
  const read = readCallInput({
    endpointId: body.endpointId,
    ...(body.query === undefined ? {} : { query: body.query }),
    ...(body.body === undefined ? {} : { body: body.body }),
  });
  if ("refusal" in read) return null;
  return {
    orgId,
    idempotencyKey,
    request: {
      endpointId: read.input.endpointId,
      origin: body.origin,
      ...(read.input.query === undefined ? {} : { query: read.input.query }),
      ...(read.input.body === undefined ? {} : { body: read.input.body }),
      ...(isNumber(body.maxCostMicros) ? { maxCostMicros: body.maxCostMicros } : {}),
      ...(isString(body.confirmationId) ? { confirmationId: body.confirmationId } : {}),
    },
  };
}

export class HubDelegateHost {
  readonly #client: HubDelegateHostClient;
  readonly #write: (line: string) => boolean;
  readonly #warn: (message: string) => void;
  readonly #now: () => number;
  readonly #key: Buffer;
  readonly #snapshotCheckMs: number;
  readonly #abort = new AbortController();
  readonly #described = new Map<string, { readonly answer: ToolCatalogDescribeAnswer; readonly until: number }>();
  /** The cost approval ids that this host gave the child, with the time each one ends. The child may use no other. */
  readonly #issued = new Map<string, number>();
  readonly #requests: number[] = [];
  readonly #calls: number[] = [];
  #removeForgetListener: (() => void) | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastId = 0;
  #inFlight = 0;
  #strikes = 0;
  #closed = false;
  /** The snapshot that the child has now: the last one that an answer or a push carried. */
  #lastSnapshot = "";

  constructor(options: HubDelegateHostOptions) {
    this.#client = options.client;
    this.#write = options.write;
    this.#warn = options.warn ?? ((message) => logger.warn(message));
    this.#now = options.now ?? Date.now;
    this.#key = options.key ?? newDelegateKey();
    this.#snapshotCheckMs = options.snapshotCheckMs ?? SNAPSHOT_CHECK_MS;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Sends the hello line with the key of this start of the child, then keeps its snapshot current. */
  start(): void {
    if (this.#closed || this.#removeForgetListener) return;
    const snapshot = this.#snapshot();
    this.#lastSnapshot = JSON.stringify(snapshot);
    if (!this.#sendLine(formatHello(this.#key, snapshot))) return;
    // Deferred: the client calls this inside `forget`, before it stores the key of the new session.
    this.#removeForgetListener = this.#client.onForget(() => queueMicrotask(() => this.#pushSnapshot()));
    this.#timer = setInterval(() => this.#pushSnapshot(), this.#snapshotCheckMs);
    this.#timer.unref();
  }

  /** The child exited, the app stops it, or the person signed out of the app for good. Serves nothing after it. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    this.#removeForgetListener?.();
    this.#removeForgetListener = null;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#described.clear();
    this.#issued.clear();
  }

  /** One line of the child's standard output. Lines without the prefix are not ours and are ignored. */
  receive(line: string): void {
    if (this.#closed || !line.startsWith(HUB_DELEGATE_PREFIX)) return;
    const payload = openFrame(
      this.#key,
      "request",
      line.slice(HUB_DELEGATE_PREFIX.length),
      HUB_DELEGATE_LIMITS.requestChars,
    );
    const request = payload === null ? null : readRequest(payload);
    // The counter only grows: a line that repeats an earlier one has no use.
    if (!request || request.id <= this.#lastId) {
      this.#strike();
      return;
    }
    this.#lastId = request.id;
    if (!isHubDelegateMethod(request.method)) {
      this.#respond(request.id, refusedWire(404));
      this.#strike();
      return;
    }
    if (!this.#admit()) {
      this.#respond(request.id, refusedWire(429));
      return;
    }
    this.#inFlight += 1;
    void this.#serve(request).finally(() => {
      this.#inFlight -= 1;
    });
  }

  #strike(): void {
    this.#strikes += 1;
    if (this.#strikes < HUB_DELEGATE_LIMITS.strikes) return;
    this.#warn(
      "A local server sent too many requests that failed their check. The app stops serving its Hub requests.",
    );
    this.close();
  }

  #admit(): boolean {
    const now = this.#now();
    while (this.#requests.length > 0 && now - (this.#requests[0] ?? 0) > 60_000) this.#requests.shift();
    if (this.#inFlight >= HUB_DELEGATE_LIMITS.inFlight || this.#requests.length >= HUB_DELEGATE_LIMITS.perMinute)
      return false;
    this.#requests.push(now);
    return true;
  }

  #callRoom(): boolean {
    const now = this.#now();
    while (this.#calls.length > 0 && now - (this.#calls[0] ?? 0) > 3_600_000) this.#calls.shift();
    return this.#calls.length < HUB_DELEGATE_LIMITS.callsPerHour;
  }

  #snapshot(): HubDelegateSnapshot {
    const signedIn = this.#client.signedIn();
    const connectionIds = signedIn
      ? this.#client.knownConnectionIds().filter(isHubConnectionId).slice(0, HUB_DELEGATE_LIMITS.connectionIds)
      : [];
    return { signedIn, connectionIds };
  }

  #pushSnapshot(): void {
    if (this.#closed) return;
    const snapshot = this.#snapshot();
    const text = JSON.stringify(snapshot);
    if (text === this.#lastSnapshot) return;
    this.#lastSnapshot = text;
    this.#sendPayload(JSON.stringify({ type: "snapshot", snapshot }));
  }

  #sendPayload(payload: string): void {
    this.#sendLine(`${HUB_DELEGATE_PREFIX}${sealFrame(this.#key, "response", payload)}`);
  }

  /** False, and the host closed, when the child's input cannot be written. */
  #sendLine(line: string): boolean {
    let written = false;
    try {
      written = this.#write(line);
    } catch {
      written = false;
    }
    if (!written) this.close();
    return written;
  }

  #respond(id: number, wire: Wire): void {
    if (this.#closed) return;
    const snapshot = this.#snapshot();
    this.#lastSnapshot = JSON.stringify(snapshot);
    let payload = JSON.stringify({ id, ...wire, snapshot });
    if (payload.length > HUB_DELEGATE_LIMITS.responseChars)
      payload = JSON.stringify({ id, ...refusedWire(413), snapshot });
    this.#sendPayload(payload);
  }

  async #serve(request: HubDelegateRequest): Promise<void> {
    let wire: Wire;
    try {
      wire = await this.#run(request);
    } catch {
      // An interrupted wait (the host closed) or an error that no failure code names.
      wire = { ok: false, code: "offline" };
    }
    // A person who signed out while the request ran gets no answer of the old session.
    if (!this.#client.signedIn() && !isForget(request.method)) wire = { ok: false, code: "signed_out" };
    else this.#noteIssued(wire);
    this.#respond(request.id, wire);
  }

  /** A cost question gives the child the id of its approval: only that id may come back in a call. */
  #noteIssued(wire: Wire): void {
    if (!wire.ok || !isDynamicRecord(wire.value)) return;
    const { kind, confirmationId } = wire.value;
    if (kind !== "needs-person" || !isHubConfirmationId(confirmationId)) return;
    const now = this.#now();
    for (const [id, until] of this.#issued) if (until <= now) this.#issued.delete(id);
    this.#issued.set(confirmationId, now + ISSUED_MS);
    while (this.#issued.size > ISSUED_LIMIT) {
      const oldest = this.#issued.keys().next().value;
      if (oldest === undefined) break;
      this.#issued.delete(oldest);
    }
  }

  #wasIssued(confirmationId: string): boolean {
    return (this.#issued.get(confirmationId) ?? 0) > this.#now();
  }

  async #run(request: HubDelegateRequest): Promise<Wire> {
    const { method, args } = request;
    if (!isHubDelegateMethod(method)) return refusedWire(404);
    if (isForget(method)) return this.#forget(method, args);
    if (!this.#client.signedIn()) return { ok: false, code: "signed_out" };
    const operation = this.#operation(method, args);
    if (operation === null) {
      this.#strike();
      return refusedWire(400);
    }
    const bounded = operation.pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(HUB_DELEGATE_LIMITS.hostTimeoutMs),
        orElse: () => Effect.fail(new HubConnectionFailure({ code: "offline" })),
      }),
      Effect.map((value): Wire => ({ ok: true, value })),
      Effect.catch((failure) =>
        Effect.succeed<Wire>({
          ok: false,
          code: failure.code,
          ...(failure.status === undefined ? {} : { status: failure.status }),
          ...(failure.tokenError === undefined ? {} : { tokenError: failure.tokenError }),
        }),
      ),
    );
    return await Effect.runPromise(bounded, { signal: this.#abort.signal });
  }

  /** The notices that a cache of the app's own client is stale. They read no network. */
  #forget(method: ForgetMethod, args: unknown): Wire {
    if (method === "forget_org") {
      if (!isDynamicRecord(args) || !hasExactKeys(args, ["orgId"]) || !isHubOrgId(args.orgId)) {
        this.#strike();
        return refusedWire(400);
      }
      this.#client.forgetOrg(args.orgId);
    } else if (!emptyArgs(args)) {
      this.#strike();
      return refusedWire(400);
    } else if (method === "forget_catalog") this.#client.forgetCatalog();
    else this.#client.forgetCapabilities();
    return { ok: true, value: null };
  }

  /** The Hub operation for a request, or null when its arguments are not exactly what the tools send. */
  #operation(
    method: Exclude<HubDelegateMethod, ForgetMethod>,
    args: unknown,
  ): Effect.Effect<unknown, HubConnectionFailure> | null {
    switch (method) {
      // The app's client keeps these two for its own time; a child never asks for a fresh read.
      case "capabilities":
        return emptyArgs(args) ? this.#client.capabilities() : null;
      case "catalog":
        return emptyArgs(args) ? this.#client.catalog() : null;
      case "search": {
        if (!isDynamicRecord(args) || !hasExactKeys(args, ["orgId", "body"])) return null;
        const { orgId, body } = args;
        if (!isHubOrgId(orgId) || !isDynamicRecord(body) || !onlyKeys(body, SEARCH_FIELDS)) return null;
        const search = toolCatalogSearchRequest({ query: body.query, platform: body.platform, limit: body.limit });
        // The lock of the tools: no key, cookie or token leaves in a search text.
        if (!search || valueRule(search.query)) return null;
        return this.#client.search(orgId, search);
      }
      case "describe": {
        if (!isDynamicRecord(args) || !hasExactKeys(args, ["orgId", "endpointId"])) return null;
        const { orgId, endpointId } = args;
        return isHubOrgId(orgId) && isHubEndpointId(endpointId) ? this.#describe(orgId, endpointId) : null;
      }
      case "call": {
        const call = readCall(args);
        if (!call) return null;
        // The tools use the id that a cost question gave them, never another.
        const { confirmationId } = call.request;
        return confirmationId === undefined || this.#wasIssued(confirmationId) ? this.#call(call) : null;
      }
      case "confirmation": {
        if (!isDynamicRecord(args) || !hasExactKeys(args, ["orgId", "confirmationId"])) return null;
        const { orgId, confirmationId } = args;
        return isHubOrgId(orgId) && isHubConfirmationId(confirmationId) && this.#wasIssued(confirmationId)
          ? this.#client.confirmation(orgId, confirmationId)
          : null;
      }
    }
  }

  /** A description from the cache of 5 minutes, or from the Hub. The call check reads it too. */
  readonly #describe = Effect.fn("HubDelegateHost.describe")(function* (
    this: HubDelegateHost,
    orgId: string,
    endpointId: string,
  ): Effect.fn.Return<HubOperationOutcome<ToolCatalogDescribeAnswer>, HubConnectionFailure> {
    const key = `${orgId}\u0000${endpointId}`;
    const cached = this.#described.get(key);
    if (cached && cached.until > this.#now()) return { kind: "answer", answer: cached.answer };
    const outcome = yield* this.#client.describe(orgId, endpointId);
    if (outcome.kind === "answer") {
      this.#described.set(key, { answer: outcome.answer, until: this.#now() + HUB_DELEGATE_LIMITS.describeCacheMs });
      while (this.#described.size > HUB_DELEGATE_LIMITS.describeCache) {
        const oldest = this.#described.keys().next().value;
        if (oldest === undefined) break;
        this.#described.delete(oldest);
      }
    }
    return outcome;
  });

  readonly #call = Effect.fn("HubDelegateHost.call")(function* (this: HubDelegateHost, call: ValidCall) {
    const { orgId, request, idempotencyKey } = call;
    const described = yield* this.#describe(orgId, request.endpointId);
    if (described.kind !== "answer") return described;
    // The same closed schema, credential and URL checks as the child's tools, against the Hub's own description.
    const { query, body } = request;
    const refused = checkCallInput(
      {
        endpointId: request.endpointId,
        ...(query === undefined ? {} : { query }),
        ...(body === undefined ? {} : { body }),
      },
      described.answer,
    );
    if (refused) return inputRefused();
    if (!this.#callRoom()) return rateLimited(60);
    this.#calls.push(this.#now());
    return yield* this.#client.call(orgId, request, idempotencyKey);
  });
}

function isForget(method: string): method is ForgetMethod {
  return method === "forget_catalog" || method === "forget_capabilities" || method === "forget_org";
}
