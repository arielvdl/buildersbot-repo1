import { describe, expect, test } from "vitest";
import { isPlatformHostname } from "../src/index";

describe("isPlatformHostname", () => {
  test("the Hub and the RTX endpoint are platform hosts", () => {
    expect(isPlatformHostname("hub.culturabuilder.com")).toBe(true);
    expect(isPlatformHostname("LLM-RTX.culturabuilder.com")).toBe(true);
  });
  test("a published site is not", () => {
    expect(isPlatformHostname("meu-site.culturabuilder.com")).toBe(false);
  });
  test("extra hosts come from PASSTHROUGH_HOSTNAMES", () => {
    expect(isPlatformHostname("api.culturabuilder.com", "api.culturabuilder.com, x.culturabuilder.com")).toBe(true);
    expect(isPlatformHostname("api.culturabuilder.com", "")).toBe(false);
  });
});
