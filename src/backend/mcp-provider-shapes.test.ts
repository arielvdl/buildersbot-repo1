// @vitest-environment node
import type { McpServerConfig } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { onePerLaunch } from "./mcp-provider-shapes";

function stdio(id: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id,
    name: id,
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: ["-y", "wazap-mcp@1.6.0"],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...overrides,
  };
}

describe("one copy of each stdio program for one agent", () => {
  it("keeps the first row of rows that start the same program", () => {
    const rows = [stdio("whatsapp"), stdio("whatsapp-again"), stdio("whatsapp-third")];
    expect(onePerLaunch(rows).map((row) => row.id)).toEqual(["whatsapp"]);
  });

  it("keeps rows that differ in arguments, environment or working directory", () => {
    const rows = [
      stdio("a"),
      stdio("b", { args: ["-y", "wazap-mcp@1.6.1"] }),
      stdio("c", { env: [{ key: "WAZAP_DATA_DIR", value: "/tmp/one" }] }),
      stdio("d", { workingDirectory: "/tmp/project" }),
    ];
    expect(onePerLaunch(rows).map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("never merges http rows", () => {
    const rows = [
      stdio("a", { transport: "http", url: "https://x.test/mcp" }),
      stdio("b", { transport: "http", url: "https://x.test/mcp" }),
    ];
    expect(onePerLaunch(rows)).toHaveLength(2);
  });
});
