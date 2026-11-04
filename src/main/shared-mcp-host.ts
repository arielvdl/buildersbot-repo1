import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createBuildersBotLogger, toLogValue } from "@buildersbot/logging";
import { mcpOAuthProxyAgentKey } from "../backend/mcp-oauth-proxy";
import { listenLoopback } from "./listen-loopback";
import { type SharedMcpAddress, type SharedMcpLaunch, SharedMcpOwner } from "./shared-mcp-owner";

const logger = createBuildersBotLogger("shared-mcp");

/** The numbers that bound the host. A test can lower them. */
export interface SharedMcpLimits {
  /** The largest request body. The server itself refuses more than 100 KiB. */
  bodyBytes: number;
  /** Requests at the same time for one agent. The server allows 8 operations for each session. */
  perAgent: number;
  /** Requests at the same time for all agents. The server allows 32 operations in the process. */
  total: number;
  /** A request that waits for its turn is refused after this long. */
  queueMs: number;
  /** Sessions open on the server at the same time. The server keeps 32 for each credential and drops the oldest. */
  upstreamSessions: number;
  /** A session with no request for this long is closed on the server and opens again on its next request. */
  idleSessionMs: number;
  /** The server stops (only when this app started it) after this long with no session and no request. */
  idleOwnerMs: number;
  /** The reaper runs this often. */
  sweepMs: number;
}

const LIMITS: SharedMcpLimits = {
  bodyBytes: 1024 * 1024,
  perAgent: 8,
  total: 32,
  queueMs: 60_000,
  upstreamSessions: 24,
  idleSessionMs: 10 * 60_000,
  idleOwnerMs: 30 * 60_000,
  sweepMs: 60_000,
};
/** The kept record of a session (its `initialize`) is dropped after this long with no request. */
const FORGET_SESSION_MS = 6 * 60 * 60_000;
const MAX_SESSION_RECORDS = 512;
/** The only headers of an agent's request that reach the server. */
const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "mcp-protocol-version", "last-event-id"] as const;
/** The only headers of the server's answer that reach the agent. */
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control", "mcp-protocol-version"] as const;
const ROUTE = /^\/mcp\/([a-f0-9]{16})\/([a-f0-9]{32})$/u;
const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface SharedMcpHostOptions {
  /** Whether the line is still enabled: read for each request, so a line turned off or removed stops at once. */
  lineEnabled(serverId: string): boolean;
  /** Whether a running server that this app did not start may be used. False with the egress proxy on. */
  adoptForeign(): boolean;
  limits?: Partial<SharedMcpLimits>;
  /** For a test: how long a start of the server may take. */
  startTimeoutMs?: number;
}

/** The line a hand-off asks to share. */
export interface SharedMcpLine {
  serverId: string;
  agentId: string;
  dataDirectory: string;
  launch: SharedMcpLaunch;
}

interface Session {
  id: string;
  serverKey: string;
  agentKey: string;
  dataDirectory: string;
  /** The `initialize` of the agent, kept so the session opens again on the server when it falls or is closed. */
  init: Buffer;
  protocolVersion: string;
  /** The session of the server, or `null` while it is closed (idle, evicted, or the server fell). */
  upstreamId: string | null;
  lastAt: number;
  inflight: number;
  opening: Promise<void> | null;
}

interface Line {
  serverId: string;
  dataDirectory: string;
}

function headerValue(headers: IncomingMessage["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function drain(response: IncomingMessage): Promise<void> {
  return new Promise((done) => {
    response.once("end", done);
    response.once("error", done);
    response.once("close", done);
    response.resume();
  });
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", () => resolve(null));
  });
}

/** The `id` of a JSON-RPC request, so an error can answer it; `null` when there is none. */
function rpcId(body: Buffer): string | number | null {
  try {
    const message = JSON.parse(body.toString("utf8"));
    return typeof message?.id === "string" || typeof message?.id === "number" ? message.id : null;
  } catch {
    return null;
  }
}

