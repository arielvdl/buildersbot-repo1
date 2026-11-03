// @vitest-environment node

import type {
  HubConnectionAccess,
  HubConnectionCatalog,
  ToolCatalogSearchAnswer,
} from "@buildersbot/contracts/hub-connections";
import { isHubEndpointSearchView, parseHubEndpointSearchInput } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type HubConnectionClient, HubConnectionFailure } from "./hub-connection-client";
import { HubConnectionTools } from "./hub-connection-tools";

const ROW: HubConnectionAccess = {
  orgId: "org_a",
  org: "enabled",
  user: "allowed",
  consented: true,
  currency: "BRL",
  cap: { kind: "limited", amountMicros: 25_000_000 },
  settledMicros: 0,
  reservedMicros: 0,
  availableMicros: 25_000_000,
  effectiveAvailableMicros: 25_000_000,
  bindingScope: "org_total",
  state: "ok",
  maxCostPerCallMicros: 1_000_000,
  confirmAboveMicros: null,
  resetsAt: "2026-12-01T00:00:00.000Z",
  asOf: "2026-11-03T12:00:00.000Z",
  counterVersion: 1,
  categories: [],
  priceFromMicros: null,
  requestedAt: null,
  moreRequestedAt: null,
};

function catalogOf(access: HubConnectionAccess[]): HubConnectionCatalog {
  return {
    catalogVersion: "1",
    ttlSeconds: 60,
    orgs: [{ id: "org_a", name: "Empresa A", role: "member", default: true }],
    personal: false,
    connections: [
      {
        id: "tool-catalog",
        name: "Tool catalog",
        tagline: "",
        description: "",
        operations: [],
        itemsCount: 1,
        dataPolicy: { vendor: "treg", region: "us", retentionDays: null },
        access,
        platforms: [],
      },
    ],
  };
}

const ANSWER: ToolCatalogSearchAnswer = {
  verdict: "match",
  results: [
    {
      endpointId: "company.enrich",
      title: "Company data by domain",
      platform: "apollo",
      provider: "treg",
      priceKind: "per_call",
      unitPriceMicros: 20_000,
      currency: "BRL",
      maxUnits: 1,
      maxCostMicros: 20_000,
      reliability: 0.9,
      effect: "read",
    },
  ],
};

function toolsWith(options: {
  access?: HubConnectionAccess[];
  signedIn?: boolean;
  searchFails?: boolean;
  searches?: unknown[];
}) {
  const client = {
    signedIn: () => options.signedIn ?? true,
    knownConnectionIds: () => [],
    forget: () => undefined,
    forgetCatalog: () => undefined,
    forgetCapabilities: () => undefined,
    catalog: () => Effect.succeed(catalogOf(options.access ?? [ROW])),
    search: (_org: string, body: unknown) => {
      options.searches?.push(body);
      return options.searchFails
        ? Effect.fail(new HubConnectionFailure({ code: "offline" }))
        : Effect.succeed({ kind: "answer" as const, answer: ANSWER });
    },
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: a stub of the client with only the methods that a search reads.
  } as unknown as HubConnectionClient;
  return new HubConnectionTools({ client });
}

const run = (tools: HubConnectionTools, query: string) =>
  Effect.runPromise(tools.searchEndpoints({ connectionId: "tool-catalog", query }));

describe("searchEndpoints", () => {
  it("gives the tools that fit, with the price of one unit", async () => {
    const searches: unknown[] = [];
    const view = await run(toolsWith({ searches }), "company data");
    expect(view.status).toBe("ready");
    expect(view.results).toEqual([
      expect.objectContaining({
        endpointId: "company.enrich",
        title: "Company data by domain",
        unitPriceMicros: 20_000,
      }),
    ]);
    expect(searches).toEqual([{ query: "company data", limit: 10 }]);
    expect(isHubEndpointSearchView(view)).toBe(true);
  });

  it("sends nothing for an empty text or a text with a secret", async () => {
    const searches: unknown[] = [];
    const tools = toolsWith({ searches });
    expect((await run(tools, "   ")).status).toBe("refused");
    expect((await run(tools, "Bearer abcdefghijklmnopqrstuvwxyz0123456789")).status).toBe("refused");
    expect(searches).toEqual([]);
  });

  it("says signed out and needs payer without searching", async () => {
    const searches: unknown[] = [];
    expect((await run(toolsWith({ signedIn: false, searches }), "x")).status).toBe("signed_out");
    expect((await run(toolsWith({ access: [{ ...ROW, consented: false }], searches }), "x")).status).toBe(
      "needs_payer",
    );
    expect(searches).toEqual([]);
  });

  it("asks the person to choose when several organizations can pay", async () => {
    const searches: unknown[] = [];
    const view = await run(toolsWith({ access: [ROW, { ...ROW, orgId: "org_b" }], searches }), "x");
    expect(view.status).toBe("needs_payer");
    expect(searches).toEqual([]);
  });

  it("is a status, not an error, when the Hub does not answer", async () => {
    expect((await run(toolsWith({ searchFails: true }), "x")).status).toBe("unavailable");
  });

  it("allows 40 searches a minute", async () => {
    const tools = toolsWith({});
    for (let index = 0; index < 40; index += 1) expect((await run(tools, `q${index}`)).status).toBe("ready");
    expect((await run(tools, "one more")).status).toBe("unavailable");
  });
});

describe("parseHubEndpointSearchInput", () => {
  it("keeps the known fields and refuses the rest", () => {
    expect(parseHubEndpointSearchInput({ connectionId: "tool-catalog", query: "seo", platform: "ahrefs" })).toEqual({
      connectionId: "tool-catalog",
      query: "seo",
      platform: "ahrefs",
    });
    expect(() => parseHubEndpointSearchInput({ connectionId: "tool-catalog", query: 5 })).toThrow();
    expect(() => parseHubEndpointSearchInput({ connectionId: "tool-catalog", query: "x", platform: "A B" })).toThrow();
  });
});
