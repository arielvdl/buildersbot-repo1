// Checks the switch `mcp-direct-binary` (item 12 of section 5.9 of specs/perf-memory.md): a stdio line
// `npx -y <package>@<exact version> ...` starts the package's own program, with no `npm exec` around it,
// and every other case keeps the `npx` line. Runs the real `usableMcpServer` and the real provider
// shapes (Claude, ACP, Codex). The `npx` of the cases is a stand-in program that answers like
// `npx --offline -y -p <package> -c 'printf %s "$PATH"'`, so no network and no cache of this computer is
// needed. A last part runs the real `npx` against the wazap package when its cache holds it, with a
// temporary `WAZAP_DATA_DIR` (never `~/.wazap`); it is marked "not verified" when the cache is empty.
//   1. Cached package, exact version: the line is the program itself, with the rest of the arguments.
//   2. Not exact (`@latest`, a range, no version), another command than `npx`, or the switch off: the line
//      is as stored, and `npx` is not even asked.
//   3. Version of the package different, program missing, `npx` fails: the line is as stored. A failure
//      is not asked again for a minute.
//   4. A package that is not in the list of proved ones (`isProvenDirectPackage`, `wazap-mcp@1.6.x`) keeps its `npx`
//      line and `npx` is not asked; the proved one gets the `.bin` of its package first on the `PATH`.
//   5. With the switch off the three shapes are equal to the ones of before; with it on they carry the
//      program and its arguments.
//   6. Real `npx` and wazap (when cached): one process for the session, no `npm exec`.
// `bun scripts/mcp-direct-binary-e2e.ts`. Writes .buildersbot-build/mcp-direct-binary-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import {
  acpMcpServers,
  claudeMcpServers,
  clearDirectBinaryCache,
  clearMcpCommandCache,
  codexMcpServers,
  type McpToolRuntimes,
  NO_MCP_TOOL_RUNTIMES,
  type UsableMcpServer,
  usableMcpServer,
} from "../src/backend/mcp-provider-shapes";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/mcp-direct-binary-e2e");
const root = await mkdtemp(join(tmpdir(), "buildersbot-mcp-direct-binary-"));
const stubBin = join(root, "bin");
const countFile = join(root, "npx-calls");
type Fact = string | number | boolean | null | Fact[] | { [key: string]: Fact };
const report: { passed: boolean; error?: string; facts: { [key: string]: Fact }; notVerified: string[] } = {
  passed: false,
  facts: {},
  notVerified: [],
};

mkdirSync(stubBin, { recursive: true });
// The stand-in `npx`: counts its calls, and prints a PATH that begins with the `.bin` that the case names
// in FAKE_NPX_BIN. FAKE_NPX_FAIL makes it exit with an error, as `npx --offline` does for an uncached package.
writeFileSync(
  join(stubBin, "npx"),
  `#!/bin/sh
echo call >> ${JSON.stringify(countFile)}
if [ -n "$FAKE_NPX_FAIL" ]; then echo "npm error code ENOTCACHED" >&2; exit 1; fi
printf %s "$FAKE_NPX_BIN:/usr/bin:/bin"
`,
);
chmodSync(join(stubBin, "npx"), 0o755);
const calls = () => {
  try {
    return readFileSync(countFile, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

/** An install of `name@version` in a fresh folder, as `npx` leaves it in its cache. */
function install(
  label: string,
  name: string,
  version: string,
  bin: string | Record<string, string>,
  programs: string[],
): string {
  const modules = join(root, label, "node_modules");
  const packageDirectory = join(modules, ...name.split("/"));
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name, version, bin }));
  mkdirSync(join(modules, ".bin"), { recursive: true });
  for (const program of programs) {
    writeFileSync(join(modules, ".bin", program), "#!/usr/bin/env node\n");
    chmodSync(join(modules, ".bin", program), 0o755);
  }
  return join(modules, ".bin");
}

function line(args: string[], overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "tool",
    name: "tool",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args,
    // The stand-in first on the `PATH`, which is also the `PATH` the lookup of `npx` uses.
    env: [{ key: "PATH", value: `${stubBin}:${process.env.PATH ?? ""}` }],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...overrides,
  };
}

