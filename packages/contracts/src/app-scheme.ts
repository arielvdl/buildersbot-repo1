// The custom scheme that opens the app, and the one of an installation made before the rename.
//
// The new links are built with `buildersbot:` and every parser also takes `buildersbot:`, because a link
// that a person shared before the rename still sits in a chat, an e-mail or a page. Only the reader
// needs the old name: nothing builds an `buildersbot:` link any more.

/** The scheme of the links this build makes. */
export const APP_SCHEME = "buildersbot:";
/** The same scheme of a link made before the rename. */
export const APP_SCHEME_LEGACY = "buildersbot:";

/** Whether a parsed URL uses the app scheme, under either name. */
export function isAppScheme(protocol: string): boolean {
  return protocol === APP_SCHEME || protocol === APP_SCHEME_LEGACY;
}