function initializeParams(body: Buffer): { protocolVersion: string } | null {
  try {
    const message = JSON.parse(body.toString("utf8"));
    if (message?.method !== "initialize") return null;
    const version = message.params?.protocolVersion;
    return { protocolVersion: typeof version === "string" ? version : "2025-06-18" };
  } catch {
    return null;
  }
}

/** The methods that have no effect on the server, so repeating them is safe. Everything else, tool calls first, is not. */
const REPEATABLE_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "prompts/list",
  "prompts/get",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "logging/setLevel",
]);

function isRepeatable(body: Buffer, httpMethod: string): boolean {
  if (httpMethod === "GET") return true;
  try {
    const message = JSON.parse(body.toString("utf8"));
    if (Array.isArray(message)) return false;
    const method = message?.method;
    return typeof method === "string" && (REPEATABLE_METHODS.has(method) || method.startsWith("notifications/"));
  } catch {
    return false;
  }
}

/** The connection was refused: the request did not reach the process, so it did nothing there. */
function wasRefused(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ECONNREFUSED";
}

function sendOnce(
  address: SharedMcpAddress,
  method: "POST" | "GET" | "DELETE",
  headers: Record<string, string>,
  body: Buffer | null,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: address.port,
        path: "/mcp",
        method,
        headers: {
          ...headers,
          host: `127.0.0.1:${address.port}`,
          authorization: `Bearer ${address.token}`,
          ...(body ? { "content-length": String(body.length) } : {}),
        },
      },
      resolve,
    );
    outgoing.once("error", reject);
    outgoing.end(body ?? undefined);
  });
}

/** How often, and for how long at most, a request waits when the server says that its budget is spent (429). */
const BUDGET_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * A request to the server. The server allows 240 POST a minute for the credential, shared by every agent as
 * it is today by the bridges: a 429 waits for the time that the server names (`Retry-After`) and asks again.
 */
async function sendUpstream(
  address: SharedMcpAddress,
  method: "POST" | "GET" | "DELETE",
  headers: Record<string, string>,
  body: Buffer | null,
): Promise<IncomingMessage> {
  for (let attempt = 0; ; attempt += 1) {
    const answer = await sendOnce(address, method, headers, body);
    if (answer.statusCode !== 429 || attempt >= BUDGET_RETRIES) return answer;
    const seconds = Number(headerValue(answer.headers, "retry-after"));
    await drain(answer);
    await new Promise<void>((done) =>
      setTimeout(done, Math.min(MAX_RETRY_AFTER_MS, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2_000)),
    );
  }
}

/**
 * One address on `127.0.0.1` through which every agent reaches one shared stdio server (`wazap`), in place
 * of a process for each agent. An agent gets a route of its own and a bearer for that route
 * (HMAC of the route with a secret that lives in memory only). The host hands the bytes of the agent's
 * MCP requests to the one process (`SharedMcpOwner`), with the credential of the process that the agent never
 * sees, and gives each agent a session of its own on the process, so what the server keeps for a
 * session (a draft, a mark) stays the agent's. The agent has an id of session that the host made up:
 * when the process falls or closes the session, the host opens a new one with the kept `initialize` and
 * repeats the request once, so the agent never sees it. See specs/perf-memory.md, section 5.4.2.
 *
 * Safety: only `127.0.0.1`, `Host` and `Origin` checked (DNS rebinding), 403 and never 401, only the
 * methods and headers that MCP needs, a bounded body, bounded requests and sessions.
 */
export class SharedMcpHost {
  readonly #options: SharedMcpHostOptions;
  readonly #limits: SharedMcpLimits;
  readonly #secret = randomBytes(32);
  #server: Server | null = null;
  #listening: Promise<number> | null = null;
  #port = 0;
  #sweeper: NodeJS.Timeout | null = null;
  readonly #lines = new Map<string, Line>();
  readonly #owners = new Map<string, SharedMcpOwner>();
  readonly #launches = new Map<string, SharedMcpLaunch>();
  readonly #sessions = new Map<string, Session>();
  readonly #inflightByAgent = new Map<string, number>();
  #inflight = 0;
  #waiters: { agentKey: string; grant: () => void; timer: NodeJS.Timeout }[] = [];
  #lastActivityAt = Date.now();

