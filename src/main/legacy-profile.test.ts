import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { carryOverLegacyProfile, legacyProfilePath } from "./legacy-profile";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "bb-legacy-profile-"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function legacyWith(files: Record<string, string>): string {
  const legacy = legacyProfilePath(base);
  for (const [name, content] of Object.entries(files)) {
    const path = join(legacy, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return legacy;
}

describe("legacyProfilePath", () => {
  it("names the folder under the application-data folder", () => {
    expect(legacyProfilePath("/data")).toBe("/data/OpenBot");
  });
});

describe("carryOverLegacyProfile", () => {
  it("does nothing when the previous name left no profile", () => {
    const to = join(base, "Builders Bot");
    expect(carryOverLegacyProfile(legacyProfilePath(base), to)).toMatchObject({
      carried: false,
      reason: "no-legacy-profile",
    });
    expect(existsSync(to)).toBe(false);
  });

  it("keeps a profile that already exists", () => {
    const from = legacyWith({ "buildersbot.db": "old" });
    const to = join(base, "Builders Bot");
    mkdirSync(to);
    writeFileSync(join(to, "buildersbot.db"), "new");

    expect(carryOverLegacyProfile(from, to)).toMatchObject({ carried: false, reason: "profile-exists" });
    expect(readFileSync(join(to, "buildersbot.db"), "utf8")).toBe("new");
  });

  it("copies the whole tree, including nested folders", () => {
    const from = legacyWith({ "buildersbot.db": "data", "agents/ana/AGENTS.md": "instructions" });
    const to = join(base, "Builders Bot");

    expect(carryOverLegacyProfile(from, to)).toMatchObject({ carried: true, reason: "carried" });
    expect(readFileSync(join(to, "buildersbot.db"), "utf8")).toBe("data");
    expect(readFileSync(join(to, "agents/ana/AGENTS.md"), "utf8")).toBe("instructions");
  });

  it("leaves the run files and the old lock behind", () => {
    const from = legacyWith({ "preferences.json": "{}", SingletonLock: "host-1", "logs/main.log": "line" });
    const to = join(base, "Builders Bot");

    carryOverLegacyProfile(from, to);
    expect(existsSync(join(to, "preferences.json"))).toBe(true);
    expect(existsSync(join(to, "SingletonLock"))).toBe(false);
    expect(existsSync(join(to, "logs"))).toBe(false);
  });

  it("records where the profile came from", () => {
    const from = legacyWith({ "preferences.json": "{}" });
    const to = join(base, "Builders Bot");

    carryOverLegacyProfile(from, to);
    expect(JSON.parse(readFileSync(join(to, "legacy-profile.json"), "utf8"))).toMatchObject({ carriedFrom: from });
  });

  it("keeps the old folder so a rollback still finds it", () => {
    const from = legacyWith({ "buildersbot.db": "data" });
    carryOverLegacyProfile(from, join(base, "Builders Bot"));
    expect(existsSync(join(from, "buildersbot.db"))).toBe(true);
  });

  it("reports a failed copy instead of throwing", () => {
    const from = legacyWith({ "buildersbot.db": "data" });
    writeFileSync(join(base, "not-a-folder"), "");
    const to = join(base, "not-a-folder", "Builders Bot");

    expect(carryOverLegacyProfile(from, to)).toMatchObject({ carried: false, reason: "failed" });
  });
});
