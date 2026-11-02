// Checks the fingerprints of the previous project that are still in the code. Section 1.4 of
// plans/legal/purga-de-autoria.md names the distinctive identifiers: the ones that a reader who
// knows the old code recognises, which a generic name like `agent-store` does not give away. It
// needs no network and sends no request.
//
// The guard is a ratchet, and the list of allowances is meant to shrink until it is empty:
//
// - an occurrence of a fingerprint that no allowance covers fails;
// - an allowance that covers no occurrence also fails, with "delete the entry", so a rename cannot
//   leave a stale line behind that would let the name come back;
// - when the last allowance of a fingerprint goes, the fingerprint must go from FINGERPRINTS too, and
//   from then on the guard refuses the name everywhere.
//
// Markdown, the changelogs, the vendor patches and the lockfiles are out: they are history or
// third-party text, and `license-provenance-guard.ts` owns the prose. This guard owns the code.
//
// The repair, when an occurrence fails:
//   - the name is deliberate and an agent or a file depends on it (an MCP tool prefix, a SQLite
//     table, a module path): add an allowance with the reason, and the phase that renames it;
//   - the name is already renamed: delete the allowance, and the fingerprint entry if it was the last.
//
// Usage: bun scripts/fingerprint-guard.ts
// It writes .buildersbot-build/fingerprint-guard/report.json and exits with 1 when a check fails.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createBuildersBotLogger } from "@buildersbot/logging";

const logger = createBuildersBotLogger("fingerprint-guard");
const ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(ROOT, ".buildersbot-build/fingerprint-guard/report.json");
const GUARD_FILE = "scripts/fingerprint-guard.ts";

/**
 * A distinctive identifier, with where it came from and why it is a fingerprint. The list is an
 * array, not an object, so iterating it needs no type assertion. `pattern` is global and stateful.
 */
const FINGERPRINTS = [
  [
    "buildersbot_metadata",
    /\bbuildersbot_metadata\b/gu,
    "the SQLite table that records the owner of an agent-created table",
  ],
  [
    "buildersbot_browser",
    /buildersbot_browser/gu,
    "the MCP tool prefix and the browser guard corpus: an agent and a saved profile see it",
  ],
  ["buildersbot-database", /buildersbot-database/gu, "the database module path and its schema history"],
  ["buildersbot-tool-router", /buildersbot-tool-router/gu, "the tool router module path"],
  ["damage_probe", /\bdamage_probe\b/gu, "the column that records whether a table survived a damaged database"],
  ["blocker", /[A-Za-z_]*[Bb]locker[A-Za-z_]*/gu, "the restart-blocker concept and its field names"],
  ["pi-client", /pi-client/gu, "the Pi provider client name"],
] as const satisfies ReadonlyArray<readonly [string, RegExp, string]>;

type Fingerprint = (typeof FINGERPRINTS)[number][0];

interface Allowance {
  fingerprint: Fingerprint;
  /** The file the name may stay in. Without it, any file. */
  file?: RegExp;
  /** The shape of the line. Without it, the whole file. */
  line?: RegExp;
  reason: string;
}

/**
 * What may still carry a fingerprint, and why. Each entry names the phase that removes it. The list
 * shrinks: when a line stops matching, delete its entry.
 */
