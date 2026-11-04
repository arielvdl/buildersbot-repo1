import { ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ServerSummary } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HUB_DELEGATE_LIMITS, HUB_DELEGATE_PREFIX } from "../../backend/hub-connections/hub-delegate-protocol";
import { formatLocalServerReady } from "../local-server-child";
import type { LocalServerAttachInput } from "../remote-server-manager";
import { LOCAL_SERVERS_FILE } from "./local-server-registry";
import { type HubConnectionsHost, LocalServers } from "./local-servers";

const READY = {
  serverId: "server-on-this-computer",
  serverName: "Design studio",
  apiUrl: "http://127.0.0.1:45123",
  fingerprint: "fingerprint-1",
  publicKey: "public-key-1",
};

/** A child with pipes that the test holds: it reads what the app writes, and writes what a child would. */
class PipedChild extends ChildProcess {
  readonly toChild = new PassThrough();
  readonly fromChild = new PassThrough();
  readonly received: string[] = [];

  constructor() {
    super();
    this.stdin = this.toChild;
    this.stdout = this.fromChild;
    this.stderr = new PassThrough();
    this.toChild.setEncoding("utf8");
    this.toChild.on("data", (chunk: string) => this.received.push(chunk));
    // A child ends when its input closes.
    this.toChild.once("end", () => setImmediate(() => this.emit("exit", 0, null)));
    setImmediate(() => this.fromChild.write(`${formatLocalServerReady(READY)}\n`));
  }

  override kill(signal?: NodeJS.Signals | number): boolean {
    setImmediate(() => this.emit("exit", null, typeof signal === "string" ? signal : null));
    return true;
  }
}

/** The host of the app, as `LocalServers` sees it: it records what the app hands it. */
class RecordingHost implements HubConnectionsHost {
  readonly lines: string[] = [];
  readonly events: string[] = [];
  constructor(readonly write: (line: string) => boolean) {}
  start(): void {
    this.events.push("start");
    this.write("hello-line");
  }
  receive(line: string): void {
    this.lines.push(line);
  }
  close(): void {
    this.events.push("close");
  }
}

function summary(input: LocalServerAttachInput): ServerSummary {
  return {
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    id: input.serverId,
    kind: "remote",
    apiUrl: READY.apiUrl,
    remoteDesktopAvailable: false,
    logoUrl: null,
    name: READY.serverName,
    role: "owner",
    state: "online",
    active: input.select,
    thisComputer: true,
  };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buildersbot-local-servers-hub-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function servers(children: PipedChild[], hosts: RecordingHost[], serve: boolean): LocalServers {
  return new LocalServers({
    registryPath: join(root, LOCAL_SERVERS_FILE),
    userDataRoot: join(root, "local-servers"),
    agentRoot: join(root, "Builders Bot", "Servers"),
    runtimeRoot: join(root, "provider-runtimes"),
    cipher: {
      encrypt: (value) => Buffer.from(`sealed:${value}`).reverse(),
      decrypt: (value) => Buffer.from(value).reverse().toString().slice("sealed:".length),
    },
    remoteServers: {
      setThisComputerServers: () => undefined,
      attachLocalServer: (input) => Effect.succeed(summary(input)),
      detachLocalServer: () => Effect.void,
    },
    command: { executable: "/Applications/Builders Bot.app/Contents/MacOS/Builders Bot", args: [] },
    trash: () => Promise.resolve(),
    log: { info: () => undefined, warn: () => undefined },
    platform: "darwin",
    spawn: (_command: string, _args: readonly string[], _options: SpawnOptions) => {
      const child = new PipedChild();
      children.push(child);
      return child;
    },
    ...(serve
      ? {
          serveHubConnections: (write: (line: string) => boolean) => {
            const host = new RecordingHost(write);
            hosts.push(host);
            return host;
          },
        }
      : {}),
  });
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe("the Hub requests of a server on this computer", () => {
  it("starts one host for the child, writes to its input, and hands it only the lines of the channel", async () => {
    const children: PipedChild[] = [];
    const hosts: RecordingHost[] = [];
    const local = servers(children, hosts, true);
    await Effect.runPromise(local.load());
    await Effect.runPromise(local.initialize());
    await Effect.runPromise(local.create(READY.serverName));

    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.events).toEqual(["start"]);
    const child = children[0];
    expect(child?.received.join("")).toBe("hello-line\n");

    const request = `${HUB_DELEGATE_PREFIX}mac payload`;
    child?.fromChild.write(`something else the child logs\n${request}\n`);
    // A line split over two writes joins, and a line past the limit is dropped whole.
    child?.fromChild.write(`${HUB_DELEGATE_PREFIX}spl`);
    child?.fromChild.write("it\n");
    child?.fromChild.write(`${HUB_DELEGATE_PREFIX}${"x".repeat(HUB_DELEGATE_LIMITS.parentLineChars)}\nlast line\n`);
    await settle();
    expect(hosts[0]?.lines).toEqual([request, `${HUB_DELEGATE_PREFIX}split`]);

    await Effect.runPromise(local.stop());
    // Closing twice is harmless: the host ignores the second.
    expect(hosts[0]?.events[0]).toBe("start");
    expect(hosts[0]?.events).toContain("close");
  });

  it("closes the host when the child exits, and hands it nothing after", async () => {
    const children: PipedChild[] = [];
    const hosts: RecordingHost[] = [];
    const local = servers(children, hosts, true);
    await Effect.runPromise(local.load());
    await Effect.runPromise(local.initialize());
    await Effect.runPromise(local.create(READY.serverName));
    const child = children[0];
    child?.emit("exit", 1, null);
    expect(hosts[0]?.events[0]).toBe("start");
    expect(hosts[0]?.events).toContain("close");
    child?.fromChild.write(`${HUB_DELEGATE_PREFIX}late\n`);
    await settle();
    expect(hosts[0]?.lines).toEqual([]);
    // The write of a host that outlived its child has nowhere to go.
    expect(hosts[0]?.write("after the exit")).toBe(true);
    child?.toChild.destroy();
    expect(hosts[0]?.write("after the pipe closed")).toBe(false);
    await Effect.runPromise(local.stop());
  });

  it("runs a child with no host when the app serves none", async () => {
    const children: PipedChild[] = [];
    const hosts: RecordingHost[] = [];
    const local = servers(children, hosts, false);
    await Effect.runPromise(local.load());
    await Effect.runPromise(local.initialize());
    await Effect.runPromise(local.create(READY.serverName));
    children[0]?.fromChild.write(`${HUB_DELEGATE_PREFIX}anything\n`);
    await settle();
    expect(hosts).toEqual([]);
    expect(children[0]?.received).toEqual([]);
    await Effect.runPromise(local.stop());
  });
});
