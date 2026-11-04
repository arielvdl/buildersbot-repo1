// Runs the Hub connections of a local server end to end, as far as one machine without Electron can: the
// app's half is the real agent service, Hub client and `HubDelegateHost` (through
// `AgentService.serveHubConnections`) with the session, against the fake Hub of scripts/fake-hub; the
// local server's half is a real second process (scripts/fake-hub/local-server-child.ts) with no session
// and a fetch that refuses everything, whose agent service, tool router, Guard and approval cards use the
// real `HubConnectionDelegate` over the real pipes of that process. Nothing reaches the network.
//
// It checks that the child's agent gets the tools only while the app is signed in, that its search, paid
// call, input checks and cost approval work through the app, that the Hub saw only the app's proxy
// tokens, that no session, token or approval id appears in any line of the channel or in any file of the
// child, that a forged line is dropped, that a sign-out in the app closes the tools of the child at once
// and a new sign-in opens them with no restart, and that the host stops when the child ends.
//
// What it does not cover: Electron itself (the child here is a Bun process, not the app's binary), the
// spawn and restart of `LocalServers`, and the screens. The unit tests of src/main/local-servers cover the
// spawn side with a fake child.
//
// `bun scripts/hub-connections-local-server-e2e.ts`. Writes
// .buildersbot-build/hub-connections/local-server.json.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HubJsonObject } from "@buildersbot/contracts/hub-connections";
import { type Call, type Seen, startAgentHarness, waitFor } from "./fake-hub/agent-harness";
import { fakeHubFetch, startFakeHub } from "./fake-hub/fake-hub";
import { FAKE_PROVIDER_KEY, FAKE_VENDOR_KEY } from "./fake-hub/fake-treg";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/hub-connections");
const root = await mkdtemp(join(tmpdir(), "buildersbot-hub-local-server-"));
const childRoot = join(root, "child");
mkdirSync(childRoot, { recursive: true });
const APPROVAL_PAGE = "https://hub.culturabuilder.com/builder-ai/conexoes/aprovar/";

const report: { steps: Array<{ step: string; result: unknown }>; passed: boolean; error?: string } = {
  steps: [],
  passed: false,
};

