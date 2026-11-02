import type { DynamicRecord } from "@buildersbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import { toolProgress, toolProgressText } from "./thread-items";

const step = (type: string, extra: DynamicRecord = {}) => ({ id: "i1", type, ...extra });

describe("the kind of a tool progress line", () => {
  it("is chosen with the text", () => {
    expect(toolProgress(step("fileChange"), false)).toEqual({ detail: "Making the requested changes…", kind: "write" });
    expect(toolProgress(step("webSearch"), false)?.kind).toBe("search");
    expect(toolProgress(step("toolCall", { name: "read_file" }), false)?.kind).toBe("read");
    expect(toolProgress(step("toolCall", { name: "run_tests" }), false)?.kind).toBe("check");
    expect(toolProgress(step("toolCall", { name: "send_message" }), false)?.kind).toBe("coordinate");
    expect(toolProgress(step("toolCall", { name: "zzz" }), false)?.kind).toBe("other");
  });

  it("never carries the command", () => {
    const progress = toolProgress(step("commandExecution", { command: "cat secrets.env" }), false);
    expect(JSON.stringify(progress)).not.toContain("secrets");
  });

  it("keeps toolProgressText the same", () => {
    expect(toolProgressText(step("fileChange"), true)).toBe("Reviewing the changes I made…");
    expect(toolProgress({ id: "x", type: "agentMessage" }, false)).toBeNull();
  });
});
