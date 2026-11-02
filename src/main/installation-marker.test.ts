import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginInstallation, installationMarkerPath } from "./installation-marker";

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "buildersbot-installation-"));
  roots.push(path);
  return path;
}

function appDataWithUserData(): { appDataPath: string; userDataPath: string } {
  const appDataPath = root();
  const userDataPath = join(appDataPath, "Builders Bot");
  mkdirSync(userDataPath, { recursive: true });
  return { appDataPath, userDataPath };
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("installationMarkerPath", () => {
  it("puts the marker beside the app data folder, keyed by that folder", () => {
    const { appDataPath, userDataPath } = appDataWithUserData();
    const marker = installationMarkerPath(appDataPath, userDataPath);

    expect(dirname(marker)).toBe(appDataPath);
    expect(basename(marker)).toMatch(/^\.buildersbot-installation-[0-9a-f]{16}\.json$/u);
  });

  it("gives two folders of one computer different markers", () => {
    const { appDataPath, userDataPath } = appDataWithUserData();

    expect(installationMarkerPath(appDataPath, userDataPath)).not.toBe(
      installationMarkerPath(appDataPath, `${userDataPath} Dev`),
    );
  });

  it("keeps the marker inside a folder that is not in the app data root", () => {
    const outside = join(root(), "profile");
    const marker = installationMarkerPath(join(root(), "appData"), outside);

    expect(marker).toBe(join(outside, ".buildersbot-installation-started.json"));
  });
});

describe("beginInstallation", () => {
  it("is the first start of a new installation and removes the previous sign-in", () => {
    const { appDataPath, userDataPath } = appDataWithUserData();
    const session = join(userDataPath, "buildersbot-central-auth-v1.bin");
    writeFileSync(session, "previous");

    const start = beginInstallation({
      appDataPath,
      userDataPath,
      previousInstallationFiles: [session],
      now: () => 1_700_000_000_000,
      newId: () => "installation-1",
    });

    expect(start).toEqual({ fresh: true });
    expect(readFileSync(installationMarkerPath(appDataPath, userDataPath), "utf8")).toBe(
      JSON.stringify({ version: 1, id: "installation-1", startedAt: 1_700_000_000_000 }),
    );
    expect(() => readFileSync(session)).toThrow();
  });

  it("keeps the sign-in of a later start of the same installation", () => {
    const { appDataPath, userDataPath } = appDataWithUserData();
    const session = join(userDataPath, "buildersbot-central-auth-v1.bin");
    writeFileSync(session, "previous");
    const options = { appDataPath, userDataPath, previousInstallationFiles: [session] };
    beginInstallation(options);
    writeFileSync(session, "current");

    expect(beginInstallation(options)).toEqual({ fresh: false });
    expect(readFileSync(session, "utf8")).toBe("current");
  });

  it.skipIf(process.getuid?.() === 0)("keeps the sign-in when the marker cannot be written", () => {
    const { appDataPath, userDataPath } = appDataWithUserData();
    const session = join(userDataPath, "buildersbot-central-auth-v1.bin");
    writeFileSync(session, "previous");
    chmodSync(appDataPath, 0o500);

    try {
      const start = beginInstallation({ appDataPath, userDataPath, previousInstallationFiles: [session] });

      expect(start.fresh).toBe(false);
      expect(start.error).toBeInstanceOf(Error);
      expect(readFileSync(session, "utf8")).toBe("previous");
    } finally {
      chmodSync(appDataPath, 0o700);
    }
  });
});
