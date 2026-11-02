// The environment variables of an installation, a script or a deployment made before the rename.
//
// Every variable is read under `BUILDERSBOT_`. A shell profile, a systemd unit or a deployment that
// still sets `OPENBOT_` keeps working: the value is copied to the new name once, at start, and the
// old name is never read again after this point.

const LEGACY_PREFIX = "OPENBOT_";
const PREFIX = "BUILDERSBOT_";

type Environment = Record<string, string | undefined>;

// The package is also built for the browser, where `process` does not exist.
declare const process: { env: Environment } | undefined;

/** The process environment, or an empty object where there is no process (a browser build). */
export function currentEnvironment(): Environment {
  if (typeof process === "undefined") return {};
  return process.env;
}

/** Copy every legacy variable to its new name, without overwriting a variable already set. */
export function adoptLegacyEnvironment(env: Environment = currentEnvironment()): void {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.startsWith(LEGACY_PREFIX)) continue;
    const current = `${PREFIX}${name.slice(LEGACY_PREFIX.length)}`;
    if (env[current] === undefined) env[current] = value;
  }
}
