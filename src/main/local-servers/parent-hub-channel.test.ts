import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { formatHello, HUB_DELEGATE_PREFIX, openFrame } from "../../backend/hub-connections/hub-delegate-protocol";
import { openParentHubChannel } from "./parent-hub-channel";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe("the child's end of the channel", () => {
  it("reads the hello from its input in pieces, asks on its output, and fails every wait when the input ends", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding("utf8");
    const written: string[] = [];
    output.on("data", (chunk: string) => written.push(chunk));
    const delegate = openParentHubChannel(input, output);

    const key = Buffer.alloc(32, 4);
    const hello = `${formatHello(key, { signedIn: true, connectionIds: ["tool-catalog"] })}\n`;
    input.write(hello.slice(0, 20));
    input.write(hello.slice(20));
    await settle();
    expect(delegate.signedIn()).toBe(true);

    const waiting = Effect.runPromise(Effect.flip(delegate.catalog()));
    await settle();
    const line = written.join("").trim();
    expect(line.startsWith(HUB_DELEGATE_PREFIX)).toBe(true);
    expect(openFrame(key, "request", line.slice(HUB_DELEGATE_PREFIX.length), 100_000)).toContain('"method":"catalog"');

    // The app stopped, or closed the input of this child.
    input.end();
    expect(await waiting).toMatchObject({ code: "offline" });
    expect(delegate.signedIn()).toBe(false);
  });
});
