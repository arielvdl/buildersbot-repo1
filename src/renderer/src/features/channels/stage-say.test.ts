// The bubble of a stage agent types each new text in. An agent with no real step only changes pose
// (reading, thinking, running) on a beat, and its bubble must not type a new sentence at each beat.
import { stageSayActivity } from "@buildersbot/ui/features/stage/stage-activity";
import { describe, expect, it } from "vitest";
import { idleStagePose } from "./channel-stage-model";

describe("stageSayActivity", () => {
  it("keeps one sentence while an agent with no step changes pose", () => {
    const said = new Set<string>();
    for (let beat = 0; beat < 40; beat += 1) {
      const pose = idleStagePose("agent-a", beat * 2400);
      said.add(stageSayActivity(pose.activity));
    }
    expect(said.size).toBe(1);
  });

  it("keeps the wait, the failure and the finished run as they are", () => {
    for (const activity of ["waiting", "failed", "done"] as const) {
      expect(stageSayActivity(activity)).toBe(activity);
    }
  });
});
