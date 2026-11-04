import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createBuildersBotLogger, toLogValue } from "@buildersbot/logging";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { redactWazapText } from "./wazap-cli";

const logger = createBuildersBotLogger("shared-mcp");

/** What it takes to start the process that serves every agent: the line that one agent would start. */
export interface SharedMcpLaunch {
  command: string;
  args: readonly string[];
  /** The environment of the line (`mcpLaunchEnvironment`), the egress variables included. */
  environment: Readonly<Record<string, string>>;
}

/** Where the owner answers, and the credential of its own sessions. Held in memory, never logged. */
export interface SharedMcpAddress {
  port: number;
  token: string;
  pid: number;
  /** The process was already running and was not started here, so it is never stopped here. */
  adopted: boolean;
}

export interface SharedMcpOwnerOptions {
  /** The folder where the server keeps `server.lock` and `daemon.json`. */
  dataDirectory: string;
  launch(): SharedMcpLaunch;
  /** The process that this class started ended, whatever the reason. */
  onDown?: () => void;
  /** Whether a running process that this class did not start may be adopted. False with the egress proxy on. */
  adoptForeign?: () => boolean;
  /** How long a start waits for the sidecar and the health check. */
  startTimeoutMs?: number;
}

const START_TIMEOUT_MS = 15_000;
const BACKOFF_MS = [1_000, 2_000, 5_000] as const;
const MAX_STARTS_PER_MINUTE = 3;
const STOP_GRACE_MS = 3_000;
const HEALTH_TIMEOUT_MS = 2_000;
/** The versions of the server that the host was written and tested against. */
const SUPPORTED_VERSION = /^1\.6\./u;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists and belongs to another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function lockHolder(dataDirectory: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(join(dataDirectory, "server.lock"), "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

interface Sidecar {
  pid: number;
  port: number;
  token: string;
  version: string;
}

/** The sidecar the owner writes, when it is the file of a process that only this user can read. */
function readSidecar(dataDirectory: string): Sidecar | null {
  const file = join(dataDirectory, "daemon.json");
  try {
    // Mode 0600: a credential that other users can read is not one to trust or to use.
    if ((statSync(file).mode & 0o077) !== 0) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const { pid, port, token, version } = parsed ?? {};
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65_535) return null;
    if (typeof token !== "string" || token === "" || typeof version !== "string") return null;
    return { pid, port, token, version };
  } catch {
    return null;
  }
}

async function healthy(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    // `/healthz` answers 503 while no account is linked: the process still shares its session.
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: controller.signal, redirect: "error" });
    const body = await response.json();
    return typeof body === "object" && body !== null && typeof body.status === "string";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one process that serves the sessions of every agent for one shared server (`wazap`): finds the
 * one that runs, adopts it, or starts it, and starts it again when it falls. It never starts a second
 * process on the same folder (the server itself refuses that: `server.lock`), never stops one that it did
 * not start, and never writes in the folder of the server. What it starts runs as the stdio server of
 * this app, with its input held open and never written: the server ends when the app does.
 */
export class SharedMcpOwner {
  readonly #options: SharedMcpOwnerOptions;
  #child: ChildProcess | null = null;
  #address: SharedMcpAddress | null = null;
  #starting: Promise<SharedMcpAddress> | null = null;
  #starts: number[] = [];

  constructor(options: SharedMcpOwnerOptions) {
    this.#options = options;
  }

  get ownsProcess(): boolean {
    return this.#child !== null;
  }

  /**
   * Whether the server can be served now: nothing runs on the folder (this class starts it), the
   * process that this class started runs, or a running one that may be adopted.
   */
  async canServe(): Promise<boolean> {
    const holder = lockHolder(this.#options.dataDirectory);
    if (holder === null || holder === this.#child?.pid) return true;
    return (await this.#adoptable(holder)) !== null;
  }

  /** The address of a healthy process, started or adopted here if needed. Calls at the same time share one start. */
  ensure(): Promise<SharedMcpAddress> {
    const known = this.#address;
    if (known && alive(known.pid)) return Promise.resolve(known);
    this.#address = null;
    this.#starting ??= this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  /** The caller could not reach the process: forget its address, so the next `ensure` checks it again. */
  invalidate(): void {
    this.#address = null;
  }

  /** Ends the process that this class started, and only that one. */
  async stop(): Promise<void> {
    const child = this.#child;
    this.#address = null;
    if (!child) return;
    this.#child = null;
    const ended = new Promise<void>((done) => child.once("exit", () => done()));
    child.stdin?.end();
    const killer = setTimeout(() => child.kill("SIGTERM"), STOP_GRACE_MS / 2);
    const hard = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
    await ended.finally(() => {
      clearTimeout(killer);
      clearTimeout(hard);
    });
  }

  async #adoptable(holder: number): Promise<Sidecar | null> {
    if (holder !== this.#child?.pid && this.#options.adoptForeign && !this.#options.adoptForeign()) return null;
    const sidecar = readSidecar(this.#options.dataDirectory);
    if (!sidecar || sidecar.pid !== holder || !SUPPORTED_VERSION.test(sidecar.version)) return null;
    // The process that this class started is trusted by its pid; a busy one can be slow to answer a health check.
    if (holder === this.#child?.pid) return sidecar;
    return (await healthy(sidecar.port)) ? sidecar : null;
  }

  async #start(): Promise<SharedMcpAddress> {
    const holder = lockHolder(this.#options.dataDirectory);
    if (holder !== null) {
      const sidecar = await this.#adoptable(holder);
      if (!sidecar) throw new Error("The tool server runs and cannot be shared.");
      const address = {
        port: sidecar.port,
        token: sidecar.token,
        pid: sidecar.pid,
        adopted: holder !== this.#child?.pid,
      };
      this.#address = address;
      return address;
    }
    const now = Date.now();
    this.#starts = this.#starts.filter((at) => now - at < 60_000);
    if (this.#starts.length >= MAX_STARTS_PER_MINUTE)
      throw new Error("The tool server fell too many times in a minute.");
    // A start soon after a fall waits a little more each time.
    const wait = BACKOFF_MS[Math.min(this.#starts.length, BACKOFF_MS.length - 1)] ?? 0;
    if (this.#starts.length > 0) await sleep(wait);
    this.#starts.push(Date.now());
    const launch = this.#options.launch();
    const child = spawn(launch.command, [...launch.args], {
      env: { ...getDefaultEnvironment(), ...launch.environment },
      // Input held open and never written; output has no reader.
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = redactWazapText(chunk.toString("utf8")).trim();
      if (text) logger.info("The shared tool server wrote.", { text: text.slice(-300) });
    });
    child.once("error", (error) => logger.warn("The shared tool server did not start.", { error: toLogValue(error) }));
    child.once("exit", (code, signal) => {
      if (this.#child === child) {
        this.#child = null;
        this.#address = null;
        logger.warn("The shared tool server ended.", { code, signal });
        this.#options.onDown?.();
      }
    });
    const deadline = Date.now() + (this.#options.startTimeoutMs ?? START_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (this.#child !== child) throw new Error("The tool server ended while it started.");
      const sidecar = readSidecar(this.#options.dataDirectory);
      if (sidecar && sidecar.pid === child.pid && (await healthy(sidecar.port))) {
        const address = { port: sidecar.port, token: sidecar.token, pid: sidecar.pid, adopted: false };
        this.#address = address;
        return address;
      }
      await sleep(100);
    }
    await this.stop();
    throw new Error("The tool server did not become ready.");
  }
}
