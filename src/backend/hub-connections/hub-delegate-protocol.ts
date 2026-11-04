// The private channel between the desktop app and the local server that it runs as its child process
// (docs/architecture/hub-connections.md, "Local servers"). The child has no Cultura Builder session, so
// its Hub client is a delegate: it sends each operation to the app, which holds the session and the
// one `HubConnectionClient`, and which answers with the decoded result.
//
// The channel is the pipes of the child: the child writes requests to its standard output, and the app
// writes answers to the child's standard input. One JSON message is one line:
//
//   child -> app   BUILDERSBOT_HUB_DELEGATE <mac> <request json>
//   app -> child   BUILDERSBOT_HUB_DELEGATE <mac> <answer or snapshot json>
//   app -> child   BUILDERSBOT_HUB_DELEGATE_HELLO <key> <json>    (the first line, once)
//
// `mac` is HMAC-SHA256 over the direction and the JSON text, with a key that the app makes for each
// start of the child and sends in the hello line. A process that is not the child, but holds its output
// file descriptor, cannot make a request that passes. No credential ever crosses the channel: not the
// session, not a proxy token, not the key of a vendor. The key above is a secret of the channel only.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isHubConnectionId } from "@buildersbot/contracts/hub-connections";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@buildersbot/contracts/runtime-values";

export const HUB_DELEGATE_PREFIX = "BUILDERSBOT_HUB_DELEGATE ";
const HUB_DELEGATE_HELLO_PREFIX = "BUILDERSBOT_HUB_DELEGATE_HELLO ";
const HUB_DELEGATE_VERSION = 1;

export const HUB_DELEGATE_LIMITS = {
  /** The most characters of a request line, after the prefix. A call input is at most 16 KB. */
  requestChars: 64 * 1024,
  /** The most characters of an answer line. A call answer holds at most 200,000 characters of content. */
  responseChars: 4 * 1024 * 1024,
  /** What a reader keeps of one line before it drops the line: the longest message plus its frame. */
  parentLineChars: 128 * 1024,
  childLineChars: 4 * 1024 * 1024 + 1024,
  /** The delegate gives up on an answer after this. Two Hub requests (25 s each) fit in it. */
  childTimeoutMs: 60_000,
  /** The app answers a request after this at the latest. */
  hostTimeoutMs: 55_000,
  inFlight: 8,
  perMinute: 240,
  /** The paid calls of one local server in an hour. The app's own tools keep the same limit. */
  callsPerHour: 200,
  describeCache: 64,
  describeCacheMs: 5 * 60_000,
  /** Lines that fail their check, before the app stops serving the child. */
  strikes: 10,
  connectionIds: 100,
} as const;

/** What the delegate may ask. Nothing else is served, and the answer to anything else is a refusal. */
const HUB_DELEGATE_METHODS = [
  "capabilities",
  "catalog",
  "search",
  "describe",
  "call",
  "confirmation",
  "forget_catalog",
  "forget_capabilities",
  "forget_org",
] as const;
export type HubDelegateMethod = (typeof HUB_DELEGATE_METHODS)[number];

export function isHubDelegateMethod(value: unknown): value is HubDelegateMethod {
  return isString(value) && HUB_DELEGATE_METHODS.some((method) => method === value);
}

/**
 * What the tools of the child read without waiting: whether the person is signed in, and the ids of
 * the connections of the last `/session` answer. The app pushes it, and each answer carries it.
 */
export interface HubDelegateSnapshot {
  readonly signedIn: boolean;
  readonly connectionIds: readonly string[];
}

export const EMPTY_SNAPSHOT: HubDelegateSnapshot = { signedIn: false, connectionIds: [] };

export function readSnapshot(value: unknown): HubDelegateSnapshot | null {
  if (!isDynamicRecord(value) || !isBoolean(value.signedIn) || !Array.isArray(value.connectionIds)) return null;
  if (value.connectionIds.length > HUB_DELEGATE_LIMITS.connectionIds) return null;
  const connectionIds: string[] = [];
  for (const id of value.connectionIds) {
    if (!isHubConnectionId(id)) return null;
    connectionIds.push(id);
  }
  return { signedIn: value.signedIn, connectionIds };
}

