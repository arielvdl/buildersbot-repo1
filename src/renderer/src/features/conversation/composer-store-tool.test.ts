import type { HubEndpointHit } from "@buildersbot/contracts/ipc";
import {
  isStoreQuery,
  STORE_PLATFORM_PATTERN,
  STORE_TOOL_PATTERN,
  storePlatformText,
  storeTilePlatformId,
  storeToolText,
  storeToolTitle,
} from "@buildersbot/ui/features/conversation/composer-store-tool";
import { describe, expect, it } from "vitest";

const HIT: HubEndpointHit = {
  endpointId: "company.enrich",
  title: "Company data by domain",
  platform: "apollo",
  provider: "treg",
  priceKind: "per_call",
  unitPriceMicros: 20_000,
  currency: "BRL",
  maxCostMicros: 20_000,
};

describe("the text of a store tool in the draft", () => {
  it("leaves the connection, the title and the endpoint id in the draft for the agent", () => {
    expect(storeToolText(HIT)).toBe("[tool-catalog: Company data by domain (company.enrich)]");
  });
});

describe("the words that may go to the store's search", () => {
  it("accepts words and refuses a price, a path, a short text and a code", () => {
    expect(isStoreQuery("empresa")).toBe(true);
    expect(isStoreQuery("dados de empresa")).toBe(true);
    expect(isStoreQuery("5 for lunch")).toBe(false);
    expect(isStoreQuery("usr/bin/env")).toBe(false);
    expect(isStoreQuery("ab")).toBe(false);
    expect(isStoreQuery("https://x.com")).toBe(false);
  });
});

describe("the title of a store tool in the draft", () => {
  it("drops brackets and line breaks so the text reads back as the same tool", () => {
    expect(storeToolTitle("Company [beta]\n data")).toBe("Company beta data");
    expect(storeToolText({ title: "A [x] b", endpointId: "a.b" })).toBe("[tool-catalog: A x b (a.b)]");
    expect(Array.from("[tool-catalog: A x b (a.b)]".matchAll(STORE_TOOL_PATTERN))[0]?.[2]).toBe("a.b");
  });
});

describe("a whole platform of the store in the draft", () => {
  it("leaves the platform name and its slug in the draft, apart from a single tool", () => {
    const text = storePlatformText({ name: "YouTube [beta]", platformId: "youtube" });
    expect(text).toBe("[tool-catalog platform: YouTube beta (youtube)]");
    expect(text.match(STORE_PLATFORM_PATTERN)).toEqual([text]);
    expect(text.match(STORE_TOOL_PATTERN)).toBeNull();
  });

  it("reads the platform id of a tile, and refuses a tile with none", () => {
    expect(storeTilePlatformId("tool-catalog:youtube")).toBe("youtube");
    expect(storeTilePlatformId("tool-catalog")).toBeNull();
    expect(storeTilePlatformId("tool-catalog:Bad Slug")).toBeNull();
  });
});
