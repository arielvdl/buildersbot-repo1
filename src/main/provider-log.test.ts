// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuildersBotLogger } from "@buildersbot/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startQueueLog } from "./provider-log";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("startQueueLog", () => {
  it("keeps why a queued message waits in queue.log, and no other logger's lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildersbot-queue-log-"));
    roots.push(root);
    const stop = startQueueLog(root);
    const silent = (): void => undefined;
    createBuildersBotLogger("drain-scheduler", silent).info("A queued message waits.", {
      agentId: "agent-1",
      deliveryId: "delivery-1",
      reason: "machine",
      machine: "turn-slots",
    });
    createBuildersBotLogger("agent-service", silent).info("Unrelated.", { agentId: "agent-1" });
    stop();
    const file = join(root, "queue", "queue.log");
    await vi.waitFor(async () => expect(await readFile(file, "utf8")).toContain("A queued message waits."));
    const text = await readFile(file, "utf8");
    expect(text).toContain('"reason":"machine"');
    expect(text).toContain('"machine":"turn-slots"');
    expect(text).not.toContain("Unrelated.");
  });
});