async function step(name: string, run: () => unknown): Promise<void> {
  try {
    report.steps.push({ step: name, result: (await run()) ?? "ok" });
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    report.steps.push({ step: name, result: { failed: error instanceof Error ? error.message : String(error) } });
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const hub = await startFakeHub();
let storedSession: string | null = null;
const signedInSession = () =>
  JSON.stringify({
    access: hub.session.access,
    refresh: hub.session.refresh,
    expires: Date.now() + 3_600_000,
    empresa: "Empresa A",
  });

// The app: the real agent service, which holds the session and the one Hub client.
const app = await startAgentHarness({
  root: join(root, "app"),
  mark: "HUB-APP",
  hubFetch: fakeHubFetch(hub),
  session: () => storedSession,
  saveSession: (value) => {
    storedSession = value;
  },
  decide: () => "accept",
});
const { HubDelegateHost } = await import("../src/backend/hub-connections/hub-delegate-host");
const { createLineReader, HUB_DELEGATE_LIMITS, HUB_DELEGATE_PREFIX } = await import(
  "../src/backend/hub-connections/hub-delegate-protocol"
);

// The child: a second process, with the pipes that `LocalServers` gives a real one.
const child: ChildProcess = spawn(
  process.execPath,
  [resolve(import.meta.dirname, "fake-hub/local-server-child.ts"), childRoot],
  {
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const wire: string[] = [];
const childOutput: string[] = [];
let childExited = false;
child.once("exit", () => {
  childExited = true;
  host?.close();
});
child.stderr?.on("data", (chunk: Buffer) => childOutput.push(chunk.toString("utf8")));
const host: InstanceType<typeof HubDelegateHost> | null = app.agents.serveHubConnections((line) => {
  if (!child.stdin?.writable) return false;
  wire.push(line);
  child.stdin.write(`${line}\n`);
  return true;
});
assert.ok(host, "the app has no Hub client to serve a local server with");
const reader = createLineReader(HUB_DELEGATE_LIMITS.parentLineChars, (line) => {
  if (!line.startsWith(HUB_DELEGATE_PREFIX)) return;
  wire.push(line);
  host.receive(line);
});
child.stdout?.setEncoding("utf8");
child.stdout?.on("data", (chunk: string) => reader.push(chunk));
host.start();

/** The Hub pages that the child opened: on a cost approval page, the person approves on the Hub. */
const approvals = setInterval(() => {
  const path = join(childRoot, "opened.log");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.startsWith(APPROVAL_PAGE)) continue;
    const id = decodeURIComponent(line.slice(APPROVAL_PAGE.length));
    if (hub.issuedConfirmations.includes(id)) hub.decideConfirmation(id, "approved");
  }
}, 100);

let commands = 0;
interface ChildOutput {
  readonly results: Seen[];
  readonly cards: Array<{ reason: string; decision: string }>;
  readonly ownHubRequests: number;
}
/** One command for the child, and what its agent read. */
async function ask(command: {
  calls?: Call[];
  cards?: Array<"accept" | "decline">;
  signedIn?: boolean;
  rawLines?: string[];
}): Promise<ChildOutput> {
  commands += 1;
  writeFileSync(join(childRoot, `cmd-${commands}.json`), JSON.stringify(command));
  const path = join(childRoot, `out-${commands}.json`);
  return await waitFor(
    `the child's answer to command ${commands}`,
    () => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null),
    120_000,
  );
}

const list = (): Call => ({ tool: "buildersbot_connections.list", arguments: {} });
const op = (operation: string, input: HubJsonObject): Call => ({
  tool: "buildersbot_connections.call",
  arguments: { connection: "tool-catalog", operation, input },
});
const search = (query: string): Call => ({ tool: "tool_search", arguments: { query } });
const hasTools = (seen: Seen | undefined) =>
  seen?.text.includes("buildersbot_connections.call") === true && seen.text.includes("buildersbot_connections.list");
const hubCalls = () => hub.requests.filter((request) => request.path.endsWith("/tool-catalog/call"));

/** Every secret that the fake Hub gave the app or the vendor. None may reach the child or the channel. */
const secrets = () => [
  hub.session.access,
  hub.session.refresh,
  FAKE_VENDOR_KEY,
  FAKE_PROVIDER_KEY,
  ...hub.issuedTokens,
  ...hub.issuedConfirmations,
];

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

try {
  await waitFor("the child to be ready", () => existsSync(join(childRoot, "ready")) || childExited, 120_000);
  assert.equal(childExited, false, `the child ended at once: ${childOutput.join("").slice(0, 600)}`);

  await step("signed out in the app: the child's agent has no tools, and nothing reaches the Hub", async () => {
    const out = await ask({ signedIn: false, calls: [search("paid data connections keyword"), list()] });
    const [found, listed] = out.results;
    assert.equal(hasTools(found), false, "tool_search shows the connection tools while the app is signed out");
    assert.equal(listed?.success, false);
    assert.equal(hub.requests.length, 0, "the Hub got a request while signed out");
    assert.equal(out.ownHubRequests, 0);
  });

  storedSession = signedInSession();
  // The person's sign-in in the app drops the old caches (`culturaSessionReplaced`), which tells the host.
  await app.runCauseEffect(app.agents.hubConnectionsView(true));

  await step("signed in: the child's agent finds the two tools and the list asks who pays", async () => {
    const out = await ask({
      signedIn: true,
      calls: [
        search("paid data connections keyword"),
        { tool: "tool_describe", arguments: { names: ["buildersbot_connections.list"] } },
        list(),
      ],
    });
    const [found, described, listed] = out.results;
    assert.ok(hasTools(found), found?.text.slice(0, 500));
    assert.ok(described?.success, described?.text);
    assert.ok(listed?.success, listed?.text);
    const rows = listed.fields.connections;
    assert.ok(Array.isArray(rows));
    assert.deepEqual(rows[0], { id: "tool-catalog", operations: ["search", "describe", "call"], state: "choose_org" });
  });

  await step("search: the child's card picks Empresa A, and the Hub sees the app's proxy token", async () => {
    const out = await ask({ cards: ["accept"], calls: [op("search", { query: "keyword volume" })] });
    const [found] = out.results;
    assert.ok(found?.success, found?.text);
    assert.ok(found.text.includes("seo.keyword-volume"));
    assert.ok(out.cards.some((card) => card.reason.includes("Empresa A") && card.decision === "accept"));
    const request = hub.requests.find((entry) => entry.path.endsWith("/tool-catalog/search"));
    assert.ok(request?.headers.authorization?.startsWith("Bearer cbp_"));
    assert.equal(request?.headers.cookie, undefined);
    assert.equal(out.ownHubRequests, 0, "the child reached the Hub by itself");
  });

  await step("a paid call runs through the app and comes back in the untrusted envelope", async () => {
    const before = hubCalls().length;
    const out = await ask({ calls: [op("call", { endpointId: "seo.keyword-volume", body: { keywords: ["crm"] } })] });
    const [done] = out.results;
    assert.ok(done?.success, done?.text);
    assert.ok(done.text.includes('<connection_output untrusted="true" connection="tool-catalog"'));
    assert.equal(hubCalls().length, before + 1);
    assert.equal(JSON.parse(hubCalls().at(-1)?.body ?? "{}").origin, "owner_ui");
  });

  await step("an input with a credential is refused in the child, and never reaches the app's client", async () => {
    const before = hub.requests.length;
    const out = await ask({
      calls: [op("call", { endpointId: "seo.keyword-volume", body: { keywords: ["crm"], api_key: "x" } })],
    });
    assert.equal(out.results[0]?.success, false);
    assert.equal(hub.requests.length, before, "a refused input reached the Hub");
  });

  await step("a forged line on the channel is dropped, and the real requests go on", async () => {
    const before = hub.requests.length;
    const forged = `${"0".repeat(64)} ${JSON.stringify({ id: 99_999, method: "catalog", args: {} })}`;
    const unknown = `${"1".repeat(64)} ${JSON.stringify({ id: 99_998, method: "requestAccess", args: {} })}`;
    const out = await ask({ rawLines: [forged, unknown], calls: [list()] });
    assert.ok(out.results[0]?.success, out.results[0]?.text);
    assert.ok(hub.requests.length >= before);
    assert.equal(
      hub.requests.slice(before).some((request) => request.path.includes("access-requests")),
      false,
    );
  });

  await step("confirm_cost: the child's card, the person's approval on the Hub, then one confirmed call", async () => {
    const before = hubCalls().length;
    const out = await ask({
      cards: ["accept"],
      calls: [op("call", { endpointId: "market.quote-pro", body: { symbol: "PETR4" } })],
    });
    const [done] = out.results;
    assert.ok(done?.success, done?.text);
    assert.equal(done.fields.chargedMicros, 400_000);
    const sent = hubCalls()
      .slice(before)
      .map((request) => JSON.parse(request.body));
    assert.equal(sent.length, 2);
    assert.equal(sent[0].confirmationId, undefined);
    assert.equal(sent[1].confirmationId, hub.issuedConfirmations.at(-1));
    assert.equal(sent[1].maxCostMicros, 400_000);
    const opened = readFileSync(join(childRoot, "opened.log"), "utf8");
    assert.ok(opened.includes(`${APPROVAL_PAGE}${hub.issuedConfirmations.at(-1)}`));
  });

  await step("a declined cost runs nothing", async () => {
    const before = hubCalls().length;
    const vendorBefore = hub.treg.requests.length;
    const out = await ask({
      cards: ["decline"],
      calls: [op("call", { endpointId: "market.quote-pro", body: { symbol: "VALE3" } })],
    });
    assert.equal(out.results[0]?.success, false);
    assert.equal(hubCalls().length, before + 1);
    assert.equal(hub.treg.requests.length, vendorBefore);
  });

  await step("no session, token, key or approval id crosses the channel or lands in a file of the child", async () => {
    const lines = wire.join("\n");
    // The id of a cost approval is not a credential: the Hub page asks the person to sign in, and the
    // child's tools use the id as the app's own tools do. It crosses the channel, so it is not in this list.
    for (const secret of secrets().filter((value) => !hub.issuedConfirmations.includes(value)))
      assert.ok(!lines.includes(secret), "a secret of the fake Hub is on the channel");
    assert.ok(!/cbp_|treg_|Bearer |refresh_token|access_token/u.test(lines), "a token shape is on the channel");
    const found: string[] = [];
    const credentials = secrets().filter((value) => !hub.issuedConfirmations.includes(value));
    for (const path of filesUnder(childRoot)) {
      if (statSync(path).size > 50 * 1024 * 1024) continue;
      const bytes = readFileSync(path);
      for (const secret of credentials) if (bytes.includes(secret)) found.push(path);
    }
    assert.deepEqual(found, [], "a secret is in a file of the child");
    const childText = childOutput.join("");
    for (const secret of [hub.session.access, hub.session.refresh, ...hub.issuedTokens])
      assert.ok(!childText.includes(secret), "a secret is in the output of the child");
    return { lines: wire.length, filesScanned: filesUnder(childRoot).length };
  });

  await step("the app signs out: the tools of the child's agent close, and nothing more reaches the Hub", async () => {
    storedSession = null;
    await app.runCauseEffect(app.agents.hubConnectionsView(true));
    const before = hub.requests.length;
    const out = await ask({ signedIn: false, calls: [search("paid data connections keyword"), list()] });
    assert.equal(hasTools(out.results[0]), false);
    assert.equal(out.results[1]?.success, false);
    assert.equal(hub.requests.length, before, "the Hub got a request after the sign-out");
  });

  await step("a new sign-in opens the tools again, with no restart of the child", async () => {
    storedSession = signedInSession();
    await app.runCauseEffect(app.agents.hubConnectionsView(true));
    const out = await ask({ signedIn: true, calls: [list()] });
    assert.ok(out.results[0]?.success, out.results[0]?.text);
  });

  await step("the host stops when the child ends", async () => {
    commands += 1;
    writeFileSync(join(childRoot, `cmd-${commands}.json`), JSON.stringify({ done: true }));
    await waitFor("the child to exit", () => childExited, 60_000);
    assert.equal(host.closed, true);
    const before = hub.requests.length;
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(hub.requests.length, before);
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.stdout.write(`not ok - ${report.error}\n`);
  if (!childExited) process.stdout.write(`child output: ${childOutput.join("").slice(-800)}\n`);
} finally {
  clearInterval(approvals);
  host.close();
  if (!childExited) child.kill("SIGKILL");
  await app.stop();
  await hub.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "local-server.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${join(OUT, "local-server.json")}\n`);
  process.exit(report.passed ? 0 : 1);
}
