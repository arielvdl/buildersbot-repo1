import type { CentralAuthState } from "@buildersbot/contracts/ipc";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./account-context";
import type { AccountPort } from "./account-port";

const SIGNED_IN: CentralAuthState = {
  status: "signed_in",
  user: { id: "user-1", email: "owner@example.com", name: "Owner", avatarUrl: null },
};
const OTHER_ACCOUNT: CentralAuthState = {
  status: "signed_in",
  user: { id: "user-2", email: "other@example.com", name: "Other", avatarUrl: null },
};
/** What main gives when the account service does not answer. The sign-in screen offers Try again. */
const SERVICE_OUTAGE: CentralAuthState = {
  status: "error",
  issue: { code: "auth_api_unavailable", message: "The account service is not available." },
};
/** How an IPC call fails when main has no handler for it yet. */
const NO_HANDLER = new Error("No handler registered for 'auth:get-state'");

type AuthPort = Pick<AccountPort["auth"], "getState" | "onEvent">;

/** Mounts the account context on a port that answers each read with the next entry of `reads`. */
function mount(reads: Array<() => Promise<CentralAuthState>>) {
  let emit: (state: CentralAuthState) => void = () => undefined;
  const getState = vi.fn(() => {
    const next = reads.shift();
    if (!next) throw new Error("No more account reads were expected.");
    return next();
  });
  const port: AuthPort = {
    getState,
    onEvent: (listener) => {
      emit = listener;
      return () => undefined;
    },
  };
  Object.defineProperty(window, "buildersbot", { value: { auth: port }, configurable: true });
  let auth: ReturnType<typeof useAuth> | undefined;
  function Probe() {
    auth = useAuth();
    return null;
  }
  const { unmount } = render(() => (
    <AuthProvider>
      <Probe />
    </AuthProvider>
  ));
  if (!auth) throw new Error("The account context was not created.");
  return { auth, getState, unmount, emit: (state: CentralAuthState) => emit(state) };
}

/** Reads that main cannot answer: the first one and each retry the context makes before it shows the error. */
const STARTUP_FAILURES = 5;
const RETRY_WINDOW_MS = 7_500;

function noHandler(count: number): Array<() => Promise<CentralAuthState>> {
  return Array.from({ length: count }, () => () => Promise.reject(NO_HANDLER));
}

function showWindow(): void {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function issueCode(state: CentralAuthState): string | null {
  return state.status === "error" ? state.issue.code : null;
}

describe("the account bootstrap read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays on loading while main has no handler yet, then takes the account without passing through an error", async () => {
    const { auth, getState } = mount([...noHandler(2), () => Promise.resolve(SIGNED_IN)]);
    const seen: string[] = [];
    // The context writes the state signal; sample it on every step of the clock.
    const sample = () => seen.push(auth.centralAuth().status);
    sample();
    for (let step = 0; step < 40; step += 1) {
      await vi.advanceTimersByTimeAsync(100);
      sample();
    }

    expect(getState).toHaveBeenCalledTimes(3);
    expect(auth.centralAuth()).toEqual(SIGNED_IN);
    expect(new Set(seen)).toEqual(new Set(["loading", "signed_in"]));
  });

  it("shows the error only after the last retry fails", async () => {
    const { auth, getState } = mount(noHandler(STARTUP_FAILURES));

    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS - 1);
    expect(auth.centralAuth().status).toBe("loading");

    await vi.advanceTimersByTimeAsync(1);
    expect(issueCode(auth.centralAuth())).toBe("auth_unavailable");
    expect(getState).toHaveBeenCalledTimes(STARTUP_FAILURES);

    // The reads stop: no timer is left to read again.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getState).toHaveBeenCalledTimes(STARTUP_FAILURES);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the retries when an account event arrives", async () => {
    const { auth, getState, emit } = mount(noHandler(STARTUP_FAILURES));
    await vi.advanceTimersByTimeAsync(600);
    expect(getState).toHaveBeenCalledTimes(2);

    emit(SIGNED_IN);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(auth.centralAuth()).toEqual(SIGNED_IN);
    expect(getState).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer when the window closes during the retries", async () => {
    const { getState, unmount } = mount(noHandler(STARTUP_FAILURES));
    await vi.advanceTimersByTimeAsync(600);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it("reads the account again when the window gets focus after a read that main could not answer", async () => {
    const { auth, getState } = mount([...noHandler(STARTUP_FAILURES), () => Promise.resolve(SIGNED_IN)]);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    expect(issueCode(auth.centralAuth())).toBe("auth_unavailable");

    window.dispatchEvent(new Event("focus"));

    await vi.waitFor(() => expect(auth.centralAuth()).toEqual(SIGNED_IN));
    expect(getState).toHaveBeenCalledTimes(STARTUP_FAILURES + 1);
  });

  it("keeps the error while main cannot answer, then shows the outage that main reports", async () => {
    const { auth, getState } = mount([...noHandler(STARTUP_FAILURES + 1), () => Promise.resolve(SERVICE_OUTAGE)]);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    expect(issueCode(auth.centralAuth())).toBe("auth_unavailable");

    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(getState).toHaveBeenCalledTimes(STARTUP_FAILURES + 1));
    expect(issueCode(auth.centralAuth())).toBe("auth_unavailable");

    // The window shows again after the second read failed. Main answers now, and its outage is not hidden.
    await vi.waitFor(() => {
      showWindow();
      expect(getState).toHaveBeenCalledTimes(STARTUP_FAILURES + 2);
    });
    await vi.waitFor(() => expect(auth.centralAuth()).toEqual(SERVICE_OUTAGE));

    // An answer stops the reads: the user tries the outage again with its own button.
    window.dispatchEvent(new Event("focus"));
    showWindow();
    expect(getState).toHaveBeenCalledTimes(STARTUP_FAILURES + 2);
  });

  it("does not replace an account event with a read that answers after it", async () => {
    let answerLate: (state: CentralAuthState) => void = () => undefined;
    const lateRead = new Promise<CentralAuthState>((resolve) => {
      answerLate = resolve;
    });
    const { auth, getState, emit } = mount([...noHandler(STARTUP_FAILURES), () => lateRead]);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    expect(issueCode(auth.centralAuth())).toBe("auth_unavailable");

    window.dispatchEvent(new Event("focus"));
    expect(getState).toHaveBeenCalledTimes(STARTUP_FAILURES + 1);
    emit(OTHER_ACCOUNT);
    answerLate(SIGNED_IN);
    // The context reads the late answer before this line continues: it subscribed first.
    await lateRead;

    expect(auth.centralAuth()).toEqual(OTHER_ACCOUNT);
  });
});
