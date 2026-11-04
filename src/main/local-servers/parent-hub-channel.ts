// The child's end of the channel to the desktop app that started it (`hub-delegate-protocol.ts`). A local
// server holds no Cultura Builder session, so its Hub client asks the app for each operation. The app writes
// to this process's standard input, and this process writes to its standard output, which the app reads
// for its ready line.
//
// This runs at the very start of the process, before the services exist: the app writes its first line
// to the input right after the start, and a line that nobody reads yet would be lost once the input
// flows. The delegate only keeps the key and the snapshot until the services use it.

import type { Readable, Writable } from "node:stream";
import { HubConnectionDelegate } from "../../backend/hub-connections/hub-delegate-client";
import { createLineReader, HUB_DELEGATE_LIMITS } from "../../backend/hub-connections/hub-delegate-protocol";

export function openParentHubChannel(
  input: Pick<Readable, "setEncoding" | "on" | "once">,
  output: Pick<Writable, "write" | "writable">,
): HubConnectionDelegate {
  const delegate = new HubConnectionDelegate({
    send: (line) => {
      if (!output.writable) return false;
      output.write(`${line}\n`);
      return true;
    },
  });
  const reader = createLineReader(HUB_DELEGATE_LIMITS.childLineChars, (line) => delegate.receive(line));
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => reader.push(chunk));
  // The app is gone, or closed our input to stop us: nothing answers any more.
  input.once("end", () => delegate.close());
  input.once("error", () => delegate.close());
  return delegate;
}
