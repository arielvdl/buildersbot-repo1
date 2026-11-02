import { describe, expect, it } from "vitest";
import { parseDeepLink } from "./deep-link-router";

// A link of each kind, under the scheme of this build and the one of an installation made before the
// rename. Both open the app, because `index.ts` registers both schemes, so both have to be read.
describe("parseDeepLink", () => {
  it("reads an invitation under either scheme", () => {
    const link =
      "join?server=6f1d3a58-4c2b-4b7e-9a1d-2e3f4a5b6c7d&invite=token_0123456789abcdefghijklmnopqrs&fingerprint=fingerprint_0123456789abcdefghijklmnop&api=https%3A%2F%2Fbuildersbot.culturabuilder.com";
    expect(parseDeepLink(`buildersbot://${link}`)?.kind).toBe("invite");
    expect(parseDeepLink(`buildersbot://${link}`)?.kind).toBe("invite");
  });

  it("reads the MCP sign-in return under either scheme", () => {
    const link = "mcp-auth?code=code-1&state=state-1";
    expect(parseDeepLink(`buildersbot://${link}`)).toEqual({ kind: "mcp-auth", state: "state-1", code: "code-1" });
    expect(parseDeepLink(`buildersbot://${link}`)).toEqual({ kind: "mcp-auth", state: "state-1", code: "code-1" });
  });

  it("reads the Slack and Discord install returns under either scheme", () => {
    const slack = "slack-workspace?nonce=nonce-1&grant=grant-1";
    const discord = "discord-guild?nonce=nonce-1&grant=grant-1";
    expect(parseDeepLink(`buildersbot://${slack}`)).toEqual({
      kind: "slack-workspace",
      nonce: "nonce-1",
      grant: "grant-1",
    });
    expect(parseDeepLink(`buildersbot://${slack}`)).toEqual({
      kind: "slack-workspace",
      nonce: "nonce-1",
      grant: "grant-1",
    });
    expect(parseDeepLink(`buildersbot://${discord}`)).toEqual({
      kind: "discord-guild",
      nonce: "nonce-1",
      grant: "grant-1",
    });
    expect(parseDeepLink(`buildersbot://${discord}`)).toEqual({
      kind: "discord-guild",
      nonce: "nonce-1",
      grant: "grant-1",
    });
  });

  it("reads the Connect button of the extension's welcome page", () => {
    expect(parseDeepLink("buildersbot://browser/connect")).toEqual({ kind: "chrome-connect" });
    expect(parseDeepLink("buildersbot://browser/other")).toBeNull();
  });

  it("drops the return legs when the nonce or the grant is missing", () => {
    expect(parseDeepLink("buildersbot://mcp-auth?state=state-1")).toBeNull();
    expect(parseDeepLink("buildersbot://slack-workspace?grant=grant-1")).toBeNull();
    expect(parseDeepLink("buildersbot://discord-guild?nonce=nonce-1")).toBeNull();
  });

  it("drops an argument that is not a link of any kind", () => {
    expect(parseDeepLink("--enable-logging")).toBeNull();
    expect(parseDeepLink("buildersbot://unknown?code=code-1")).toBeNull();
  });
});
