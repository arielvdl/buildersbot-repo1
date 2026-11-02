// @vitest-environment node
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createAgentTemplateShareUrl, parseAgentTemplateUrl } from "@buildersbot/contracts/agent-template-links";
import {
  BILLING_METADATA_LEGACY,
  billingLookupKeyLegacy,
  billingMetadataValue,
  parseBillingLookupKey,
} from "@buildersbot/contracts/billing";
import {
  FIRST_TOUCH_STORAGE_KEY,
  FIRST_TOUCH_STORAGE_KEY_LEGACY,
  readFirstTouch,
} from "@buildersbot/contracts/first-touch";
import { type HostKeyHandover, hostKeyHandoverStatements } from "@buildersbot/contracts/host-key-handover";
import { createBuildersBotInviteUrl, parseInviteUrl } from "@buildersbot/contracts/invite-links";
import {
  decodeExternalLinkTarget,
  isComputerUseMcpServerId,
  isGithubConnectorMcpServerId,
  readRemoteNetworkRoute,
} from "@buildersbot/contracts/ipc";
import {
  isLicenseProductId,
  LICENSE_METADATA_LEGACY,
  LICENSE_PRODUCT_ID_LEGACY,
  licenseLookupKeyLegacy,
  licenseMetadataValue,
  licensePlanFromPrice,
} from "@buildersbot/contracts/license";
import { createMobileConnectUrl, parseMobileConnectUrl } from "@buildersbot/contracts/mobile-connect";
import { notificationSound } from "@buildersbot/contracts/notification-relay";
import { createPluginShareUrl, parsePluginUrl } from "@buildersbot/contracts/plugin-links";
import { isDiscordCustomId, withoutDiscordCustomIdPrefix } from "@buildersbot/contracts/signal-protocol/discord-api";
import { pushNotificationSound } from "@buildersbot/contracts/team-protocol/push-notifications-v1";
import { followHostKeyHandovers, remoteHostFingerprint } from "@buildersbot/team-client/host-key-handover";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

// Failure modes: a value that a build made before the rename wrote is refused, so an invitation, a
// plugin or agent link, a QR code, a stored sound, route, link target, MCP id, first touch or Stripe
// metadata of an older installation stops working; a new value stops being built or written.
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

describe("links made before the rename", () => {
  it("reads the old custom scheme and still builds the new one", () => {
    const payload = { apiUrl: "https://api.openbot.run", serverId: SERVER_ID, fingerprint: SECRET, token: SECRET };
    const invite = new URL(createBuildersBotInviteUrl(payload));
    expect(invite.protocol).toBe("buildersbot:");
    const legacy = invite.toString().replace("buildersbot:", "openbot:");
    expect(parseInviteUrl(legacy).serverId).toBe(SERVER_ID);
  });

  it("reads a plugin link on the old scheme and on the old site", () => {
    expect(parsePluginUrl("openbot://plugins/demo")).toBe("demo");
    expect(parsePluginUrl(`${createPluginShareUrl("demo")}`)).toBe("demo");
    expect(parsePluginUrl("https://openbot.run/plugins/demo")).toBe("demo");
  });

  it("reads an agent link on the old scheme and on the old site", () => {
    const id = "A".repeat(22);
    expect(parseAgentTemplateUrl(`openbot://agents/${id}`)).toBe(id);
    expect(parseAgentTemplateUrl(createAgentTemplateShareUrl(id, "https://openbot.run"))).toBe(id);
  });

  it("reads a Mobile Connect code on the old scheme", () => {
    const url = createMobileConnectUrl({ apiUrl: "https://api.openbot.run", ticket: TICKET }).replace(
      "buildersbot:",
      "openbot:",
    );
    expect(parseMobileConnectUrl(url)?.ticket).toBe(TICKET);
  });

  it("reads a Discord button id with the old prefix", () => {
    expect(isDiscordCustomId("openbot:approve:token")).toBe(true);
    expect(withoutDiscordCustomIdPrefix("openbot:approve:token")).toBe("approve:token");
  });
});

describe("values stored before the rename", () => {
  it("reads the first touch under the old storage key and writes the new one", () => {
    const legacy = storageOf({ [FIRST_TOUCH_STORAGE_KEY_LEGACY]: JSON.stringify(TOUCH) });
    expect(readFirstTouch(legacy, Date.parse("2026-10-02T00:00:00Z"))).toEqual(TOUCH);
    expect(FIRST_TOUCH_STORAGE_KEY).not.toBe(FIRST_TOUCH_STORAGE_KEY_LEGACY);
  });

  it("reads the old default sound as its new name", () => {
    expect(notificationSound("openbot")).toBe("buildersbot");
    expect(pushNotificationSound("openbot")).toBe("buildersbot");
    expect(pushNotificationSound("none")).toBe("none");
  });

  it("reads the old network route and link target kind", () => {
    expect(readRemoteNetworkRoute("openbot")).toBe("buildersbot");
    expect(readRemoteNetworkRoute("private")).toBe("private");
    expect(decodeExternalLinkTarget({ kind: "openbot" })).toEqual({ kind: "buildersbot" });
  });

  it("reads the old MCP ids", () => {
    expect(isComputerUseMcpServerId("openbot-computer-use")).toBe(true);
    expect(isGithubConnectorMcpServerId("openbot-github")).toBe(true);
  });
});

describe("Stripe values written before the rename", () => {
  it("reads the old subscription metadata keys", () => {
    expect(billingMetadataValue({ openbot_user_id: "user" }, "userId")).toBe("user");
    expect(billingMetadataValue({ buildersbot_user_id: "new" }, "userId")).toBe("new");
    expect(BILLING_METADATA_LEGACY.userId).toBe("openbot_user_id");
  });

  it("reads the old plan and license lookup keys", () => {
    expect(parseBillingLookupKey(billingLookupKeyLegacy("pro", "year"))).toEqual({ plan: "pro", interval: "year" });
    expect(isLicenseProductId(LICENSE_PRODUCT_ID_LEGACY)).toBe(true);
    expect(
      licensePlanFromPrice({
        lookup_key: licenseLookupKeyLegacy({ tier: "starter", interval: "month", bundle: false }),
        metadata: {},
      }),
    ).toEqual({ tier: "starter", interval: "month", bundle: false });
  });

  it("reads the old license metadata keys", () => {
    expect(licenseMetadataValue({ [LICENSE_METADATA_LEGACY.tier]: "team" }, "tier")).toBe("team");
  });
});

describe("host key handover signed before the rename", () => {
  it("verifies a step that both old keys signed over the old statement", async () => {
    const previous = generateKeyPairSync("ed25519");
    const next = generateKeyPairSync("ed25519");
    const previousPublicKey = previous.publicKey.export({ type: "spki", format: "pem" }).toString();
    const publicKey = next.publicKey.export({ type: "spki", format: "pem" }).toString();
    const step = { hostId: "host-1", issuedAt: 1_700_000_000_000, previousPublicKey, publicKey };
    const [, legacyText] = hostKeyHandoverStatements(step);
    const bytes = new TextEncoder().encode(legacyText);
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
