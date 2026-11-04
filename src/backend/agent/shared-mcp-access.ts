import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { McpServerConfig } from "@buildersbot/contracts/ipc";

/**
 * The stdio MCP servers that agents may share, one process for all of them (`SharedMcpHost`).
 *
 * A line is shared only when it matches a signature below: the command, the arguments, the version
 * and the environment are fixed, and the server keeps its state per MCP session (so two agents on one
 * process still have a session each). Everything else stays one process for each agent, because a
 * stdio process is one MCP session and joining agents would join their state (a draft, a working
 * directory, a thought, a transaction). Not shareable by design: Computer Use (it has a switch for
 * each agent), Playwright (it has its own broker), a line with a working directory, a server that
 * asks the client for sampling, elicitation or roots, and any line that a person wrote and that is
 * not listed here. See specs/perf-memory.md, section 5.4.3.
 */
export interface SharedMcpSignature {
  /** The id of the kind, for the log. */
  kind: "wazap";
  /** The folder where the server keeps its state: its lock and its `daemon.json` are there. */
  dataDirectory: string;
}

/** `wazap-mcp@1.6.N`: the exact versions of 1.6 that the host was written and tested against. */
const WAZAP_PACKAGE = /^wazap-mcp@1\.6\.\d+$/u;

/**
 * The packages that may start as their own program, with no `npx` around them (`mcp-direct-binary`).
 * `npx` gives a program the `.bin` of its package on the `PATH` and the `npm_*` variables; a server that
 * needs either can fail to start without them. So only a package that was proved to start and to list its
 * tools this way is listed: `wazap-mcp@1.6.x` (23 tools). Every other line keeps its `npx` line.
 */
export function isProvenDirectPackage(name: string, version: string): boolean {
  return WAZAP_PACKAGE.test(`${name}@${version}`);
}
/** The variables of a wazap line that change nothing about what the process shares. */
const WAZAP_ENVIRONMENT = new Set(["WAZAP_DATA_DIR", "WAZAP_NO_UPDATE_CHECK", "NO_COLOR"]);

function expandHome(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return homedir();
  return trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
}

/** What the line is, when it may be shared, and `null` for every other line. */
export function sharedMcpSignature(config: McpServerConfig): SharedMcpSignature | null {
  if (config.transport !== "stdio" || config.workingDirectory.trim() !== "") return null;
  if (basename(config.command.trim()) !== "npx") return null;
  const [flag, spec, ...rest] = config.args;
  if ((flag !== "-y" && flag !== "--yes") || spec === undefined || !WAZAP_PACKAGE.test(spec) || rest.length > 0)
    return null;
  if (config.envPassthrough.some((name) => name !== "HOME")) return null;
  if (config.env.some((pair) => !WAZAP_ENVIRONMENT.has(pair.key))) return null;
  const configured = config.env.find((pair) => pair.key === "WAZAP_DATA_DIR")?.value.trim();
  return { kind: "wazap", dataDirectory: resolve(expandHome(configured || join(homedir(), ".wazap"))) };
}
