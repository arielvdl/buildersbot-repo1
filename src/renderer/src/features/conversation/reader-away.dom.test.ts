import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchReaderAway } from "./reader-away";

describe("the report of a reader who is up in older messages", () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.map(String).join(" ")));
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps the reactive system running when the host passes the setter of a signal", () => {
    const [away, setAway] = createSignal(false);
    // A Solid setter returns the value it sets, so `true` is what the report must not hand back to Solid.
    const [folded, setFolded] = createSignal(false);
    const dispose = createRoot((root) => {
      watchReaderAway(away, setFolded);
      return root;
    });

    flush();
    setAway(true);
    flush();
    expect(folded()).toBe(true);
    setAway(false);
    flush();
    expect(folded()).toBe(false);

    expect(errors.filter((line) => line.includes("REACTIVITY_HALTED"))).toEqual([]);
    dispose();
  });

  it("does nothing when the host does not listen", () => {
    const [away, setAway] = createSignal(false);
    const dispose = createRoot((root) => {
      watchReaderAway(away, undefined);
      return root;
    });

    flush();
    setAway(true);
    flush();

    expect(errors).toEqual([]);
    dispose();
  });
});
