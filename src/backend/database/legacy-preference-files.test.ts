// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyPreferenceFiles } from "./legacy-preference-files";

// Failure modes: a preference file keeps the old name and the app starts on defaults; a file that
// already exists under the new name is overwritten by the old one.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function profile(): string {
  const root = mkdtempSync(join(tmpdir(), "buildersbot-legacy-preferences-"));
  roots.push(root);
  return root;
}

describe("migrateLegacyPreferenceFiles", () => {
  it("renames every preference file of the old prefix", () => {
    const root = profile();
    writeFileSync(join(root, "buildersbot-setup-v2.json"), "setup");
    writeFileSync(join(root, "buildersbot-browser-state-v1.json"), "state");

    migrateLegacyPreferenceFiles(root);

    expect(readFileSync(join(root, "buildersbot-setup-v2.json"), "utf8")).toBe("setup");
    expect(readFileSync(join(root, "buildersbot-browser-state-v1.json"), "utf8")).toBe("state");
    expect(existsSync(join(root, "buildersbot-setup-v2.json"))).toBe(false);
  });

  it("keeps a file that already exists under the new name", () => {
    const root = profile();
    writeFileSync(join(root, "buildersbot-update-preference-v1.json"), "old");
    writeFileSync(join(root, "buildersbot-update-preference-v1.json"), "current");

    migrateLegacyPreferenceFiles(root);

    expect(readFileSync(join(root, "buildersbot-update-preference-v1.json"), "utf8")).toBe("current");
  });

  it("leaves other files and a missing folder alone", () => {
    const root = profile();
    writeFileSync(join(root, "settings.json"), "{}");
    migrateLegacyPreferenceFiles(root);
    migrateLegacyPreferenceFiles(join(root, "missing"));
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("{}");
  });
});