export type HubDelegateDirection = "request" | "response";

export function newDelegateKey(): Buffer {
  return randomBytes(32);
}

function mac(key: Buffer, direction: HubDelegateDirection, payload: string): Buffer {
  return createHmac("sha256", key).update(direction).update("\n").update(payload).digest();
}

/** `<mac> <payload>`, ready to follow `HUB_DELEGATE_PREFIX`. */
export function sealFrame(key: Buffer, direction: HubDelegateDirection, payload: string): string {
  return `${mac(key, direction, payload).toString("hex")} ${payload}`;
}

/** The payload of a frame whose mac fits, or null. A frame of another direction does not fit. */
export function openFrame(
  key: Buffer,
  direction: HubDelegateDirection,
  frame: string,
  maxChars: number,
): string | null {
  const split = frame.indexOf(" ");
  if (split !== 64) return null;
  const payload = frame.slice(split + 1);
  if (payload.length === 0 || payload.length > maxChars) return null;
  const given = Buffer.from(frame.slice(0, split), "hex");
  const expected = mac(key, direction, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return payload;
}

/** The request of the child: a counter that only grows, a method and its arguments. */
export interface HubDelegateRequest {
  readonly id: number;
  readonly method: string;
  readonly args: unknown;
}

export function readRequest(payload: string): HubDelegateRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.every((key) => key === "id" || key === "method" || key === "args")) return null;
  const { id, method, args } = value;
  if (!isNumber(id) || !Number.isSafeInteger(id) || id < 1 || !isString(method)) return null;
  return { id, method, args };
}

/**
 * The message with the hello line: the key of the channel and the first snapshot. Only the hello line
 * has no mac, because it brings the key.
 */
export function formatHello(key: Buffer, snapshot: HubDelegateSnapshot): string {
  return `${HUB_DELEGATE_HELLO_PREFIX}${key.toString("hex")} ${JSON.stringify({ v: HUB_DELEGATE_VERSION, snapshot })}`;
}

export function readHello(line: string): { key: Buffer; snapshot: HubDelegateSnapshot } | null {
  if (!line.startsWith(HUB_DELEGATE_HELLO_PREFIX)) return null;
  const rest = line.slice(HUB_DELEGATE_HELLO_PREFIX.length);
  if (rest.length > 4096 || rest.indexOf(" ") !== 64) return null;
  const hex = rest.slice(0, 64);
  if (!/^[0-9a-f]{64}$/u.test(hex)) return null;
  let value: unknown;
  try {
    value = JSON.parse(rest.slice(65));
  } catch {
    return null;
  }
  if (!isDynamicRecord(value) || value.v !== HUB_DELEGATE_VERSION) return null;
  const snapshot = readSnapshot(value.snapshot);
  return snapshot ? { key: Buffer.from(hex, "hex"), snapshot } : null;
}

/**
 * Splits a stream of text into lines and keeps at most `maxChars` of a line: a longer line is dropped
 * whole, so a process that never ends a line cannot fill the memory of the reader. `onOversize` runs
 * once for each dropped line.
 */
export function createLineReader(
  maxChars: number,
  onLine: (line: string) => void,
  onOversize?: () => void,
): { push(chunk: string): void } {
  let buffer = "";
  let dropping = false;
  return {
    push(chunk: string): void {
      let rest = chunk;
      for (;;) {
        const newline = rest.indexOf("\n");
        if (newline < 0) break;
        const piece = rest.slice(0, newline);
        rest = rest.slice(newline + 1);
        if (dropping) {
          dropping = false;
          buffer = "";
          onOversize?.();
          continue;
        }
        const line = buffer + piece;
        buffer = "";
        if (line.length > maxChars) {
          onOversize?.();
          continue;
        }
        onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      }
      if (dropping) return;
      if (buffer.length + rest.length > maxChars) {
        dropping = true;
        buffer = "";
        return;
      }
      buffer += rest;
    },
  };
}
