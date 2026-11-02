// The custom scheme that opens the app. Links are built with `buildersbot:` and the reader takes only it.

/** The scheme of the links this build makes. */
export const APP_SCHEME = "buildersbot:";

/** Whether a parsed URL uses the app scheme. */
export function isAppScheme(protocol: string): boolean {
  return protocol === APP_SCHEME;
}
