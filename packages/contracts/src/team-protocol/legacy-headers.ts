// The header names of a client, a host or a Worker made before the rename.
//
// A receiver reads the new name first and this one second, so an installation that was not updated
// yet keeps working. A sender writes both. The names stay here, out of the code, because they hold a
// space and a header name cannot.

/** The signature pair of a service request. */
export const SERVICE_TIMESTAMP_LEGACY = "BuildersBot-Timestamp";
export const SERVICE_SIGNATURE_LEGACY = "BuildersBot-Signature";

/** The logo version that a host sends with an upload. */
export const LOGO_VERSION_LEGACY = "BuildersBot-Logo-Version";

/** The session of the WebRTC transport of a host. */
export const WEBRTC_SESSION_LEGACY = "BuildersBot-WebRTC-Session";
