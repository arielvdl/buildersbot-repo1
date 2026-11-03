import type { HubEndpointHit } from "@buildersbot/contracts/ipc";
import { storeToolText } from "@buildersbot/ui/features/conversation/composer-store-tool";
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
