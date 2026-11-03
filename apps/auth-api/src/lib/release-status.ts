/**
 * Whether this site can serve a desktop installer.
 *
 * The download route reads the release manifests, and answers "not published here yet" while there
 * are none. The cards on the download page read this flag, so the button never leads to a 404. Flip
 * it together with the first release that carries installers.
 */
export const RELEASES_ARE_PUBLISHED = false;
