// @vitest-environment node
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createAgentTemplateShareUrl, parseAgentTemplateUrl } from "@buildersbot/contracts/agent-template-links";
import {
  BILLING_METADATA,
  billingLookupKey,
  billingMetadataValue,
  parseBillingLookupKey,
} from "@buildersbot/contracts/billing";
import { FIRST_TOUCH_STORAGE_KEY, readFirstTouch } from "@buildersbot/contracts/first-touch";
import { type HostKeyHandover, hostKeyHandoverStatements } from "@buildersbot/contracts/host-key-handover";
import { createBuildersBotInviteUrl, parseInviteUrl } from "@buildersbot/contracts/invite-links";
import {
  decodeExternalLinkTarget,
  isComputerUseMcpServerId,
  isGithubConnectorMcpServerId,
  readRemoteNetworkRoute,
} from "@buildersbot/contracts/ipc";
import { createMobileConnectUrl, parseMobileConnectUrl } from "@buildersbot/contracts/mobile-connect";
import { notificationSound } from "@buildersbot/contracts/notification-relay";
import { createPluginShareUrl, parsePluginUrl } from "@buildersbot/contracts/plugin-links";
import { isDiscordCustomId, withoutDiscordCustomIdPrefix } from "@buildersbot/contracts/signal-protocol/discord-api";
import { pushNotificationSound } from "@buildersbot/contracts/team-protocol/push-notifications-v1";
import { followHostKeyHandovers, remoteHostFingerprint } from "@buildersbot/team-client/host-key-handover";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

// Round trips of the values this build makes: an invitation, a plugin or agent link, a QR code, a
// stored sound, route, link target, MCP id, first touch or Stripe metadata.
const TOUCH = {
  acquisitionSource: "search",
  sourcePlatform: "google",
  landingPage: "/pricing",
  firstVisitOn: "2026-10-01",
};
const SERVER_ID = "3f1c0b3e-6a1c-4b5d-8c9e-0a1b2c3d4e5f";
const SECRET = "A".repeat(43);
const TICKET = "T".repeat(43);

function storageOf(values: Readonly<Record<string, string>>) {
  return () => ({ getItem: (key: string) => values[key] ?? null });
}

describe("links", () => {
  it("builds and reads an invitation on the app scheme", () => {
    const payload = {
      apiUrl: "https://buildersbot.culturabuilder.com",
      serverId: SERVER_ID,
      fingerprint: SECRET,
      token: SECRET,
    };
    const invite = new URL(createBuildersBotInviteUrl(payload));
    expect(invite.protocol).toBe("buildersbot:");
    expect(parseInviteUrl(invite.toString()).serverId).toBe(SERVER_ID);
  });

  it("reads a plugin link on the site and on the custom scheme", () => {
    expect(parsePluginUrl("buildersbot://plugins/demo")).toBe("demo");
    expect(parsePluginUrl(`${createPluginShareUrl("demo")}`)).toBe("demo");
  });

  it("reads an agent link on the site and on the custom scheme", () => {
    const id = "A".repeat(22);
    expect(parseAgentTemplateUrl(`buildersbot://agents/${id}`)).toBe(id);
    expect(parseAgentTemplateUrl(createAgentTemplateShareUrl(id))).toBe(id);
  });

  it("round trips a Mobile Connect code", () => {
    const url = createMobileConnectUrl({ apiUrl: "https://buildersbot.culturabuilder.com", ticket: TICKET });
    expect(parseMobileConnectUrl(url)?.ticket).toBe(TICKET);
  });

  it("reads a Discord button id with the prefix", () => {
    expect(isDiscordCustomId("buildersbot:approve:token")).toBe(true);
    expect(withoutDiscordCustomIdPrefix("buildersbot:approve:token")).toBe("approve:token");
    expect(isDiscordCustomId("other:approve:token")).toBe(false);
  });
});

describe("stored values", () => {
  it("reads the first touch under the storage key and writes the same one", () => {
    const stored = storageOf({ [FIRST_TOUCH_STORAGE_KEY]: JSON.stringify(TOUCH) });
    expect(readFirstTouch(stored, Date.parse("2026-10-02T00:00:00Z"))).toEqual(TOUCH);
  });

  it("reads the default sound and pushes its own name", () => {
    expect(notificationSound("buildersbot")).toBe("buildersbot");
    expect(pushNotificationSound("buildersbot")).toBe("buildersbot");
    expect(pushNotificationSound("none")).toBe("none");
  });

  it("reads the network route and link target kind", () => {
    expect(readRemoteNetworkRoute("buildersbot")).toBe("buildersbot");
    expect(readRemoteNetworkRoute("private")).toBe("private");
    expect(decodeExternalLinkTarget({ kind: "buildersbot" })).toEqual({ kind: "buildersbot" });
    expect(decodeExternalLinkTarget({ kind: "default" })).toEqual({ kind: "default" });
  });

  it("reads the current MCP ids", () => {
    expect(isComputerUseMcpServerId("buildersbot-computer-use")).toBe(true);
    expect(isGithubConnectorMcpServerId("buildersbot-github")).toBe(true);
  });
});

describe("Stripe values", () => {
  it("reads the subscription metadata keys", () => {
    expect(billingMetadataValue({ buildersbot_user_id: "user" }, "userId")).toBe("user");
    expect(BILLING_METADATA.userId).toBe("buildersbot_user_id");
  });

  it("reads the plan and license lookup keys", () => {
    expect(parseBillingLookupKey(billingLookupKey("pro", "year"))).toEqual({ plan: "pro", interval: "year" });
  });
});

describe("host key handover", () => {
  it("verifies a step that both keys signed over the current statement", async () => {
    const previous = generateKeyPairSync("ed25519");
    const next = generateKeyPairSync("ed25519");
    const previousPublicKey = previous.publicKey.export({ type: "spki", format: "pem" }).toString();
    const publicKey = next.publicKey.export({ type: "spki", format: "pem" }).toString();
    const step = { hostId: "host-1", issuedAt: 1_700_000_000_000, previousPublicKey, publicKey };
    const [currentStatement] = hostKeyHandoverStatements(step);
    const bytes = new TextEncoder().encode(currentStatement);
    const handover: HostKeyHandover = {
      ...step,
      previousSignature: sign(null, bytes, previous.privateKey).toString("base64url"),
      signature: sign(null, bytes, next.privateKey).toString("base64url"),
    };
    const followed = await Effect.runPromise(
      followHostKeyHandovers({
        hostId: "host-1",
        trustedFingerprint: remoteHostFingerprint(previousPublicKey),
        advertisedPublicKey: publicKey,
        handovers: [handover],
        verify: (signature, message, key) =>
          Effect.sync(() => verify(null, message, key, Buffer.from(signature, "base64url"))),
      }),
    );
    expect(followed).toBe(true);
  });
});
