// Checks that the shared tool server host never runs a tool call twice (section 5.7 of specs/perf-memory.md).
// Runs the real `SharedMcpHost` and `SharedMcpOwner` against a stand-in server that speaks what the host needs
// of wazap: `server.lock`, `daemon.json`, `/healthz` and MCP over http with sessions. No wazap, no network, no
// account. The stand-in counts each `tools/call` that reaches it in a file, and its tool `die` ends the process in
// the middle of the call, as an owner that falls after it started the work.
//   1. The process dies in the middle of a `tools/call`: the call ran 1 time (never 2), the agent got an error,
//      and the next call of the agent works, with no new `initialize` of the agent.
//   2. A request with no effect (`tools/list`) that meets a dead process is repeated, and answers.
//   3. A session that the server does not know (the process was replaced) is a 404 before anything ran: a
//      `tools/call` is opened again and runs 1 time.
// `bun scripts/shared-mcp-retry-e2e.ts`. Writes .buildersbot-build/shared-mcp-retry-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SharedMcpHost } from "../src/main/shared-mcp-host";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/shared-mcp-retry-e2e");
type Fact = string | number | boolean | null | Fact[] | { [key: string]: Fact };
const report: { passed: boolean; error?: string; facts: { [key: string]: Fact } } = { passed: false, facts: {} };
const root = await mkdtemp(join(tmpdir(), "buildersbot-shared-mcp-retry-"));
const dataDirectory = join(root, "data");
mkdirSync(dataDirectory, { recursive: true });
const callsFile = join(root, "calls");
const diedFile = join(root, "died");
const droppedFile = join(root, "dropped");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const STAND_IN = `
const http = require("node:http");
const fs = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const dir = process.env.WAZAP_DATA_DIR;
const token = randomUUID() + randomUUID();
const sessions = new Set();
const count = (name) => fs.appendFileSync(${JSON.stringify(callsFile)}, name + "\\n");
const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") return send(res, 200, { status: "ok" });
  if (req.headers.authorization !== "Bearer " + token) return send(res, 401, {});
  if (req.method !== "POST") return send(res, 405, {});
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const message = JSON.parse(raw);
    const sid = req.headers["mcp-session-id"];
    if (message.method === "initialize") {
      const id = randomUUID(); sessions.add(id);
      return send(res, 200, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stand-in", version: "1.6.0" } } }, { "mcp-session-id": id });
    }
    if (!sid || !sessions.has(sid)) return send(res, 404, {});
    if (message.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (message.method === "tools/list") return send(res, 200, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "work", inputSchema: { type: "object" } }, { name: "die", inputSchema: { type: "object" } }, { name: "drop", inputSchema: { type: "object" } }] } });
    if (message.method === "tools/call") {
      count(message.params.name);
      // "drop": the work was done, and the connection is lost before the answer (a live server). "die": the process ends in the middle.
      if (message.params.name === "drop" && !fs.existsSync(${JSON.stringify(droppedFile)})) { fs.writeFileSync(${JSON.stringify(droppedFile)}, "1"); return req.socket.destroy(); }
      if (message.params.name === "die" && !fs.existsSync(${JSON.stringify(diedFile)})) { fs.writeFileSync(${JSON.stringify(diedFile)}, "1"); process.exit(1); }
      return send(res, 200, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "done" }] } });
    }
    send(res, 200, { jsonrpc: "2.0", id: message.id, result: {} });
  });
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.writeFileSync(join(dir, "server.lock"), process.pid + "\\n", { mode: 0o600 });
  fs.writeFileSync(join(dir, "daemon.json"), JSON.stringify({ pid: process.pid, port, token, version: "1.6.0" }), { mode: 0o600 });
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`;
const standInFile = join(root, "stand-in.js");
writeFileSync(standInFile, STAND_IN);

const executed = (name: string) => {
  try {
    return readFileSync(callsFile, "utf8")
      .split("\n")
      .filter((line) => line === name).length;
  } catch {
    return 0;
  }
};

function asTransport(inner: StreamableHTTPClientTransport): Transport {
  const transport: Transport = {
    start: () => inner.start(),
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion(version),
  };
  inner.onclose = () => transport.onclose?.();
  inner.onerror = (error) => transport.onerror?.(error);
  inner.onmessage = (...received: Parameters<NonNullable<Transport["onmessage"]>>) =>
    transport.onmessage?.(...received);
  return transport;
}

const host = new SharedMcpHost({ lineEnabled: () => true, adoptForeign: () => true, startTimeoutMs: 10_000 });
try {
  const route = await host.route({
    serverId: "stand-in",
    agentId: "agent-1",
    dataDirectory,
    launch: { command: process.execPath, args: [standInFile], environment: { WAZAP_DATA_DIR: dataDirectory } },
  });
  assert.ok(route, "the stand-in can be served");
  const inner = new StreamableHTTPClientTransport(new URL(route.url), {
    requestInit: { headers: { Authorization: `Bearer ${route.bearer}` } },
  });
  const client = new Client({ name: "agent-1", version: "0" });
  await client.connect(asTransport(inner));
  const sessionId = inner.sessionId;
  assert.equal((await client.callTool({ name: "work", arguments: {} })).isError, undefined, "a call works");
  assert.equal(executed("work"), 1);

  // 1a. The work is done and the connection is lost before the answer: the call is not repeated.
  const dropOutcome = await client.callTool({ name: "drop", arguments: {} }).then(
    () => "answered",
    (error: Error) => `error: ${error.message.slice(0, 80)}`,
  );
  report.facts.dropOutcome = dropOutcome;
  await sleep(300);
  assert.equal(executed("drop"), 1, "a call whose answer was lost ran 1 time, never 2");
  assert.ok(dropOutcome.startsWith("error"), "the agent got an error");
  assert.equal((await client.callTool({ name: "work", arguments: {} })).isError, undefined, "the next call works");
  assert.equal(inner.sessionId, sessionId, "the agent did not start a new session");
  assert.equal(executed("work"), 2);

  // 1b. The process dies in the middle of a tools/call.
  const outcome = await client.callTool({ name: "die", arguments: {} }).then(
    () => "answered",
    (error: Error) => `error: ${error.message.slice(0, 80)}`,
  );
  report.facts.dieOutcome = outcome;
  await sleep(300);
  assert.equal(executed("die"), 1, "the call ran 1 time, never 2");
  assert.ok(outcome.startsWith("error"), "the agent got an error, not a silent repeat");
  // The next call works, with the same session of the agent (no new initialize).
  const next = await client.callTool({ name: "work", arguments: {} });
  assert.equal(next.isError, undefined, "the next call works");
  assert.equal(inner.sessionId, sessionId, "the agent did not start a new session");
  assert.equal(executed("work"), 3);
  assert.equal(executed("die"), 1, "and `die` did not run again");

  // 2. No effect, dead process: repeated.
  const pid = Number(readFileSync(join(dataDirectory, "server.lock"), "utf8").trim());
  process.kill(pid, "SIGKILL");
  await sleep(300);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 3, "tools/list answers after the process died");

  // 3. A session that the new process does not know: 404 before anything ran, so a call opens it and runs once.
  const worked = await client.callTool({ name: "work", arguments: {} });
  assert.equal(worked.isError, undefined);
  assert.equal(executed("work"), 4, "each call ran exactly 1 time");
  report.facts.executions = { work: executed("work"), die: executed("die"), drop: executed("drop") };
  await client.close().catch(() => {});
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await host.stop();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.exit(process.exitCode ?? 0);
}
