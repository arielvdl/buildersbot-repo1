// Checks the shared tool server (switch `mcp-shared-host`, items of section 5.9 of specs/perf-memory.md).
// Runs the real `SharedMcpHost`, the real `SharedMcpOwner` and the real wazap 1.6.0 program from the cache of
// npx, on a temporary `WAZAP_DATA_DIR` (never `~/.wazap`, no WhatsApp account linked, no network of
// WhatsApp). The agents are MCP clients of the SDK over http, as Claude is. It is marked "not verified"
// when the npx cache of this computer does not hold wazap-mcp@1.6.0.
//   item 1  one process serves 6 agents, no `npm exec`
//   item 2  `tools/list` through the route equals the one of a stdio session; `get_status` answers alike
//   item 3  each agent has its own session on the server
//   item 4  a wrong bearer, another agent's bearer, a wrong `Host`, an `Origin` that is not loopback, a method
//           that MCP does not use: refused; a line turned off: a JSON-RPC error at once
//   item 5  6 agents x 20 `get_status` at the same time: all ok; 30 sessions at the same time: the server
//           never holds more than the limit, and every agent still answers (a session closed to make room
//           opens again with no error)
//   item 6  the process is killed during calls: the next call of each agent works, with no new `initialize`
//           from the agent; after `stop`, the process of the host is gone
//   item 7  a process that runs already is adopted and never stopped by the host; with `adoptForeign` false the
//           line is not shared
//   item 8  the hand-off with the host is http, the stored row is untouched (the WhatsApp instruction reads it),
//           and with the switch off the shapes are the ones of before
//   item 9  3 agents: the first closes its session; the other 2 go on without error
// `bun scripts/shared-mcp-e2e.ts`. Writes .buildersbot-build/shared-mcp-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isWazapServer, type McpServerConfig } from "@buildersbot/contracts/ipc";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Effect } from "effect";
import { sharedMcpSignature } from "../src/backend/agent/shared-mcp-access";
import {
  claudeMcpServers,
  clearDirectBinaryCache,
  clearMcpCommandCache,
  type McpToolRuntimes,
  NO_MCP_TOOL_RUNTIMES,
  usableMcpServer,
} from "../src/backend/mcp-provider-shapes";
import { SharedMcpHost } from "../src/main/shared-mcp-host";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/shared-mcp-e2e");
type Fact = string | number | boolean | null | Fact[] | { [key: string]: Fact };
const report: { passed: boolean; error?: string; facts: { [key: string]: Fact }; notVerified: string[] } = {
  passed: false,
  facts: {},
  notVerified: [],
};
const root = await mkdtemp(join(tmpdir(), "buildersbot-shared-mcp-"));
const dataDirectory = join(root, "wazap-data");
mkdirSync(dataDirectory, { recursive: true });
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const cleanup: (() => Promise<void> | void)[] = [];

/** The SDK class is not a `Transport` under `exactOptionalPropertyTypes`; this one forwards to it. */
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

