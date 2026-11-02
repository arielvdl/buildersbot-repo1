import {
  type BuildersBotDesktopApi,
  type ChannelTabOutcome,
  type ChannelTabReport,
  type ChannelTabReportsInput,
  LOCAL_SERVER_ID,
} from "@buildersbot/contracts/ipc";
import type {
  ProfileTabReportsPeriod,
  ProfileTabReportsState,
} from "@buildersbot/ui/features/settings/ProfileTabReports";
import { errorReference } from "@buildersbot/user-errors";
import { createEffect, createStore, untrack } from "solid-js";

/**
 * What the Profile reaches in main. Read on each call, as the usage port is: tests and stories replace
 * `window.buildersbot` per case. The desktop only has these calls, so the web usage port stays as it is.
 */
function tabReportsPort(): Pick<BuildersBotDesktopApi["agent"], "listChannelTabReports" | "deleteChannelTabReport"> {
  return window.buildersbot.agent;
}

/** The days that each period covers, today included. 12 months is 365 days, under the 366 that the host accepts. */
const PERIOD_DAYS = { week: 7, month: 30, year: 365 } as const satisfies Record<ProfileTabReportsPeriod, number>;
/** What a person sees by default (decision D1): the last 30 days. */
const DEFAULT_PERIOD: ProfileTabReportsPeriod = "month";

/** From the start of the first day to the start of tomorrow, both on this computer's clock, as UTC instants. */
function periodRange(
  period: ProfileTabReportsPeriod,
  now = new Date(),
): Pick<ChannelTabReportsInput, "since" | "until"> {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PERIOD_DAYS[period] - 1));
  const until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { since: since.toISOString(), until: until.toISOString() };
}

/**
 * The closed tabs that the Profile lists. It reads the first page when the Profile shows and when the
 * period changes, and the next page when the person asks for more. It listens to no event: a tab that
 * closes while the Profile shows appears on the next visit. The records on screen stay in memory
 * after the Profile closes, and no call runs until it shows again.
 */
export function createProfileTabReportsStore(
  isActive: () => boolean,
  /** Opens a new tab for a record. Without it, the records have no Continue button. */
  continuation?: Pick<ProfileTabReportsState, "continueBlocked" | "onContinue"> | undefined,
): ProfileTabReportsState {
  const [state, setState] = createStore<{
    phase: ProfileTabReportsState["phase"];
    period: ProfileTabReportsPeriod;
    totals: Record<ChannelTabOutcome, number> | null;
    reports: ChannelTabReport[];
    nextCursor: string | null;
    loadingMore: boolean;
    errorReference: string | null;
  }>({
    phase: "loading",
    period: DEFAULT_PERIOD,
    totals: null,
    reports: [],
    nextCursor: null,
    loadingMore: false,
    errorReference: null,
  });
  /** The period of the pages on screen, fixed while they load, so each cursor reads the same range. */
  let range = periodRange(DEFAULT_PERIOD);
  let generation = 0;

  /** The first page of the period. What is on screen stays while a later read of the same period runs. */
  async function load(fresh: boolean): Promise<void> {
    const request = ++generation;
    const period = untrack(() => state.period);
    const background = !fresh && untrack(() => state.totals !== null);
    range = periodRange(period);
    setState((draft) => {
      draft.loadingMore = false;
      if (background) return;
      draft.phase = "loading";
      draft.totals = null;
      draft.reports = [];
      draft.nextCursor = null;
      draft.errorReference = null;
    });
    try {
      const page = await tabReportsPort().listChannelTabReports(range, LOCAL_SERVER_ID);
      if (request !== generation) return;
      setState((draft) => {
        draft.phase = page ? "ready" : "unsupported";
        draft.totals = page?.totals ?? null;
        draft.reports = page?.reports ?? [];
        draft.nextCursor = page?.nextCursor ?? null;
        draft.errorReference = null;
      });
    } catch (error) {
      // A failed refresh keeps the records on screen; the next visit tries again.
      if (request !== generation || background) return;
      setState((draft) => {
        draft.phase = "error";
        draft.errorReference = errorReference(error);
      });
    }
  }

  async function loadMore(): Promise<void> {
    const cursor = untrack(() => state.nextCursor);
    if (!cursor || untrack(() => state.loadingMore)) return;
    const request = generation;
    setState((draft) => {
      draft.loadingMore = true;
    });
    try {
      const page = await tabReportsPort().listChannelTabReports({ ...range, cursor }, LOCAL_SERVER_ID);
      if (request !== generation) return;
      setState((draft) => {
        draft.reports.push(...(page?.reports ?? []));
        draft.nextCursor = page?.nextCursor ?? null;
        draft.loadingMore = false;
      });
    } catch (error) {
      if (request !== generation) return;
      setState((draft) => {
        draft.loadingMore = false;
        draft.phase = "error";
        draft.errorReference = errorReference(error);
      });
    }
  }

  // Leaving the Profile ends a read in flight. The records stay for the next visit, which reads them again.
  createEffect(isActive, (active) => {
    if (!active) {
      generation++;
      return;
    }
    void load(false);
  });

  return {
    get phase() {
      return state.phase;
    },
    get period() {
      return state.period;
    },
    get totals() {
      return state.totals;
    },
    get reports() {
      return state.reports;
    },
    get hasMore() {
      return state.nextCursor !== null;
    },
    get loadingMore() {
      return state.loadingMore;
    },
    get errorReference() {
      return state.errorReference;
    },
    onPeriodChange: (period) => {
      if (period === untrack(() => state.period)) return;
      setState((draft) => {
        draft.period = period;
      });
      void load(true);
    },
    continueBlocked: continuation?.continueBlocked,
    onContinue: continuation?.onContinue,
    onLoadMore: () => void loadMore(),
    onRetry: () => void load(true),
    onDelete: async (id) => {
      try {
        const removed = await tabReportsPort().deleteChannelTabReport({ id }, LOCAL_SERVER_ID);
        if (removed === null) return false;
        // The totals come from the host, so the first page is read again; the list on screen stays until it arrives.
        void load(false);
        return true;
      } catch {
        return false;
      }
    },
  };
}
