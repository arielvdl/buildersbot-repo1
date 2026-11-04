// The bubble of a stage agent closes to a pill and opens again only when what it says changes. An agent with
// no step changes pose on a beat with the same sentence, and that must not play the pill again and again.
import { render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { StageBubble } from "../../../../../packages/ui/src/features/stage/StageBubble";

describe("StageBubble", () => {
  it("does not close to the pill when the status changes and the sentence stays", () => {
    const [activity, setActivity] = createSignal("thinking");
    render(() => <StageBubble activity={activity()} tone={null} sentence="Thinking." />);
    const bubble = screen.getByText("Thinking.").closest("[data-tone]");
    expect(bubble).not.toBeNull();
    for (const pose of ["reading", "thinking", "running", "thinking"]) {
      setActivity(pose);
      flush();
      expect(bubble?.hasAttribute("data-morph")).toBe(false);
      expect(bubble?.getAttribute("data-tone")).toBe(pose);
    }
    expect(screen.getByText("Thinking.")).toBeTruthy();
  });
});