const ON: McpToolRuntimes = { ...NO_MCP_TOOL_RUNTIMES, directBinary: true };

async function resolveOne(config: McpServerConfig, tools: McpToolRuntimes): Promise<UsableMcpServer> {
  clearMcpCommandCache();
  return Effect.runPromise(usableMcpServer(config, tools));
}

/** Where the line starts and with what: the program, or the stored `npx` line. */
function shapeOf(server: UsableMcpServer) {
  const claude = claudeMcpServers([server]).servers[server.config.name];
  assert.ok(claude && claude.type === "stdio");
  return { command: claude.command, args: claude.args };
}

try {
  // 1. The cached package, exact version.
  {
    clearDirectBinaryCache();
    process.env.FAKE_NPX_BIN = install("ok", "wazap-mcp", "1.6.0", { wazap: "dist/index.js" }, ["wazap"]);
    // The program is named after the package or is the only one: `wazap` is the only one here.
    const before = calls();
    const server = await resolveOne(line(["-y", "wazap-mcp@1.6.0", "--flag", "x"]), ON);
    assert.equal(calls() - before, 1, "npx is asked once");
    const shape = shapeOf(server);
    report.facts.direct = shape;
    assert.equal(shape.command, join(process.env.FAKE_NPX_BIN, "wazap"), "the line is the program itself");
    assert.deepEqual(shape.args, ["--flag", "x"], "the arguments after the package stay");
    // A second hand-off does not ask `npx` again.
    const again = await resolveOne(line(["-y", "wazap-mcp@1.6.0", "--flag", "x"]), ON);
    assert.equal(calls() - before, 1, "the answer is kept");
    assert.deepEqual(shapeOf(again), shape);
    // `--yes` is the same word as `-y`.
    const yes = await resolveOne(line(["--yes", "wazap-mcp@1.6.0"]), ON);
    assert.deepEqual(shapeOf(yes).args, [], "no more arguments after the package");
  }

  // 2. The cases that never ask `npx`.
  {
    clearDirectBinaryCache();
    const before = calls();
    const stored = ["-y", "wazap-mcp@1.6.0"];
    const cases: [string, McpServerConfig, McpToolRuntimes][] = [
      ["switch off", line(stored), NO_MCP_TOOL_RUNTIMES],
      ["switch off explicitly", line(stored), { ...NO_MCP_TOOL_RUNTIMES, directBinary: false }],
      ["latest", line(["-y", "wazap-mcp@latest"]), ON],
      ["a range", line(["-y", "wazap-mcp@^1.6.0"]), ON],
      ["no version", line(["-y", "wazap-mcp"]), ON],
      ["a short version", line(["-y", "wazap-mcp@1.6"]), ON],
      ["another flag first", line(["--package", "wazap-mcp@1.6.0"]), ON],
      ["no package", line(["-y"]), ON],
    ];
    for (const [name, config, tools] of cases) {
      const server = await resolveOne(config, tools);
      const shape = shapeOf(server);
      assert.equal(shape.command.endsWith("/npx"), true, `${name}: the command is npx`);
      assert.deepEqual(shape.args, config.args, `${name}: the arguments are the stored ones`);
    }
    // Another command than `npx`: never touched.
    const node = await resolveOne(line(["-y", "wazap-mcp@1.6.0"], { command: process.execPath }), ON);
    assert.equal(shapeOf(node).command, process.execPath);
    assert.equal(calls() - before, 0, "npx is not asked for any of these");
  }

  // 3. The cases that ask `npx` and fall back.
  {
    clearDirectBinaryCache();
    process.env.FAKE_NPX_BIN = install("old", "wazap-mcp", "1.5.9", { wazap: "x.js" }, ["wazap"]);
    const mismatch = await resolveOne(line(["-y", "wazap-mcp@1.6.0"]), ON);
    assert.deepEqual(
      shapeOf(mismatch).args,
      ["-y", "wazap-mcp@1.6.0"],
      "another version in the cache: the stored line",
    );
    assert.equal(shapeOf(mismatch).command.endsWith("/npx"), true);

    clearDirectBinaryCache();
    process.env.FAKE_NPX_BIN = install("noprogram", "wazap-mcp", "1.6.0", { wazap: "x.js" }, []);
    const noProgram = await resolveOne(line(["-y", "wazap-mcp@1.6.0"]), ON);
    assert.equal(shapeOf(noProgram).command.endsWith("/npx"), true, "a program that is missing: the stored line");

    clearDirectBinaryCache();
    process.env.FAKE_NPX_FAIL = "1";
    const failed = await resolveOne(line(["-y", "wazap-mcp@1.6.0"]), ON);
    assert.equal(shapeOf(failed).command.endsWith("/npx"), true, "npx fails: the stored line");
    const afterFailure = calls();
    await resolveOne(line(["-y", "wazap-mcp@1.6.0"]), ON);
    assert.equal(calls(), afterFailure, "a failure is not asked again for a minute");
    delete process.env.FAKE_NPX_FAIL;

    // A program that was cached and is gone: the stored line, and then it is looked up again.
    clearDirectBinaryCache();
    const bin = install("gone", "wazap-mcp", "1.6.0", { wazap: "x.js" }, ["wazap"]);
    process.env.FAKE_NPX_BIN = bin;
    const first = await resolveOne(line(["-y", "wazap-mcp@1.6.0"]), ON);
    assert.equal(shapeOf(first).command, join(bin, "wazap"));
    rmSync(join(bin, "wazap"));
    const second = await resolveOne(line(["-y", "wazap-mcp@1.6.0"]), ON);
    assert.equal(shapeOf(second).command.endsWith("/npx"), true, "the cached program was pruned: the stored line");
  }

  // 4. Only the packages that were proved start as their own program: the rest keep the `npx` line.
  {
    clearDirectBinaryCache();
    const before = calls();
    const scoped = install("scoped", "@acme/tool", "2.0.1", "bin/tool.js", ["tool"]);
    process.env.FAKE_NPX_BIN = scoped;
    for (const spec of ["@acme/tool@2.0.1", "multi@3.0.0", "wazap-mcp@1.7.0", "wazap-mcp@2.0.0", "other-mcp@1.6.0"]) {
      const server = await resolveOne(line(["-y", spec]), ON);
      const shape = shapeOf(server);
      assert.equal(shape.command.endsWith("/npx"), true, `${spec}: the command is npx`);
      assert.deepEqual(shape.args, ["-y", spec], `${spec}: the line is the stored one`);
      assert.equal(server.path, `${stubBin}:${process.env.PATH ?? ""}`, `${spec}: the PATH is the stored one`);
    }
    assert.equal(calls() - before, 0, "npx is not even asked for a package outside the list");
    // Another patch version of 1.6 is in the list.
    clearDirectBinaryCache();
    process.env.FAKE_NPX_BIN = install("patch", "wazap-mcp", "1.6.3", { wazap: "x.js" }, ["wazap"]);
    const patch = await resolveOne(line(["-y", "wazap-mcp@1.6.3"]), ON);
    assert.equal(shapeOf(patch).command, join(process.env.FAKE_NPX_BIN, "wazap"), "wazap-mcp@1.6.3 is in the list");
    // The program gets the `.bin` of its package first on the PATH, as npx gives it.
    assert.equal(patch.path?.split(":")[0], process.env.FAKE_NPX_BIN, "the .bin of the package is first on the PATH");
    assert.ok(patch.path?.endsWith(`${stubBin}:${process.env.PATH ?? ""}`), "then the PATH of the line");
  }

  // 5. The three shapes.
  {
    clearDirectBinaryCache();
    const bin = install("shapes", "wazap-mcp", "1.6.0", { wazap: "x.js" }, ["wazap"]);
    process.env.FAKE_NPX_BIN = bin;
    const config = line(["-y", "wazap-mcp@1.6.0"]);
    const off = await resolveOne(config, NO_MCP_TOOL_RUNTIMES);
    const on = await resolveOne(config, ON);
    const shapes = (server: UsableMcpServer) => ({
      claude: claudeMcpServers([server]).servers,
      acp: acpMcpServers([server]).servers,
      codex: codexMcpServers([server]).servers,
    });
    const before = shapes(off);
    const after = shapes(on);
    // "As before": the stored line, whole object, in the three shapes.
    assert.deepEqual(before.claude.tool && "args" in before.claude.tool ? before.claude.tool.args : null, config.args);
    assert.deepEqual(before.acp[0] && "args" in before.acp[0] ? before.acp[0].args : null, config.args);
    assert.deepEqual(before.codex.tool && "args" in before.codex.tool ? before.codex.tool.args : null, config.args);
    const program = join(bin, "wazap");
    assert.equal(after.claude.tool && "command" in after.claude.tool ? after.claude.tool.command : null, program);
    assert.equal(after.acp[0] && "command" in after.acp[0] ? after.acp[0].command : null, program);
    assert.equal(after.codex.tool && "command" in after.codex.tool ? after.codex.tool.command : null, program);
    for (const args of [
      after.claude.tool && "args" in after.claude.tool ? after.claude.tool.args : null,
      after.acp[0] && "args" in after.acp[0] ? after.acp[0].args : null,
      after.codex.tool && "args" in after.codex.tool ? after.codex.tool.args : null,
    ])
      assert.deepEqual(args, [], "the package word is gone, nothing else changes");
    // The environment of the server is the same with the switch on and off, but for the PATH.
    const environmentOf = (server: UsableMcpServer) => {
      const entry = claudeMcpServers([server]).servers.tool;
      return entry?.type === "stdio" ? entry.env : null;
    };
    // Same environment, but the PATH of the program has the `.bin` of its package first, as npx gives it.
    const { PATH: onPath, ...onRest } = environmentOf(on) ?? {};
    const { PATH: offPath, ...offRest } = environmentOf(off) ?? {};
    assert.deepEqual(onRest, offRest, "the environment is the same but for the PATH");
    assert.equal(onPath, `${bin}:${offPath}`, "the PATH has the .bin of the package first");
    // The configuration itself, which `enabled()` reads for the WhatsApp instruction, is untouched.
    assert.deepEqual(on.config, config, "the stored configuration is not rewritten");
  }

  // 6. The real npx and the real wazap, when the cache holds it.
  {
    clearDirectBinaryCache();
    clearMcpCommandCache();
    delete process.env.FAKE_NPX_BIN;
    const dataDir = join(root, "wazap-data");
    mkdirSync(dataDir, { recursive: true });
    const real: McpServerConfig = {
      ...line(["-y", "wazap-mcp@1.6.0"]),
      env: [
        { key: "WAZAP_DATA_DIR", value: dataDir },
        { key: "WAZAP_NO_UPDATE_CHECK", value: "1" },
        { key: "NO_COLOR", value: "1" },
      ],
    };
    const server = await Effect.runPromise(usableMcpServer(real, ON));
    const shape = shapeOf(server);
    report.facts.realLine = { command: shape.command, args: shape.args };
    if (shape.command.endsWith("/npx")) {
      report.notVerified.push("real wazap: the npx cache of this computer does not hold wazap-mcp@1.6.0");
    } else {
      assert.ok(shape.command.includes("/node_modules/.bin/"), "the real program is in the npx cache");
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const environment = {
        PATH: server.path ?? process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        WAZAP_DATA_DIR: dataDir,
        WAZAP_NO_UPDATE_CHECK: "1",
        NO_COLOR: "1",
      };
      const transport = new StdioClientTransport({
        command: shape.command,
        args: shape.args,
        env: environment,
        stderr: "ignore",
      });
      const client = new Client({ name: "mcp-direct-binary-e2e", version: "0" });
      try {
        await client.connect(transport);
        const tools = (await client.listTools()).tools.length;
        const pid = transport.pid;
        assert.ok(pid, "the session has a process");
        const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
        report.facts.realSession = { tools, command: command.replace(dataDir, "<data>") };
        assert.equal(tools, 23, "the real program answers tools/list with 23 tools");
        assert.ok(!/npm exec|(^|[/ ])npx( |$)/u.test(command), "the process of the session is not npm exec");
        assert.ok(/wazap/u.test(command), "the process of the session is wazap");
      } finally {
        await client.close().catch(() => {});
      }
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