const ALLOWED: readonly Allowance[] = [
  {
    fingerprint: "buildersbot_metadata",
    line: /\bbuildersbot_metadata\b/u,
    reason: "F4: a SQLite table name, persisted in every existing database; renaming needs a migration",
  },
  {
    fingerprint: "buildersbot_browser",
    line: /buildersbot_browser/u,
    reason: "F4: the MCP tool prefix that an agent calls and a saved profile records",
  },
  {
    fingerprint: "buildersbot-database",
    line: /buildersbot-database/u,
    reason: "F4: a module path, imported from 175 files; the rename is one sweep",
  },
  {
    fingerprint: "buildersbot-tool-router",
    line: /buildersbot-tool-router/u,
    reason: "F4: a module path",
  },
  {
    fingerprint: "damage_probe",
    line: /\bdamage_probe\b/u,
    reason: "F4: a column of a released schema",
  },
  {
    fingerprint: "pi-client",
    line: /pi-client/u,
    reason: "F4: the provider client module and its log name",
  },
  // `blocker` is an ordinary English word, so it is allowed file by file: the list is the exact
  // inventory of the debt, and a new file that uses the word is a decision someone has to make.
  ...(
    [
      "apps/mobile/src/features/servers/screens/server-updates-screen.tsx",
      "marketplace/production-catalog/bundles/pstack/skills/poteto-mode/scripts/watch-pr/cli.test.ts",
      "marketplace/production-catalog/bundles/pstack/skills/poteto-mode/scripts/watch-pr/policy.test.ts",
      "marketplace/production-catalog/bundles/pstack/skills/poteto-mode/scripts/watch-pr/policy.ts",
      "marketplace/production-catalog/bundles/pstack/skills/poteto-mode/scripts/watch-pr/render.ts",
      "marketplace/production-catalog/bundles/pstack/skills/poteto-mode/scripts/watch-pr/types.compile.ts",
      "marketplace/production-catalog/bundles/pstack/skills/poteto-mode/scripts/watch-pr/types.ts",
      "marketplace/production-catalog/catalog.json",
      "packages/contracts/src/ipc-app-auth.ts",
      "packages/contracts/src/ipc-storage.ts",
      "packages/contracts/src/team-protocol/host-update-v1.ts",
      "packages/ui/src/features/updates/restart-reasons.ts",
      "scripts/buildersbot-host-service.ts",
      "scripts/mcp-oauth-e2e.ts",
      "scripts/seed-dev-state.ts",
      "scripts/seed-marketplace-agents.ts",
      "scripts/seed-marketplace-skills.ts",
      "scripts/transfer-upload-cleanup-e2e.ts",
      "src/backend/agent/delivery-content.ts",
      "src/backend/agent/developer-instructions.ts",
      "src/backend/browser-cdp.ts",
      "src/backend/buildersbot-database.test.ts",
      "src/backend/channel-routine-scheduler.ts",
      "src/main/application-services.ts",
      "src/main/cleanup-service.test.ts",
      "src/main/cleanup-service.ts",
      "src/main/host-service.ts",
      "src/main/index.ts",
      "src/main/ipc/storage-handlers.ts",
      "src/main/keep-awake.ts",
      "src/main/team-api/route-host-update.ts",
      "src/main/update-readiness.ts",
      "src/renderer/src/features/files/StorageCleanup.tsx",
      "src/renderer/src/features/web-client/WebApp.tsx",
      "src/renderer/src/preview/landing-demo-scripts.ts",
      "src/renderer/src/preview/landing-fixtures.ts",
    ] as const
  ).map((file) => ({
    fingerprint: "blocker" as const,
    file: new RegExp(`^${file.replaceAll(".", "\\.")}$`, "u"),
    reason: "F4: the word 'blocker' in the restart and cleanup vocabulary",
  })),
];

interface Occurrence {
  file: string;
  line: number;
  fingerprint: Fingerprint;
  text: string;
  allowed: string | null;
}

interface CheckResult {
  name: string;
  passed: boolean;
  details: unknown;
}

const checks: CheckResult[] = [];
const occurrences: Occurrence[] = [];
const stale: string[] = [];

async function check(name: string, run: () => unknown): Promise<void> {
  try {
    checks.push({ name, passed: true, details: (await run()) ?? null });
  } catch (error) {
    checks.push({ name, passed: false, details: error instanceof Error ? error.message : String(error) });
  }
}

function fail(message: string): never {
  throw new Error(message);
}

const BINARY_FILE =
  /\.(?:png|jpe?g|gif|webp|ico|icns|car|svg|woff2?|ttf|otf|mp3|wav|webm|mp4|zip|gz|tgz|pdf|node|wasm|lock)$/iu;
const HISTORY_FILE =
  /(?:^|\/)(?:node_modules|vendor)\/|^patches\/|^plans\/legal\/|\.mdx?$|^native-runtime\.lock\.json$|^CHANGELOG\.md$/u;

/** The tracked and the new (not ignored) files of the repository, relative to its root. */
function repositoryFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return [...new Set(output.split("\0").filter(Boolean))].filter((file) => existsSync(resolve(ROOT, file)));
}

