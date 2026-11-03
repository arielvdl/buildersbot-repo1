// The custom scheme that opens the app. Links are built with `buildersbot:`. The reader also takes the
// scheme an installation made before the rename registered, so a link that is already in a message or
// in a bookmark still opens this build.

/** The scheme of the links this build makes. */
export const APP_SCHEME = "buildersbot:";

/** The scheme the previous name registered. Read-only: nothing new is built with it. */
export const LEGACY_APP_SCHEME = "openbot:";

/** Whether a parsed URL uses the app scheme, current or the one already installed. */
export function isAppScheme(protocol: string): boolean {
  return protocol === APP_SCHEME || protocol === LEGACY_APP_SCHEME;
}
