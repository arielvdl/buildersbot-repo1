// @vitest-environment node

import type {
  HubConnectionCatalog,
  HubSessionConnections,
  ToolCatalogCallOutcome,
  ToolCatalogDescribeAnswer,
  ToolCatalogSearchAnswer,
} from "@buildersbot/contracts/hub-connections";
import type { DynamicRecord } from "@buildersbot/contracts/runtime-values";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { HubConnectionFailure } from "./hub-connection-client";
import { HubConnectionDelegate } from "./hub-delegate-client";
import { HubDelegateHost, type HubDelegateHostClient } from "./hub-delegate-host";
import {
  createLineReader,
  formatHello,
  HUB_DELEGATE_LIMITS,
  HUB_DELEGATE_PREFIX,
  openFrame,
  sealFrame,
} from "./hub-delegate-protocol";

const SESSION: HubSessionConnections = {
  active: true,
  connections: { "tool-catalog": { enabled: true, reason: null } },
  connectionsUsage: false,
};

const CATALOG: HubConnectionCatalog = {
  catalogVersion: "1",
  ttlSeconds: 60,
  orgs: [{ id: "org_a", name: "Org A", role: "member", default: true }],
  personal: false,
  connections: [],
};

const SEARCH: ToolCatalogSearchAnswer = { results: [], verdict: "none" };

const DESCRIBE: ToolCatalogDescribeAnswer = {
  endpointId: "company.enrich",
  title: "Company data by domain",
  summary: "Looks a company up by its domain.",
  method: "POST",
  query: null,
  body: {
    type: "object",
    properties: { domain: { type: "string", maxLength: 100 } },
    required: ["domain"],
    additionalProperties: false,
  },
  priceKind: "per_call",
  unitPriceMicros: 20_000,
  currency: "BRL",
  maxUnits: 1,
  maxCostMicros: 20_000,
  effect: "read",
  example: {},
  personalData: false,
};

const RESULT: ToolCatalogCallOutcome = {
  kind: "result",
  requestId: "req_1",
  endpointId: "company.enrich",
  servedBy: "treg",
  providerStatus: 200,
  orgId: "org_a",
  chargedMicros: 20_000,
  estimateMicros: 20_000,
  currency: "BRL",
  availableMicros: 1_000_000,
  effectiveAvailableMicros: 1_000_000,
  bindingScope: "org_total",
  state: "ok",
  warningCrossed: false,
  warnings: [],
  counterVersion: 1,
  asOf: "2026-11-04T12:00:00.000Z",
  signals: {},
  truncated: false,
  content: { name: "Example" },
};

const IDEMPOTENCY = "6f1c2e0a-3b6d-4d3a-9d7e-0a1b2c3d4e5f";
const CONFIRMATION = "abcdefghijklmnop0123456789";

interface Fake {
  signedIn: boolean;
  ids: string[];
  forgetListeners: Set<() => void>;
  client: HubDelegateHostClient;
  calls: { search: unknown[]; call: unknown[]; describe: unknown[] };
  spies: {
    forgetCatalog: ReturnType<typeof vi.fn>;
    forgetCapabilities: ReturnType<typeof vi.fn>;
    forgetOrg: ReturnType<typeof vi.fn>;
  };
}

function fakeClient(overrides: Partial<HubDelegateHostClient> = {}): Fake {
  const spies = { forgetCatalog: vi.fn(), forgetCapabilities: vi.fn(), forgetOrg: vi.fn() };
  const calls: Fake["calls"] = { search: [], call: [], describe: [] };
  const fake: Fake = {
    signedIn: true,
    ids: ["tool-catalog"],
    forgetListeners: new Set(),
    calls,
    spies,
    client: {
      signedIn: () => fake.signedIn,
      knownConnectionIds: () => fake.ids,
      capabilities: () => Effect.succeed(SESSION),
      catalog: () => Effect.succeed(CATALOG),
      search: (orgId, body) => {
        calls.search.push({ orgId, body });
        return Effect.succeed({ kind: "answer" as const, answer: SEARCH });
      },
      describe: (orgId, endpointId) => {
        calls.describe.push({ orgId, endpointId });
        return Effect.succeed({ kind: "answer" as const, answer: DESCRIBE });
      },
      call: (orgId, body, key) => {
        calls.call.push({ orgId, body, key });
        return Effect.succeed(RESULT);
      },
      confirmation: () =>
        Effect.succeed({
          kind: "answer" as const,
          answer: { confirmationId: CONFIRMATION, state: "pending" as const, expiresAt: "2026-11-04T12:05:00.000Z" },
        }),
      forgetCatalog: spies.forgetCatalog,
      forgetCapabilities: spies.forgetCapabilities,
      forgetOrg: spies.forgetOrg,
      onForget: (listener) => {
        fake.forgetListeners.add(listener);
        return () => fake.forgetListeners.delete(listener);
      },
      ...overrides,
    },
  };
  return fake;
}