function allowedReason(file: string, fingerprint: Fingerprint, text: string): string | null {
  const entry = ALLOWED.find(
    (allowance) =>
      allowance.fingerprint === fingerprint &&
      (allowance.file === undefined || allowance.file.test(file)) &&
      (allowance.line === undefined || allowance.line.test(text)),
  );
  return entry?.reason ?? null;
}

function findOccurrences(file: string, content: string): Occurrence[] {
  const lines = content.split("\n");
  return lines.flatMap((text, index) =>
    FINGERPRINTS.flatMap(([fingerprint, pattern]) =>
      [...text.matchAll(pattern)].map(() => ({
        file,
        line: index + 1,
        fingerprint,
        text: text.trim(),
        allowed: allowedReason(file, fingerprint, text),
      })),
    ),
  );
}

const files = repositoryFiles().filter(
  (file) => !BINARY_FILE.test(file) && !HISTORY_FILE.test(file) && file !== GUARD_FILE,
);

await check("no fingerprint appears outside the allow-list", () => {
  const found = files.flatMap((file) => {
    let content: string;
    try {
      content = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      return [];
    }
    return findOccurrences(file, content);
  });
  occurrences.push(...found);
  const refused = found.filter((occurrence) => occurrence.allowed === null);
  if (refused.length > 0) {
    fail(
      [
        `${refused.length} fingerprint line${refused.length === 1 ? "" : "s"} outside the allow-list:`,
        ...refused.map(
          (occurrence) => `  ${occurrence.file}:${occurrence.line} ${occurrence.fingerprint}: ${occurrence.text}`,
        ),
        "",
        "Repair:",
        "  - it must stay because something depends on it: add an allowance with the phase that",
        "    renames it (a SQLite table, an MCP tool prefix and a module path each need a migration);",
        "  - it is already renamed: delete the allowance, and the FINGERPRINTS entry if it was the last.",
      ].join("\n"),
    );
  }
  return { searched: files.length, allowed: found.length };
});

await check("no allowance is stale: each one still covers a line", () => {
  for (const allowance of ALLOWED) {
    const covered = occurrences.some(
      (occurrence) =>
        occurrence.fingerprint === allowance.fingerprint &&
        (allowance.file === undefined || allowance.file.test(occurrence.file)) &&
        (allowance.line === undefined || allowance.line.test(occurrence.text)),
    );
    if (!covered) {
      const where = allowance.file === undefined ? "any file" : String(allowance.file);
      stale.push(`${allowance.fingerprint} in ${where}`);
    }
  }
  if (stale.length > 0) {
    fail(
      [
        `${stale.length} allowance${stale.length === 1 ? "" : "s"} cover no line, so the name can come back unnoticed:`,
        ...stale.map((entry) => `  ${entry}`),
        "",
        "Delete the entry. If it was the last of its fingerprint, delete the FINGERPRINTS entry too:",
        "the guard then refuses the name everywhere, which is the point of the list shrinking.",
      ].join("\n"),
    );
  }
  return { allowances: ALLOWED.length };
});

await check("each fingerprint has an allowance, and each allowance names a known fingerprint", () => {
  const known = FINGERPRINTS.map(([name]) => name);
  const unknown = ALLOWED.filter((allowance) => !known.includes(allowance.fingerprint));
  if (unknown.length > 0)
    fail(`Allowances of unknown fingerprints: ${unknown.map((entry) => entry.fingerprint).join(", ")}.`);
  const missing = known.filter((fingerprint) => !ALLOWED.some((allowance) => allowance.fingerprint === fingerprint));
  if (missing.length > 0) fail(`Fingerprints with no allowance: ${missing.join(", ")}.`);
  const empty = ALLOWED.filter((allowance) => allowance.reason.trim() === "");
  if (empty.length > 0) fail(`${empty.length} allowances have no reason.`);
  return { fingerprints: known.length, allowances: ALLOWED.length };
});

const passed = checks.every((entry) => entry.passed);
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(
  REPORT_PATH,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), passed, checks, stale, occurrences }, null, 2)}\n`,
);
for (const entry of checks) {
  logger.info(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
  if (!entry.passed) logger.error(String(entry.details));
}
logger.info(`${FINGERPRINTS.length} fingerprints, ${ALLOWED.length} allowances: the list shrinks until it is empty.`);
logger.info(`Wrote ${relative(ROOT, REPORT_PATH)}.`);
if (!passed) process.exitCode = 1;