function wazapLine(directory: string): McpServerConfig {
  return {
    id: "whatsapp",
    name: "whatsapp",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: ["-y", "wazap-mcp@1.6.0"],
    env: [
      { key: "WAZAP_DATA_DIR", value: directory },
      { key: "WAZAP_NO_UPDATE_CHECK", value: "1" },
      { key: "NO_COLOR", value: "1" },
    ],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
}

/** The processes of this folder that run wazap, by `ps`: the ones that mention the data directory in their environment are not readable, so by the pids the test knows. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function rssMb(pids: number[]): number {
  return Math.round(
    pids.reduce(
      (total, pid) =>
        total +
        Number(
          execFileSync("ps", ["-o", "rss=", "-p", String(pid)])
            .toString()
            .trim() || 0,
        ),
      0,
    ) / 1024,
  );
}

try {
  // The npx cache must hold the package; the direct program is resolved by the same code as the app.
  clearDirectBinaryCache();
  clearMcpCommandCache();
  const probe = await Effect.runPromise(
    usableMcpServer(wazapLine(dataDirectory), { ...NO_MCP_TOOL_RUNTIMES, directBinary: true }),
  );
  if (probe.error !== undefined || probe.command.endsWith("/npx")) {
    report.notVerified.push("everything: the npx cache of this computer does not hold wazap-mcp@1.6.0");
    report.passed = true;
    throw new Error("skip");
  }
  const signature = sharedMcpSignature(wazapLine(dataDirectory));
  assert.ok(signature, "the line of the Marketplace is shareable");
  assert.equal(signature.dataDirectory, dataDirectory);

  let lineEnabled = true;
  const adoptForeign = true;
  const host = new SharedMcpHost({
    lineEnabled: () => lineEnabled,
    adoptForeign: () => adoptForeign,
    limits: { upstreamSessions: 24, sweepMs: 600_000 },
  });
  cleanup.push(() => host.stop());

  /** What the app does at a hand-off: the stdio line of the agent, resolved as it would start, handed to the host. */
  const sharedStdio: NonNullable<McpToolRuntimes["sharedStdio"]> = (line, agentId) =>
    Effect.promise(async () => {
      if (!sharedMcpSignature(line.config) || agentId === null) return null;
      const route = await host.route({
        serverId: line.config.id,
        agentId,
        dataDirectory,
        launch: { command: line.command, args: line.args, environment: line.environment },
      });
      return route ? { url: route.url, authorization: route.bearer, proxied: true } : null;
    });
  const handoff = (agentId: string) =>
    Effect.runPromise(
      usableMcpServer(
        wazapLine(dataDirectory),
        { ...NO_MCP_TOOL_RUNTIMES, directBinary: true, sharedStdio },
        undefined,
        agentId,
      ),
    );
  const connect = async (agentId: string) => {
    const server = await handoff(agentId);
    assert.equal(server.config.transport, "http", "the hand-off is http");
    const transport = new StreamableHTTPClientTransport(new URL(server.url ?? ""), {
      requestInit: { headers: { Authorization: `Bearer ${server.authorization}` } },
    });
    const client = new Client({ name: `agent-${agentId}`, version: "0" });
    await client.connect(asTransport(transport));
    return { client, transport, url: server.url ?? "", bearer: server.authorization ?? "", agentId };
  };
  const status = async (client: Client) => {
    const answer = await client.callTool({ name: "get_status", arguments: {} });
    assert.ok(!answer.isError, "get_status is not an error");
    return answer;
  };

  const agentOf = (index: number) => {
    const agent = sixAgents[index];
    assert.ok(agent, `agent ${index}`);
    return agent;
  };
  // item 8 (part): the hand-off and the stored row.
  const stored = wazapLine(dataDirectory);
  const sixAgents = await Promise.all(["a1", "a2", "a3", "a4", "a5", "a6"].map(connect));
  assert.ok(isWazapServer(stored), "the stored row is the one the WhatsApp instruction reads");
  report.facts.handoffUrl = sixAgents[0]?.url.replace(/\/[a-f0-9]{16}\/[a-f0-9]{32}$/u, "/<server>/<agent>") ?? "";

  // item 1: one process for 6 agents.
  const owner = host.ownerOf(dataDirectory);
  assert.ok(owner?.ownsProcess, "the host started the process");
  const ownerPid = Number(
    execFileSync("sh", ["-c", `cat ${JSON.stringify(join(dataDirectory, "server.lock"))}`])
      .toString()
      .trim(),
  );
  assert.ok(alive(ownerPid));
  const ownerCommand = execFileSync("ps", ["-o", "command=", "-p", String(ownerPid)])
    .toString()
    .trim();
  report.facts.sixAgents = {
    ownerPid,
    ownerCommand: ownerCommand.replace(/^.*\/node_modules\//u, ".../node_modules/"),
    ownerRssMb: rssMb([ownerPid]),
    openUpstreamSessions: host.openUpstreamSessions,
  };
  assert.equal(host.openUpstreamSessions, 6, "one session on the server for each agent");
  assert.ok(!/npm exec|npx/u.test(ownerCommand.replace(/_npx/u, "")), "the process is the program, not npm exec");
  const children = (() => {
    try {
      return execFileSync("pgrep", ["-P", String(ownerPid)])
        .toString()
        .trim();
    } catch {
      return "";
    }
  })();
  assert.equal(children, "", "the process has no child (no npm exec above it, nothing under it)");
  const parent = execFileSync("ps", ["-o", "ppid=", "-p", String(ownerPid)])
    .toString()
    .trim();
  assert.equal(Number(parent), process.pid, "the host is its parent");

  // item 2: parity with a stdio session.
  const stdioClient = new Client({ name: "stdio-reference", version: "0" });
  const stdioTransport = new StdioClientTransport({
    command: probe.command,
    args: [...(probe.args ?? [])],
    env: {
      PATH: probe.path ?? process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      WAZAP_DATA_DIR: dataDirectory,
      WAZAP_NO_UPDATE_CHECK: "1",
      NO_COLOR: "1",
    },
    stderr: "ignore",
  });
  await stdioClient.connect(stdioTransport); // a bridge of the owner, as an agent's stdio session is today
  const viaStdio = (await stdioClient.listTools()).tools.map((tool) => tool.name).sort();
  const viaRoute = (await sixAgents[0]?.client.listTools())?.tools.map((tool) => tool.name).sort() ?? [];
  await stdioClient.close().catch(() => {});
  report.facts.toolCount = viaRoute.length;
  assert.deepEqual(viaRoute, viaStdio, "tools/list through the route equals the one of stdio");
  assert.ok(viaRoute.length >= 20, "the server lists its tools");
  const [first, second] = await Promise.all([status(agentOf(0).client), status(agentOf(1).client)]);
  assert.deepEqual(first.content, second.content, "get_status answers alike to two agents");

  // item 3: each agent its own session.
  assert.equal(new Set(sixAgents.map((agent) => agent.transport.sessionId)).size, 6, "six session ids at the agents");
  report.notVerified.push(
    "item 3 draft: no account is linked, so a draft cannot be made; isolation is proved by one session each on the server",
  );

  // item 4: access.
  {
    const target = new URL(sixAgents[0]?.url ?? "");
    const send = (options: { headers?: Record<string, string>; method?: string; path?: string }) =>
      new Promise<{ status: number; body: string }>((resolveRequest, reject) => {
        const outgoing = httpRequest(
          {
            host: "127.0.0.1",
            port: Number(target.port),
            path: options.path ?? target.pathname,
            method: options.method ?? "POST",
            headers: options.headers,
          },
          (answer) => {
            let body = "";
            answer.on("data", (chunk) => (body += chunk));
            answer.on("end", () => resolveRequest({ status: answer.statusCode ?? 0, body }));
          },
        );
        outgoing.once("error", reject);
        outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
      });
    const good = {
      authorization: `Bearer ${sixAgents[0]?.bearer}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    assert.equal((await send({ headers: { ...good, authorization: "Bearer wrong" } })).status, 403, "a wrong bearer");
    assert.equal(
      (await send({ headers: { ...good, authorization: `Bearer ${sixAgents[1]?.bearer}` } })).status,
      403,
      "the bearer of another agent",
    );
    assert.equal((await send({ headers: { ...good, host: "evil.example:1" } })).status, 403, "a wrong Host");
    assert.equal(
      (await send({ headers: { ...good, origin: "https://evil.example" } })).status,
      403,
      "an Origin that is not loopback",
    );
    assert.equal((await send({ headers: good, method: "PUT" })).status, 405, "a method that MCP does not use");
    assert.equal((await send({ headers: good, path: "/other" })).status, 403, "a path that is not a route");
    lineEnabled = false;
    const startedAt = Date.now();
    const off = await send({ headers: { ...good, "mcp-session-id": sixAgents[0]?.transport.sessionId ?? "" } });
    report.facts.turnedOffAnswerMs = Date.now() - startedAt;
    assert.equal(off.status, 200);
    assert.ok(JSON.parse(off.body).error, "a line turned off answers with a JSON-RPC error");
    assert.ok(Date.now() - startedAt < 1_000, "at once");
    lineEnabled = true;
  }

  // item 5: concurrency and the limit of sessions.
  {
    const calls = await Promise.allSettled(
      sixAgents.flatMap((agent) => Array.from({ length: 20 }, () => status(agent.client))),
    );
    const ok = calls.filter((call) => call.status === "fulfilled").length;
    report.facts.sixTimesTwentyOk = ok;
    assert.equal(ok, 120, "120 of 120 calls ok");
    // The server allows 240 POST a minute for its credential (every agent shares it, today too): let the budget refill.
    await sleep(62_000);
    const many = await Promise.all(Array.from({ length: 30 }, (_, index) => connect(`m${index}`)));
    // The limit is enforced as the requests end, so it holds a moment after the last one.
    for (let waited = 0; host.openUpstreamSessions > 24 && waited < 40; waited += 1) await sleep(50);
    report.facts.openAfter30 = host.openUpstreamSessions;
    assert.ok(host.openUpstreamSessions <= 24, "the server never holds more than the limit");
    // Every agent still answers: a session closed to make room opens again, with no error for the agent.
    const answers = await Promise.allSettled(many.map((agent) => status(agent.client)));
    assert.equal(answers.filter((answer) => answer.status === "fulfilled").length, 30, "all 30 agents answer");
    assert.ok(host.openUpstreamSessions <= 24, "and the limit still holds");
    for (const agent of many) await agent.client.close().catch(() => {});
  }

  // item 9: no cascade when one agent closes its session.
  {
    await sixAgents[0]?.client.close();
    const rest = await Promise.allSettled(sixAgents.slice(1).map((agent) => status(agent.client)));
    assert.equal(rest.filter((answer) => answer.status === "fulfilled").length, 5, "the others go on with no error");
    assert.ok(alive(ownerPid), "the process stays");
  }

  // item 6: the process falls.
  {
    const survivors = sixAgents.slice(1);
    process.kill(ownerPid, "SIGKILL");
    await sleep(200);
    const startedAt = Date.now();
    const again = await Promise.allSettled(survivors.map((agent) => status(agent.client)));
    report.facts.afterKillMs = Date.now() - startedAt;
    assert.equal(
      again.filter((answer) => answer.status === "fulfilled").length,
      survivors.length,
      "every agent answers after the fall",
    );
    assert.ok(Date.now() - startedAt < 15_000, "within 15 seconds");
    const newPid = Number(
      execFileSync("sh", ["-c", `cat ${JSON.stringify(join(dataDirectory, "server.lock"))}`])
        .toString()
        .trim(),
    );
    assert.notEqual(newPid, ownerPid, "a new process serves them");
    assert.ok(alive(newPid), "and it runs");
    report.facts.restartedPid = newPid;
    for (const agent of survivors) await agent.client.close().catch(() => {});
    await host.stop();
    await sleep(300);
    assert.ok(!alive(newPid), "after stop, the process of the host is gone");
  }

  // item 7: a process that runs already.
  {
    const adoptDirectory = join(root, "adopt");
    mkdirSync(adoptDirectory, { recursive: true });
    const foreign = spawn(probe.command, [...(probe.args ?? [])], {
      stdio: ["pipe", "ignore", "ignore"],
      env: {
        PATH: probe.path ?? process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        WAZAP_DATA_DIR: adoptDirectory,
        WAZAP_NO_UPDATE_CHECK: "1",
        NO_COLOR: "1",
      },
    });
    cleanup.push(() => {
      foreign.stdin?.end();
    });
    for (let i = 0; i < 100; i += 1) {
      try {
        execFileSync("test", ["-s", join(adoptDirectory, "daemon.json")]);
        break;
      } catch {
        await sleep(100);
      }
    }
    const adopting = new SharedMcpHost({ lineEnabled: () => true, adoptForeign: () => true });
    cleanup.push(() => adopting.stop());
    const lineHere = wazapLine(adoptDirectory);
    const route = await adopting.route({
      serverId: "whatsapp",
      agentId: "adopt",
      dataDirectory: adoptDirectory,
      launch: { command: probe.command, args: probe.args ?? [], environment: {} },
    });
    assert.ok(route, "a running server is adopted");
    assert.equal(adopting.ownerOf(adoptDirectory)?.ownsProcess, false, "the host did not start it");
    await adopting.stop();
    await sleep(300);
    assert.ok(foreign.pid && alive(foreign.pid), "the host never stops a process that it did not start");
    const refusing = new SharedMcpHost({ lineEnabled: () => true, adoptForeign: () => false });
    cleanup.push(() => refusing.stop());
    assert.equal(
      await refusing.route({
        serverId: "whatsapp",
        agentId: "adopt",
        dataDirectory: adoptDirectory,
        launch: { command: probe.command, args: probe.args ?? [], environment: {} },
      }),
      null,
      "with the egress proxy on, a running server that is not ours is not shared: the line stays stdio",
    );
    assert.equal(sharedMcpSignature(lineHere)?.dataDirectory, adoptDirectory);
    foreign.stdin?.end();
  }

  // item 8: shapes.
  {
    const off = claudeMcpServers([
      await Effect.runPromise(usableMcpServer(wazapLine(dataDirectory), NO_MCP_TOOL_RUNTIMES)),
    ]).servers.whatsapp;
    assert.equal(off?.type, "stdio", "with the switch off the line is stdio, as before");
    assert.deepEqual(off && off.type === "stdio" ? off.args : null, ["-y", "wazap-mcp@1.6.0"]);
    // Other lines are never shared.
    const other: McpServerConfig = {
      ...wazapLine(dataDirectory),
      id: "thinking",
      name: "thinking",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking@2025.1.1"],
    };
    assert.equal(sharedMcpSignature(other), null, "another server is not shareable");
    assert.equal(
      sharedMcpSignature({ ...wazapLine(dataDirectory), workingDirectory: "~/code" }),
      null,
      "a working directory is not shareable",
    );
    assert.equal(
      sharedMcpSignature({ ...wazapLine(dataDirectory), args: ["-y", "wazap-mcp@1.7.0"] }),
      null,
      "another minor version is not shareable",
    );
    assert.equal(
      sharedMcpSignature({ ...wazapLine(dataDirectory), args: ["-y", "wazap-mcp@1.6.0", "--read-only"] }),
      null,
      "extra arguments are not shareable",
    );
  }
  report.passed = true;
} catch (error) {
  if (!(error instanceof Error && error.message === "skip")) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.exitCode = 1;
  }
} finally {
  for (const item of cleanup.reverse()) await Promise.resolve(item()).catch(() => {});
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.exit(process.exitCode ?? 0);
}
