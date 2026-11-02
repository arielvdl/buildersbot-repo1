// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_FILE, LEGACY_DATABASE_FILE, migrateLegacyDatabase } from "./legacy-database-file";

// Failure modes: a new empty database starts beside the old one (account and agents lost); the
// write-ahead log is left behind under the old name; the old file wins over a database that exists.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function profile(): string {
  const root = mkdtempSync(join(tmpdir(), "buildersbot-legacy-database-"));
  roots.push(root);
  return root;
}

describe("migrateLegacyDatabase", () => {
  it("renames the database and its journal files", () => {
    const root = profile();
    writeFileSync(join(root, LEGACY_DATABASE_FILE), "database");
    writeFileSync(join(root, `${LEGACY_DATABASE_FILE}-wal`), "wal");
    writeFileSync(join(root, `${LEGACY_DATABASE_FILE}-shm`), "shm");

    migrateLegacyDatabase(root);

    expect(readFileSync(join(root, DATABASE_FILE), "utf8")).toBe("database");
    expect(readFileSync(join(root, `${DATABASE_FILE}-wal`), "utf8")).toBe("wal");
    expect(readFileSync(join(root, `${DATABASE_FILE}-shm`), "utf8")).toBe("shm");
    expect(existsSync(join(root, LEGACY_DATABASE_FILE))).toBe(false);
  });

  it("keeps a database that already exists under the new name", () => {
    const root = profile();
    writeFileSync(join(root, LEGACY_DATABASE_FILE), "old");
    writeFileSync(join(root, DATABASE_FILE), "current");

    migrateLegacyDatabase(root);

    expect(readFileSync(join(root, DATABASE_FILE), "utf8")).toBe("current");
    expect(readFileSync(join(root, LEGACY_DATABASE_FILE), "utf8")).toBe("old");
  });

  it("does nothing on a profile with no old database", () => {
    const root = profile();
    mkdirSync(join(root, "logs"));
    migrateLegacyDatabase(root);
    expect(existsSync(join(root, DATABASE_FILE))).toBe(false);
  });
});