  constructor(options: SharedMcpHostOptions) {
    this.#options = options;
    this.#limits = { ...LIMITS, ...options.limits };
  }

  /** The address while the host listens, so a provider that keeps its configuration (Codex) notices a new one. */
  fingerprint(): string | null {
    return this.#port > 0 ? `shared-mcp:${this.#port}` : null;
  }

  /** The number of sessions open on the server, for a test. */
  get openUpstreamSessions(): number {
    return [...this.#sessions.values()].filter((session) => session.upstreamId !== null).length;
  }

  /** Whether the process of one folder was started here, for a test. */
  ownerOf(dataDirectory: string): SharedMcpOwner | undefined {
    return this.#owners.get(dataDirectory);
  }

  /**
   * The route and the bearer of one agent for one line, or `null` when the line cannot be shared now (the
   * caller then hands the line over as stdio, as before): a process runs on the folder that cannot be adopted.
   */
  async route(line: SharedMcpLine): Promise<{ url: string; bearer: string } | null> {
    this.#launches.set(line.dataDirectory, line.launch);
    let owner = this.#owners.get(line.dataDirectory);
    if (!owner) {
      const directory = line.dataDirectory;
      owner = new SharedMcpOwner({
        dataDirectory: directory,
        launch: () => this.#launches.get(directory) ?? line.launch,
        adoptForeign: () => this.#options.adoptForeign(),
        onDown: () => this.#ownerDown(directory),
        ...(this.#options.startTimeoutMs ? { startTimeoutMs: this.#options.startTimeoutMs } : {}),
      });
      this.#owners.set(directory, owner);
    }
    if (!(await owner.canServe())) return null;
    const port = await this.#listen();
    const serverKey = createHash("sha256").update(`server\u0000${line.serverId}`).digest("hex").slice(0, 16);
    this.#lines.set(serverKey, { serverId: line.serverId, dataDirectory: line.dataDirectory });
    const path = `/mcp/${serverKey}/${mcpOAuthProxyAgentKey(line.agentId)}`;
    return { url: `http://127.0.0.1:${port}${path}`, bearer: this.#bearer(path) };
  }

  async stop(): Promise<void> {
    if (this.#sweeper) clearInterval(this.#sweeper);
    this.#sweeper = null;
    const server = this.#server;
    this.#server = null;
    this.#listening = null;
    this.#port = 0;
    this.#sessions.clear();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
    await Promise.all([...this.#owners.values()].map((owner) => owner.stop()));
    this.#owners.clear();
  }

  #bearer(path: string): string {
    return createHmac("sha256", this.#secret).update(path).digest("base64url");
  }

  #authorized(path: string, header: string | undefined): boolean {
    const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
    const wanted = Buffer.from(this.#bearer(path));
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  #listen(): Promise<number> {
    this.#listening ??= (async () => {
      const server = createServer((request, response) => {
        void this.#handle(request, response).catch((error) => {
          logger.warn("A shared tool server request failed.", { error: toLogValue(error) });
          if (!response.headersSent) response.writeHead(500).end();
          else response.destroy();
        });
      });
      this.#port = await listenLoopback(server, () => new Error("The shared tool server has no port."));
      this.#server = server;
      this.#sweeper = setInterval(() => void this.#sweep(), this.#limits.sweepMs);
      this.#sweeper.unref();
      return this.#port;
    })();
    return this.#listening;
  }

  #ownerDown(dataDirectory: string): void {
    // Every session of that folder opens again on its next request.
    for (const session of this.#sessions.values())
      if (session.dataDirectory === dataDirectory) session.upstreamId = null;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "";
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      response.writeHead(405, { allow: "POST, GET, DELETE" }).end();
      return;
    }
    // DNS rebinding: the address that the browser or the client used must be this one.
    const host = headerValue(request.headers, "host") ?? "";
    if (host !== `127.0.0.1:${this.#port}` && host !== `localhost:${this.#port}`) {
      response.writeHead(403).end();
      return;
    }
    const origin = headerValue(request.headers, "origin");
    if (origin !== undefined) {
      let name = "";
      try {
        name = new URL(origin).hostname;
      } catch {
        // An origin that is not a URL is not loopback.
      }
      if (!LOOPBACK_NAMES.has(name) && !LOOPBACK_NAMES.has(`[${name}]`)) {
        response.writeHead(403).end();
        return;
      }
    }
    const path = (request.url ?? "").split("?")[0] ?? "";
    const match = ROUTE.exec(path);
    if (!match || !this.#authorized(path, headerValue(request.headers, "authorization"))) {
      response.writeHead(403).end();
      return;
    }
    const serverKey = match[1] ?? "";
    const agentKey = match[2] ?? "";
    const line = this.#lines.get(serverKey);
    const body = method === "POST" ? await readBody(request, this.#limits.bodyBytes) : Buffer.alloc(0);
    if (body === null) {
      response.writeHead(413).end();
      return;
    }
    const id = rpcId(body);
    if (!line) return this.#rpcError(response, id, "This tool server is not ready. It is after the next turn starts.");
    if (!this.#options.lineEnabled(line.serverId))
      return this.#rpcError(response, id, "This tool server was turned off or removed.");
    // The server answers a few operations at the same time (8 for each session, 32 in all): the rest wait their turn.
    // The stream of notifications (GET) stays open for as long as the agent runs: it takes no turn and does not hold its session.
    const stream = method === "GET";
    const release = stream ? () => {} : await this.#acquire(agentKey);
    if (!release) return this.#rpcError(response, id, "The tool server is busy. Try again in a moment.");
    this.#lastActivityAt = Date.now();
    let session: Session | undefined;
    try {
      const sessionId = headerValue(request.headers, "mcp-session-id");
      const init = method === "POST" && sessionId === undefined ? initializeParams(body) : null;
      if (init) {
        session = this.#newSession(serverKey, agentKey, line.dataDirectory, body, init.protocolVersion);
        session.inflight += 1;
        return await this.#answerInitialize(session, request, response, body);
      }
      session = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
      if (!session || session.agentKey !== agentKey || session.serverKey !== serverKey) {
        // The spec: an unknown session is a 404, and the client starts a new one.
        response.writeHead(404).end();
        return;
      }
      if (!stream) session.inflight += 1;
      session.lastAt = Date.now();
      if (method === "DELETE") return await this.#close(session, response);
      await this.#relay(session, method, request, response, body, id);
    } catch (error) {
      logger.warn("The shared tool server could not answer.", { error: toLogValue(error) });
      if (!response.headersSent)
        this.#rpcError(response, id, "The tool server is not available. Try again in a moment.");
      else response.destroy();
    } finally {
      if (session && !stream) session.inflight = Math.max(0, session.inflight - 1);
      release();
      this.#lastActivityAt = Date.now();
      this.#enforceLimit();
    }
  }

  #fits(agentKey: string): boolean {
    return (this.#inflightByAgent.get(agentKey) ?? 0) < this.#limits.perAgent && this.#inflight < this.#limits.total;
  }

  #take(agentKey: string): () => void {
    this.#inflight += 1;
    this.#inflightByAgent.set(agentKey, (this.#inflightByAgent.get(agentKey) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#inflight = Math.max(0, this.#inflight - 1);
      this.#inflightByAgent.set(agentKey, Math.max(0, (this.#inflightByAgent.get(agentKey) ?? 1) - 1));
      this.#wake();
    };
  }

  /** A turn at the server, or `null` when the request waited too long. */
  #acquire(agentKey: string): Promise<(() => void) | null> {
    if (this.#waiters.length === 0 && this.#fits(agentKey)) return Promise.resolve(this.#take(agentKey));
    return new Promise((resolve) => {
      const waiter = {
        agentKey,
        grant: () => {
          clearTimeout(waiter.timer);
          resolve(this.#take(agentKey));
        },
        timer: setTimeout(() => {
          this.#waiters = this.#waiters.filter((item) => item !== waiter);
          resolve(null);
        }, this.#limits.queueMs),
      };
      this.#waiters.push(waiter);
    });
  }

  #wake(): void {
    for (let index = 0; index < this.#waiters.length; ) {
      const waiter = this.#waiters[index];
      if (waiter && this.#fits(waiter.agentKey)) {
        this.#waiters.splice(index, 1);
        waiter.grant();
      } else index += 1;
    }
  }

  #rpcError(response: ServerResponse, id: string | number | null, message: string): void {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }));
  }

  #newSession(
    serverKey: string,
    agentKey: string,
    dataDirectory: string,
    init: Buffer,
    protocolVersion: string,
  ): Session {
    if (this.#sessions.size >= MAX_SESSION_RECORDS) {
      const oldest = [...this.#sessions.values()]
        .filter((item) => item.inflight === 0)
        .sort((a, b) => a.lastAt - b.lastAt)[0];
      if (oldest) this.#drop(oldest);
    }
    const session: Session = {
      id: randomUUID(),
      serverKey,
      agentKey,
      dataDirectory,
      init,
      protocolVersion,
      upstreamId: null,
      lastAt: Date.now(),
      inflight: 0,
      opening: null,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  #owner(session: Session): SharedMcpOwner {
    const owner = this.#owners.get(session.dataDirectory);
    if (!owner) throw new Error("The tool server has no owner.");
    return owner;
  }

  /** Makes room on the server: the least recently used sessions without a request close there and open again later. */
  #makeRoom(except: Session): void {
    const open = [...this.#sessions.values()].filter((item) => item.upstreamId !== null && item !== except);
    open.sort((a, b) => a.lastAt - b.lastAt);
    while (open.length >= this.#limits.upstreamSessions) {
      const victim = open.shift();
      if (!victim) return;
      if (victim.inflight > 0) continue;
      void this.#closeUpstream(victim);
    }
  }

  /**
   * The sessions that were opening together are counted only when they have opened: after each request, the
   * least recently used sessions without a request close on the server over the limit.
   */
  #enforceLimit(): void {
    const open = [...this.#sessions.values()].filter((item) => item.upstreamId !== null);
    if (open.length <= this.#limits.upstreamSessions) return;
    open.sort((a, b) => a.lastAt - b.lastAt);
    let excess = open.length - this.#limits.upstreamSessions;
    for (const victim of open) {
      if (excess <= 0) return;
      if (victim.inflight > 0) continue;
      excess -= 1;
      void this.#closeUpstream(victim);
    }
  }

  async #closeUpstream(session: Session): Promise<void> {
    const upstreamId = session.upstreamId;
    session.upstreamId = null;
    if (upstreamId === null) return;
    try {
      const address = await this.#owner(session).ensure();
      const answer = await sendUpstream(address, "DELETE", { "mcp-session-id": upstreamId }, null);
      await drain(answer);
    } catch {
      // The process is gone or answers no more: its sessions are gone with it.
    }
  }

  #drop(session: Session): void {
    this.#sessions.delete(session.id);
    void this.#closeUpstream(session);
  }

  /** Opens a session of the server for an agent that already has one on the host: its kept `initialize`, then `initialized`. */
  #reopen(session: Session): Promise<void> {
    session.opening ??= (async () => {
      this.#makeRoom(session);
      const address = await this.#owner(session).ensure();
      const answer = await sendUpstream(
        address,
        "POST",
        { "content-type": "application/json", accept: "application/json, text/event-stream" },
        session.init,
      );
      const upstreamId = headerValue(answer.headers, "mcp-session-id");
      await drain(answer);
      if ((answer.statusCode ?? 500) >= 400 || !upstreamId) {
        this.#owner(session).invalidate();
        throw new Error(`The tool server did not open a session (${answer.statusCode ?? 0}).`);
      }
      const noted = await sendUpstream(
        address,
        "POST",
        {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-session-id": upstreamId,
          "mcp-protocol-version": session.protocolVersion,
        },
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })),
      );
      await drain(noted);
      session.upstreamId = upstreamId;
    })().finally(() => {
      session.opening = null;
    });
    return session.opening;
  }

  async #answerInitialize(
    session: Session,
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
  ): Promise<void> {
    this.#makeRoom(session);
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = headerValue(request.headers, name);
      if (value !== undefined) headers[name] = value;
    }
    let answer: IncomingMessage | null = null;
    for (const attempt of [0, 1]) {
      try {
        const address = await this.#owner(session).ensure();
        answer = await sendUpstream(address, "POST", headers, body);
        const status = answer.statusCode ?? 500;
        if ((status === 401 || status === 403) && attempt === 0) {
          await drain(answer);
          this.#owner(session).invalidate();
          answer = null;
          continue;
        }
        break;
      } catch (error) {
        if (attempt === 1) throw error;
        this.#owner(session).invalidate();
      }
    }
    if (!answer) throw new Error("The tool server did not answer.");
    const upstreamId = headerValue(answer.headers, "mcp-session-id");
    if ((answer.statusCode ?? 500) < 400 && upstreamId) {
      session.upstreamId = upstreamId;
      this.#sessions.set(session.id, session);
    } else this.#sessions.delete(session.id);
    this.#pipe(answer, response, upstreamId ? { "mcp-session-id": session.id } : {});
    await new Promise<void>((done) => response.once("close", done));
  }

  async #relay(
    session: Session,
    method: string,
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    id: string | number | null,
  ): Promise<void> {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = headerValue(request.headers, name);
      if (value !== undefined) headers[name] = value;
    }
    let answer: IncomingMessage | null = null;
    // A request that may have reached the server and had an effect (a tool call: a message sent) is never
    // repeated after a transport error: the agent gets the error, and the next call opens the session again.
    const repeatable = isRepeatable(body, method);
    for (const attempt of [0, 1]) {
      let sent = false;
      try {
        if (session.upstreamId === null) await this.#reopen(session);
        const address = await this.#owner(session).ensure();
        sent = true;
        answer = await sendUpstream(
          address,
          method === "GET" ? "GET" : "POST",
          { ...headers, "mcp-session-id": session.upstreamId ?? "" },
          method === "GET" ? null : body,
        );
        const status = answer.statusCode ?? 500;
        // A session that the server does not know (it fell, or dropped the oldest), or a credential that
        // changed with a new process: open a new session and repeat once.
        if ((status === 404 || status === 401 || status === 403) && attempt === 0) {
          await drain(answer);
          answer = null;
          session.upstreamId = null;
          if (status !== 404) this.#owner(session).invalidate();
          continue;
        }
        break;
      } catch (error) {
        this.#owner(session).invalidate();
        session.upstreamId = null;
        // Repeated only when it cannot do twice what it did once: it was never sent (the session or the
        // process was not ready, or the connection was refused), or it has no effect.
        if (attempt === 1 || (sent && !repeatable && !wasRefused(error))) throw error;
      }
    }
    if (!answer) return this.#rpcError(response, id, "The tool server is not available. Try again in a moment.");
    this.#pipe(answer, response, {});
    await new Promise<void>((done) => response.once("close", done));
  }

  #pipe(answer: IncomingMessage, response: ServerResponse, extra: Record<string, string>): void {
    const headers: Record<string, string> = { ...extra };
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = headerValue(answer.headers, name);
      if (value !== undefined) headers[name] = value;
    }
    response.writeHead(answer.statusCode ?? 502, headers);
    // A client that goes away ends the answer that streams to it.
    response.once("close", () => answer.destroy());
    answer.pipe(response);
  }

  async #close(session: Session, response: ServerResponse): Promise<void> {
    this.#sessions.delete(session.id);
    await this.#closeUpstream(session);
    response.writeHead(200).end();
  }

  async #sweep(): Promise<void> {
    const now = Date.now();
    for (const session of [...this.#sessions.values()]) {
      if (session.inflight > 0) continue;
      if (now - session.lastAt > FORGET_SESSION_MS) this.#drop(session);
      else if (session.upstreamId !== null && now - session.lastAt > this.#limits.idleSessionMs)
        await this.#closeUpstream(session);
    }
    if (
      this.openUpstreamSessions === 0 &&
      this.#inflight === 0 &&
      now - this.#lastActivityAt > this.#limits.idleOwnerMs
    ) {
      for (const owner of this.#owners.values()) if (owner.ownsProcess) await owner.stop();
    }
  }
}
