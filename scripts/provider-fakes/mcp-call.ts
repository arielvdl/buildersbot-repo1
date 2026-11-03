// The tool call that a fake agent makes over the MCP server that the app gave its session, as OpenCode
// does: a new connection with the bearer token, one `tools/call`, then close. A fake uses it so that a
// check reaches the real tool router and not a stand-in.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/** The MCP server entry of `session/new`, as the fake reads it. */
export interface McpServerEntry {
  name: string;
  url?: string;
  headers?: { name: string; value: string }[];
}

export interface McpToolAnswer {
  isError: boolean;
  text: string;
}

/**
 * The SDK transport classes declare their handlers and `sessionId` as `T | undefined`, which
 * `exactOptionalPropertyTypes` does not accept as a `Transport`. This one forwards to such a class.
 */
function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}

/** Calls one tool of the server. A refusal of the tool comes back as `isError`, not as a throw. */
export async function callMcpTool(server: McpServerEntry, name: string, args: unknown): Promise<McpToolAnswer> {
  if (!server.url) throw new Error(`The MCP server ${server.name} has no address.`);
  const headers = Object.fromEntries((server.headers ?? []).map((header) => [header.name, header.value]));
  const client = new Client({ name: "fake-agent", version: "1.0.0" });
  try {
    await client.connect(
      asTransport(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } })),
    );
    const result = await client.callTool({
      name,
      arguments: typeof args === "object" && args !== null ? { ...args } : {},
    });
    const first = Array.isArray(result.content) ? result.content[0] : undefined;
    const text =
      typeof first === "object" && first !== null && "text" in first && typeof first.text === "string"
        ? first.text
        : "";
    return { isError: result.isError === true, text };
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.close().catch(() => undefined);
  }
}