/** A host and a delegate joined in memory, as the two pipes join the app and its child. */
function link(client: HubDelegateHostClient, options: { timeoutMs?: number; key?: Buffer } = {}) {
  const toChild: string[] = [];
  const toApp: string[] = [];
  const key = options.key ?? Buffer.alloc(32, 7);
  const warnings: string[] = [];
  const host: HubDelegateHost = new HubDelegateHost({
    client,
    key,
    warn: (message) => warnings.push(message),
    write: (line) => {
      toChild.push(line);
      queueMicrotask(() => delegate.receive(line));
      return true;
    },
  });
  const delegate: HubConnectionDelegate = new HubConnectionDelegate({
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    send: (line) => {
      toApp.push(line);
      queueMicrotask(() => host.receive(line));
      return true;
    },
  });
  host.start();
  return { host, delegate, toChild, toApp, key, warnings };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

/** A request line as the delegate would write it, with any id, method and arguments. */
function requestLine(key: Buffer, id: number, method: string, args: unknown): string {
  return `${HUB_DELEGATE_PREFIX}${sealFrame(key, "request", JSON.stringify({ id, method, args }))}`;
}

/** The answers that a raw host wrote, parsed. */
function answersOf(lines: string[], key: Buffer) {
  return lines
    .filter((line) => line.startsWith(HUB_DELEGATE_PREFIX))
    .map((line) => {
      const payload = openFrame(key, "response", line.slice(HUB_DELEGATE_PREFIX.length), 8 * 1024 * 1024);
      return payload === null ? null : JSON.parse(payload);
    });
}

function rawHost(client: HubDelegateHostClient) {
  const written: string[] = [];
  const key = Buffer.alloc(32, 3);
  const warnings: string[] = [];
  const host = new HubDelegateHost({
    client,
    key,
    warn: (message) => warnings.push(message),
    write: (line) => {
      written.push(line);
      return true;
    },
  });
  host.start();
  return { host, written, key, warnings };
}

describe("a local server asks the app for the Hub", () => {
  it("answers each operation with the app's client and keeps the snapshot current", async () => {
    const fake = fakeClient();
    const { delegate } = link(fake.client);
    await settle();
    expect(delegate.signedIn()).toBe(true);
    expect(delegate.knownConnectionIds()).toEqual(["tool-catalog"]);

    expect(await Effect.runPromise(delegate.capabilities())).toEqual(SESSION);
    expect(await Effect.runPromise(delegate.catalog())).toEqual(CATALOG);
    expect(await Effect.runPromise(delegate.search("org_a", { query: "company data", limit: 5 }))).toEqual({
      kind: "answer",
      answer: SEARCH,
    });
    expect(await Effect.runPromise(delegate.describe("org_a", "company.enrich"))).toEqual({
      kind: "answer",
      answer: DESCRIBE,
    });
    const called = await Effect.runPromise(
      delegate.call(
        "org_a",
        { endpointId: "company.enrich", origin: "owner_ui", body: { domain: "example.com" } },
        IDEMPOTENCY,
      ),
    );
    expect(called).toEqual(RESULT);
    expect(fake.calls.call).toEqual([
      {
        orgId: "org_a",
        body: { endpointId: "company.enrich", origin: "owner_ui", body: { domain: "example.com" } },
        key: IDEMPOTENCY,
      },
    ]);

    fake.ids = ["tool-catalog", "other-thing"];
    await Effect.runPromise(delegate.catalog());
    expect(delegate.knownConnectionIds()).toEqual(["tool-catalog", "other-thing"]);
  });

  it("passes a failure of the app's client as the same failure", async () => {
    const fake = fakeClient({
      catalog: () =>
        Effect.fail(new HubConnectionFailure({ code: "token_refused", status: 403, tokenError: "consent_required" })),
    });
    const { delegate } = link(fake.client);
    await settle();
    const failure = await Effect.runPromise(Effect.flip(delegate.catalog()));
    expect(failure).toBeInstanceOf(HubConnectionFailure);
    expect(failure).toMatchObject({ code: "token_refused", status: 403, tokenError: "consent_required" });
  });

  it("lets the app's caches know that the Hub changed, with no read", async () => {
    const fake = fakeClient();
    const { delegate } = link(fake.client);
    await settle();
    delegate.forgetCatalog();
    delegate.forgetCapabilities();
    delegate.forgetOrg("org_a");
    delegate.forgetOrg("not an org id!");
    await settle();
    expect(fake.spies.forgetCatalog).toHaveBeenCalledTimes(1);
    expect(fake.spies.forgetCapabilities).toHaveBeenCalledTimes(1);
    expect(fake.spies.forgetOrg).toHaveBeenCalledTimes(1);
    expect(fake.spies.forgetOrg).toHaveBeenCalledWith("org_a");
  });

  it("never serves usage or an access request, and sends nothing for them", async () => {
    const fake = fakeClient();
    const { delegate, toApp } = link(fake.client);
    await settle();
    const before = toApp.length;
    expect(await Effect.runPromise(Effect.flip(delegate.usage()))).toMatchObject({ code: "disabled" });
    expect(await Effect.runPromise(Effect.flip(delegate.requestAccess()))).toMatchObject({ code: "disabled" });
    expect(toApp.length).toBe(before);
  });

  it("carries no credential in either direction", async () => {
    const fake = fakeClient();
    const { delegate, toApp, toChild } = link(fake.client);
    await settle();
    await Effect.runPromise(delegate.catalog());
    await Effect.runPromise(
      delegate.call(
        "org_a",
        { endpointId: "company.enrich", origin: "agent", body: { domain: "example.com" } },
        IDEMPOTENCY,
      ),
    );
    const all = [...toApp, ...toChild].join("\n");
    // The messages have the known fields only: no session, no token, no refresh token, no Hub URL.
    expect(all).not.toMatch(/cbp_|refresh|access_token|authorization|bearer|culturabuilder/iu);
    for (const line of toApp) expect(line.startsWith(HUB_DELEGATE_PREFIX)).toBe(true);
  });
});

describe("what the app refuses from the child", () => {
  it("drops a line with a wrong mac, another direction, a repeated id, or a payload that is not a request", async () => {
    const fake = fakeClient();
    const { host, written, key } = rawHost(fake.client);
    const good = requestLine(key, 1, "catalog", {});
    host.receive(requestLine(Buffer.alloc(32, 9), 1, "catalog", {}));
    host.receive(
      `${HUB_DELEGATE_PREFIX}${sealFrame(key, "response", JSON.stringify({ id: 1, method: "catalog", args: {} }))}`,
    );
    host.receive(`${HUB_DELEGATE_PREFIX}not-a-frame`);
    host.receive(`${HUB_DELEGATE_PREFIX}${sealFrame(key, "request", "{not json")}`);
    host.receive(
      `${HUB_DELEGATE_PREFIX}${sealFrame(key, "request", JSON.stringify({ id: 1.5, method: "catalog", args: {} }))}`,
    );
    host.receive(
      `${HUB_DELEGATE_PREFIX}${sealFrame(key, "request", JSON.stringify({ id: 1, method: "catalog", args: {}, extra: 1 }))}`,
    );
    await settle();
    // Only the hello line was written: nothing of the above got an answer.
    expect(written).toHaveLength(1);
    host.receive(good);
    await settle();
    expect(answersOf(written, key)[0]).toMatchObject({ id: 1, ok: true });
    host.receive(good);
    await settle();
    expect(answersOf(written, key)).toHaveLength(1);
  });

  it("drops an oversized request, and the delegate does not send one", async () => {
    const fake = fakeClient();
    const { host, written, key } = rawHost(fake.client);
    host.receive(
      requestLine(key, 1, "search", { orgId: "org_a", body: { query: "x".repeat(HUB_DELEGATE_LIMITS.requestChars) } }),
    );
    await settle();
    expect(written).toHaveLength(1);
    expect(fake.calls.search).toEqual([]);

    const linked = link(fakeClient().client);
    await settle();
    const sent = linked.toApp.length;
    const failure = await Effect.runPromise(
      Effect.flip(
        linked.delegate.call(
          "org_a",
          {
            endpointId: "company.enrich",
            origin: "agent",
            body: { text: "y".repeat(HUB_DELEGATE_LIMITS.requestChars) },
          },
          IDEMPOTENCY,
        ),
      ),
    );
    expect(failure.code).toBe("offline");
    expect(linked.toApp.length).toBe(sent);
  });

  it("answers an unknown method with a refusal and serves nothing for it", async () => {
    const fake = fakeClient();
    const { host, written, key } = rawHost(fake.client);
    for (const [id, method] of [
      [1, "requestAccess"],
      [2, "usage"],
      [3, "forget"],
      [4, "constructor"],
    ] as const)
      host.receive(requestLine(key, id, method, {}));
    await settle();
    expect(answersOf(written, key)).toEqual([
      expect.objectContaining({ id: 1, ok: false, code: "hub_unavailable", status: 404 }),
      expect.objectContaining({ id: 2, ok: false, code: "hub_unavailable", status: 404 }),
      expect.objectContaining({ id: 3, ok: false, code: "hub_unavailable", status: 404 }),
      expect.objectContaining({ id: 4, ok: false, code: "hub_unavailable", status: 404 }),
    ]);
  });

  it("refuses arguments that the tools never send", async () => {
    const call = (body: DynamicRecord, idempotencyKey = IDEMPOTENCY) => ({
      orgId: "org_a",
      idempotencyKey,
      body: { endpointId: "company.enrich", origin: "agent", ...body },
    });
    const cases: Array<readonly [string, unknown]> = [
      ["catalog", { fresh: true }],
      ["capabilities", null],
      ["search", { orgId: "org_a", body: { query: "Bearer abcdefghijklmnopqrstuvwxyz0123456789" } }],
      ["search", { orgId: "org_a", body: { query: "ok words", extra: 1 } }],
      ["search", { orgId: "bad id!", body: { query: "ok words" } }],
      ["describe", { orgId: "org_a", endpointId: "https://evil.example/x" }],
      ["confirmation", { orgId: "org_a", confirmationId: "short" }],
      ["call", call({ origin: "admin" })],
      ["call", call({}, "not-a-uuid")],
      ["call", call({ url: "http://x" })],
      // A cost ceiling without the id of an approval, and the reverse.
      ["call", call({ maxCostMicros: 5 })],
      ["call", call({ confirmationId: CONFIRMATION })],
      ["forget_org", { orgId: "bad id!" }],
    ];
    const fake = fakeClient();
    // Each group stays under the strikes that end the service, and under the requests in flight.
    for (let from = 0; from < cases.length; from += 6) {
      const { host, written, key } = rawHost(fake.client);
      const group = cases.slice(from, from + 6);
      for (const [index, [method, args]] of group.entries()) host.receive(requestLine(key, index + 1, method, args));
      await settle();
      const answers = answersOf(written, key);
      expect(answers).toHaveLength(group.length);
      for (const answer of answers) expect(answer).toMatchObject({ ok: false, code: "hub_unavailable", status: 400 });
    }
    expect(fake.calls).toEqual({ search: [], call: [], describe: [] });
    expect(fake.spies.forgetOrg).not.toHaveBeenCalled();
  });

  it("lets the child use only the approval id that a cost question gave it", async () => {
    const asked: ToolCatalogCallOutcome = {
      kind: "needs-person",
      needsPerson: "confirm_cost",
      reason: null,
      currency: "BRL",
      estimateMicros: 400_000,
      confirmationId: CONFIRMATION,
      expiresAt: "2026-11-04T12:05:00.000Z",
      availableMicros: null,
      effectiveAvailableMicros: null,
      neededMicros: null,
      bindingScope: null,
      resetsAt: null,
    };
    const fake = fakeClient({
      call: (orgId, body, key) => {
        fake.calls.call.push({ orgId, body, key });
        return Effect.succeed(body.confirmationId === undefined ? asked : RESULT);
      },
    });
    const { delegate } = link(fake.client);
    await settle();
    const confirmed = {
      endpointId: "company.enrich",
      origin: "owner_ui",
      body: { domain: "example.com" },
      confirmationId: CONFIRMATION,
      maxCostMicros: 400_000,
    } as const;
    // An id that no cost question gave: no call, no status read.
    expect(await Effect.runPromise(Effect.flip(delegate.call("org_a", confirmed, IDEMPOTENCY)))).toMatchObject({
      status: 400,
    });
    expect(await Effect.runPromise(Effect.flip(delegate.confirmation("org_a", CONFIRMATION)))).toMatchObject({
      status: 400,
    });
    expect(fake.calls.call).toEqual([]);

    const { confirmationId: _id, maxCostMicros: _cost, ...plain } = confirmed;
    expect(await Effect.runPromise(delegate.call("org_a", plain, IDEMPOTENCY))).toEqual(asked);
    expect(await Effect.runPromise(delegate.call("org_a", confirmed, IDEMPOTENCY))).toEqual(RESULT);
    expect(await Effect.runPromise(delegate.confirmation("org_a", CONFIRMATION))).toMatchObject({ kind: "answer" });
  });

  it("checks a call input against the endpoint's own description, as the child's tools do", async () => {
    const fake = fakeClient();
    const { host, written, key } = rawHost(fake.client);
    const call = (id: number, extra: DynamicRecord) =>
      host.receive(
        requestLine(key, id, "call", {
          orgId: "org_a",
          idempotencyKey: IDEMPOTENCY,
          body: { endpointId: "company.enrich", origin: "agent", ...extra },
        }),
      );
    call(1, { body: { domain: "example.com" } });
    call(2, { body: { domain: "example.com", surprise: true } });
    call(3, { body: { domain: "http://10.0.0.1/admin" } });
    call(4, { body: { domain: "example.com", api_key: "x" } });
    call(5, { body: {} });
    await settle();
    const answers = answersOf(written, key);
    expect(answers[0]).toMatchObject({ id: 1, ok: true, value: { kind: "result" } });
    for (const answer of answers.slice(1))
      expect(answer).toMatchObject({ ok: true, value: { kind: "error", error: "input_refused" } });
    expect(fake.calls.call).toHaveLength(1);
    // The description was read once and kept.
    expect(fake.calls.describe).toHaveLength(1);
  });

  it("keeps the app's own hourly limit of paid calls for a child", async () => {
    let now = 1_000_000;
    const fake = fakeClient();
    const written: string[] = [];
    const key = Buffer.alloc(32, 3);
    const host = new HubDelegateHost({
      client: fake.client,
      key,
      now: () => now,
      write: (line) => {
        written.push(line);
        return true;
      },
    });
    host.start();
    for (let id = 1; id <= HUB_DELEGATE_LIMITS.callsPerHour + 1; id += 1) {
      host.receive(
        requestLine(key, id, "call", {
          orgId: "org_a",
          idempotencyKey: IDEMPOTENCY,
          body: { endpointId: "company.enrich", origin: "agent", body: { domain: "example.com" } },
        }),
      );
      // Each minute holds fewer requests than its limit.
      if (id % 100 === 0) now += 61_000;
      await settle();
    }
    expect(fake.calls.call).toHaveLength(HUB_DELEGATE_LIMITS.callsPerHour);
    expect(answersOf(written, key).at(-1)).toMatchObject({ ok: true, value: { kind: "error", error: "rate_limited" } });
  });

  it("limits the requests in flight and in a minute", async () => {
    const gate = Promise.withResolvers<void>();
    const fake = fakeClient({ catalog: () => Effect.promise(() => gate.promise).pipe(Effect.as(CATALOG)) });
    const { host, written, key } = rawHost(fake.client);
    for (let id = 1; id <= HUB_DELEGATE_LIMITS.inFlight + 2; id += 1) host.receive(requestLine(key, id, "catalog", {}));
    await settle();
    const refused = answersOf(written, key).filter((answer) => answer?.status === 429);
    expect(refused.map((answer) => answer.id)).toEqual([
      HUB_DELEGATE_LIMITS.inFlight + 1,
      HUB_DELEGATE_LIMITS.inFlight + 2,
    ]);
    gate.resolve();
    await settle();
    expect(answersOf(written, key).filter((answer) => answer?.ok === true)).toHaveLength(HUB_DELEGATE_LIMITS.inFlight);
  });

  it("stops serving a child that keeps sending lines that fail their check", async () => {
    const fake = fakeClient();
    const { host, written, key, warnings } = rawHost(fake.client);
    for (let index = 0; index < HUB_DELEGATE_LIMITS.strikes; index += 1) host.receive(`${HUB_DELEGATE_PREFIX}garbage`);
    expect(host.closed).toBe(true);
    expect(warnings).toHaveLength(1);
    const lines = written.length;
    host.receive(requestLine(key, 1, "catalog", {}));
    await settle();
    expect(written).toHaveLength(lines);
  });
});

describe("the person signs out, or the child ends", () => {
  it("answers signed out and reads nothing from the Hub while the person is signed out", async () => {
    const catalog = vi.fn(() => Effect.succeed(CATALOG));
    const fake = fakeClient({ catalog });
    const { delegate } = link(fake.client);
    await settle();
    expect(delegate.signedIn()).toBe(true);

    fake.signedIn = false;
    fake.ids = [];
    // The app's client tells the host at the sign-out, and the host pushes the snapshot.
    for (const listener of fake.forgetListeners) listener();
    await settle();
    expect(delegate.signedIn()).toBe(false);
    expect(delegate.knownConnectionIds()).toEqual([]);

    expect(await Effect.runPromise(Effect.flip(delegate.catalog()))).toMatchObject({ code: "signed_out" });
    expect(await Effect.runPromise(Effect.flip(delegate.search("org_a", { query: "company data" })))).toMatchObject({
      code: "signed_out",
    });
    expect(catalog).not.toHaveBeenCalled();
    expect(fake.calls.search).toEqual([]);

    // The next sign-in serves again with no restart of the child.
    fake.signedIn = true;
    fake.ids = ["tool-catalog"];
    for (const listener of fake.forgetListeners) listener();
    await settle();
    expect(delegate.signedIn()).toBe(true);
    expect(await Effect.runPromise(delegate.catalog())).toEqual(CATALOG);
  });

  it("gives no answer of an old session to a request that a sign-out passed", async () => {
    const gate = Promise.withResolvers<void>();
    const fake = fakeClient({ catalog: () => Effect.promise(() => gate.promise).pipe(Effect.as(CATALOG)) });
    const { delegate } = link(fake.client);
    await settle();
    const pending = Effect.runPromise(Effect.flip(delegate.catalog()));
    await settle();
    fake.signedIn = false;
    gate.resolve();
    expect(await pending).toMatchObject({ code: "signed_out" });
  });

  it("stops serving when the child exits: no answer, no write, no listener left", async () => {
    const gate = Promise.withResolvers<void>();
    const fake = fakeClient({ catalog: () => Effect.promise(() => gate.promise).pipe(Effect.as(CATALOG)) });
    const { host, written, key } = rawHost(fake.client);
    host.receive(requestLine(key, 1, "catalog", {}));
    await settle();
    host.close();
    gate.resolve();
    await settle();
    host.receive(requestLine(key, 2, "catalog", {}));
    await settle();
    expect(written).toHaveLength(1);
    expect(fake.forgetListeners.size).toBe(0);
  });

  it("closes when the child's input cannot be written", () => {
    const fake = fakeClient();
    const host = new HubDelegateHost({ client: fake.client, write: () => false });
    host.start();
    expect(host.closed).toBe(true);
  });

  it("fails every wait of the child with offline when the app ends the channel, or does not answer", async () => {
    const lines: string[] = [];
    const delegate = new HubConnectionDelegate({
      send: (line) => {
        lines.push(line);
        return true;
      },
      timeoutMs: 20,
    });
    const key = Buffer.alloc(32, 5);
    delegate.receive(formatHello(key, { signedIn: true, connectionIds: ["tool-catalog"] }));
    expect(delegate.signedIn()).toBe(true);
    // No answer in time.
    expect(await Effect.runPromise(Effect.flip(delegate.catalog()))).toMatchObject({ code: "offline" });
    // The app ends the channel while a request waits.
    const waiting = Effect.runPromise(Effect.flip(delegate.catalog()));
    delegate.close();
    expect(await waiting).toMatchObject({ code: "offline" });
    expect(delegate.signedIn()).toBe(false);
    expect(await Effect.runPromise(Effect.flip(delegate.catalog()))).toMatchObject({ code: "offline" });
  });
});

describe("the child's side of the channel", () => {
  it("asks nothing before the hello, and takes the key only once", async () => {
    const lines: string[] = [];
    const delegate = new HubConnectionDelegate({
      send: (line) => {
        lines.push(line);
        return true;
      },
      timeoutMs: 10,
    });
    expect(await Effect.runPromise(Effect.flip(delegate.catalog()))).toMatchObject({ code: "offline" });
    expect(lines).toEqual([]);

    const key = Buffer.alloc(32, 5);
    delegate.receive(formatHello(key, { signedIn: true, connectionIds: [] }));
    // A second hello cannot replace the key or the snapshot.
    delegate.receive(formatHello(Buffer.alloc(32, 6), { signedIn: false, connectionIds: [] }));
    expect(delegate.signedIn()).toBe(true);
    void Effect.runPromise(Effect.ignore(delegate.catalog()));
    expect(lines).toHaveLength(1);
    const sent = lines[0] ?? "";
    expect(openFrame(key, "request", sent.slice(HUB_DELEGATE_PREFIX.length), 1_000_000)).toContain(
      '"method":"catalog"',
    );
  });

  it("ignores an answer or a snapshot that it cannot verify", () => {
    const delegate = new HubConnectionDelegate({ send: () => true });
    const key = Buffer.alloc(32, 5);
    delegate.receive(formatHello(key, { signedIn: false, connectionIds: [] }));
    const forged = (payload: DynamicRecord, withKey: Buffer) =>
      `${HUB_DELEGATE_PREFIX}${sealFrame(withKey, "response", JSON.stringify(payload))}`;
    const snapshot = { type: "snapshot", snapshot: { signedIn: true, connectionIds: ["tool-catalog"] } };
    delegate.receive(forged(snapshot, Buffer.alloc(32, 1)));
    // A request-direction frame does not pass as an answer.
    delegate.receive(`${HUB_DELEGATE_PREFIX}${sealFrame(key, "request", JSON.stringify(snapshot))}`);
    expect(delegate.signedIn()).toBe(false);
    delegate.receive(forged(snapshot, key));
    expect(delegate.signedIn()).toBe(true);
    delegate.receive(forged({ type: "snapshot", snapshot: { signedIn: true, connectionIds: ["Bad Id"] } }, key));
    expect(delegate.knownConnectionIds()).toEqual(["tool-catalog"]);
  });
});

describe("lines on the pipes", () => {
  it("splits lines, joins pieces, and drops a line past the limit without keeping it", () => {
    const lines: string[] = [];
    let oversize = 0;
    const reader = createLineReader(
      10,
      (line) => lines.push(line),
      () => (oversize += 1),
    );
    reader.push("one\ntw");
    reader.push("o\r\nthree");
    reader.push("\n");
    expect(lines).toEqual(["one", "two", "three"]);
    reader.push("x".repeat(25));
    reader.push("y".repeat(25));
    reader.push("z\nok\n");
    expect(oversize).toBe(1);
    expect(lines.at(-1)).toBe("ok");
    reader.push("0123456789ABC\nfine\n");
    expect(oversize).toBe(2);
    expect(lines.at(-1)).toBe("fine");
  });
});
