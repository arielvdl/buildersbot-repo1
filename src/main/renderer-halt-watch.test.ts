// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { watchRendererHalt } from "./renderer-halt-watch";

function harness() {
  let clock = 1_000_000;
  const timers: (() => void)[] = [];
  const emitter = new EventEmitter();
  const reload = vi.fn();
  let destroyed = false;
  watchRendererHalt(
    {
      on: (event, listener) => emitter.on(event, listener),
      reload,
      isDestroyed: () => destroyed,
    },
    {
      now: () => clock,
      setTimeout: (callback) => timers.push(callback),
    },
  );
  return {
    message: (text: string) => emitter.emit("console-message", { message: text }),
    runTimers: () => {
      for (const callback of timers.splice(0)) callback();
    },
    advance: (ms: number) => {
      clock += ms;
    },
    destroy: () => {
      destroyed = true;
    },
    reload,
  };
}

describe("watchRendererHalt", () => {
  it("ignores other console lines", () => {
    const view = harness();
    view.message("[REACTIVITY_WARNING] something");
    view.runTimers();
    expect(view.reload).not.toHaveBeenCalled();
  });

  it("loads the window again after a halt", () => {
    const view = harness();
    view.message("[REACTIVITY_HALTED]");
    expect(view.reload).not.toHaveBeenCalled();
    view.runTimers();
    expect(view.reload).toHaveBeenCalledTimes(1);
  });

  it("makes repeated halt lines before the reload one reload", () => {
    const view = harness();
    view.message("[REACTIVITY_HALTED]");
    view.message("[REACTIVITY_HALTED] Update ignored");
    view.runTimers();
    expect(view.reload).toHaveBeenCalledTimes(1);
  });

  it("does not load the window in a loop", () => {
    const view = harness();
    view.message("[REACTIVITY_HALTED]");
    view.runTimers();
    view.advance(60_000);
    view.message("[REACTIVITY_HALTED]");
    view.runTimers();
    expect(view.reload).toHaveBeenCalledTimes(1);
    view.advance(5 * 60_000);
    view.message("[REACTIVITY_HALTED]");
    view.runTimers();
    expect(view.reload).toHaveBeenCalledTimes(2);
  });

  it("does not load a destroyed window", () => {
    const view = harness();
    view.message("[REACTIVITY_HALTED]");
    view.destroy();
    view.runTimers();
    expect(view.reload).not.toHaveBeenCalled();
  });
});
