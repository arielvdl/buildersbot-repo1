import { type GuardState, isGuardState } from "@buildersbot/contracts/ipc";
import { guardedDecoder } from "@buildersbot/contracts/ipc-decoding";

/** The Guard state that main sends: the level, the reviewer model, and whether that model can run now. */
export const decodeGuardState: (value: unknown) => GuardState = guardedDecoder(isGuardState, "Guard state");
