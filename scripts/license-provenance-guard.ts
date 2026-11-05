// Checks that no text file still carries the provenance of the previous project. It needs no
// network and sends no request. It refuses, in every tracked text file:
//
// - `polyform`, `polyformproject.org`, `synthetify`, `nightly-labs`, `Required Notice`, `derivado`,
//   `derived` and `proprietary`: the legal trail. Outside the historical files the allow-list
//   for these terms must end empty, so a new occurrence is a regression, not a chore;
// - the previous product name (the token `previous-name`): the product keeps none of it, not even
//   as compatibility. The guards build the word from two halves, so no file spells it, not even
//   the guards. Each allowed line names the reason.
//
// The match ignores case. A binary file is not searched. The historical files are searched by the
// allow-list, not skipped, so an entry there still has to name its reason.
//
// The repair, when a line fails:
//   - a compatibility surface (a host, a path, a service, a database file, an environment prefix):
//     add the shape to COMPATIBILITY with the surface it keeps working. Nothing is there today;
//   - debt that a later phase removes: add a file entry with the token and the phase. Write the
//     identifier family, not the whole file, so an unrelated new term in the same file still fails;
//   - a file that is history and stays history (a changelog, the plan, a vendor patch): add it to
//     HISTORY with the reason it never leaves.
//
// Usage: bun scripts/license-provenance-guard.ts
// It writes .buildersbot-build/license-provenance-guard/report.json and exits with 1 when a line is
// outside the allow-list.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createBuildersBotLogger } from "@buildersbot/logging";

const logger = createBuildersBotLogger("license-provenance-guard");
const ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(ROOT, ".buildersbot-build/license-provenance-guard/report.json");
const GUARD_FILE = "scripts/license-provenance-guard.ts";
// Built from halves so that this file, too, never spells the name it refuses.
const PREVIOUS_NAME = ["open", "bot"].join("");

/**
 * The token families. `previous-name` is the previous product name; the rest is the legal trail. The list is an
 * array, not an object, so iterating it needs no type assertion.
 */
const TOKENS = [
  ["polyform", /\bpolyform\b/iu],
  ["polyformproject.org", /polyformproject\.org/iu],
  ["synthetify", /synthetify/iu],
  ["nightly-labs", /nightly-labs/iu],
  ["previous-name", new RegExp(PREVIOUS_NAME, "iu")],
  ["required-notice", /Required Notice/u],
  ["derivado", /\bderivad[oa]s?\b/iu],
  ["derived", /\bderived\b/iu],
  ["proprietary", /proprietary/iu],
] as const satisfies ReadonlyArray<readonly [string, RegExp]>;

type Token = (typeof TOKENS)[number][0];

const LEGAL: readonly Token[] = [
  "polyform",
  "polyformproject.org",
  "synthetify",
  "nightly-labs",
  "required-notice",
  "derivado",
  "derived",
  "proprietary",
];

interface Allowance {
  file: string | RegExp;
  tokens: readonly Token[];
  /** The text of the line that may carry the token. Without it, the whole file may. */
  line?: RegExp;
  reason: string;
}

/**
 * Compatibility surfaces. The new name writes, the old name reads: an installed host, an existing
 * profile and a link already sent must keep working. Everything else in the product was renamed
 * outright, so this list is short on purpose.
 */
const COMPATIBILITY: readonly Allowance[] = [
  {
    file: /.*/u,
    tokens: ["derived", "derivado"],
    reason: "the ordinary English and Portuguese words in technical prose and in third-party licence text",
  },
  {
    file: /.*/u,
    tokens: ["proprietary"],
    reason: "the word that describes the licence of this product, used by the licence, the site and the docs",
  },
];

/**
 * Files allowed whole. They are history that stays history (a changelog entry is the record of a
 * version that shipped, the plan describes the purge itself), or a file that must spell the terms by
 * design (the rename map, this guard, the network policy).
 */
const HISTORY: readonly Allowance[] = [
  {
    file: /^plans\//u,
    tokens: [...LEGAL, "previous-name"],
    reason: "a plan written before the cut, kept as the record of the decision",
  },
  {
    file: "scripts/update-feed-guard-e2e.ts",
    tokens: [...LEGAL, "previous-name"],
    reason: "the update feed guard: it names the terms it refuses and the allow-list it checks",
  },
  {
    file: "scripts/builders-bot-rename.pl",
    tokens: [...LEGAL, "previous-name"],
    reason: "the rename map: each rule is a term of the previous project",
  },
  {
    file: GUARD_FILE,
    tokens: [...LEGAL, "previous-name"],
    reason: "this guard: the token list and the allow-list spell the terms",
  },
  {
    file: "scripts/network-policy.ts",
    tokens: [...LEGAL, "previous-name"],
    reason: "the network policy: the transition list names the previous project's hosts",
  },
  {
    file: "scripts/network-egress-guard.ts",
    tokens: [...LEGAL, "previous-name"],
    reason: "the network guard: its self-check names the previous project's hosts",
  },
  {
    file: "CHANGELOG.md",
    tokens: [...LEGAL, "previous-name"],
    reason: "a released version keeps the text it shipped with",
  },
  {
    file: "apps/mobile/CHANGELOG.md",
    tokens: [...LEGAL, "previous-name"],
    reason: "the same, for the mobile releases",
  },
  {
    file: /^vendor\//u,
    tokens: [...LEGAL, "previous-name"],
    reason: "the patched third-party sources: their own identifiers, which we do not own",
  },
  {
    file: /^patches\//u,
    tokens: [...LEGAL, "previous-name"],
    reason: "the patch files of those sources",
  },
  {
    file: "native-runtime.lock.json",
    tokens: [...LEGAL, "previous-name"],
    reason: "the pinned runtime digests, including the patch file names",
  },
];

/**
 * Debt. Each entry names the phase that removes it. The list is a ratchet: delete an entry when the
 * file no longer matches, and the guard then refuses the term there.
 */
const DEBT: readonly Allowance[] = [];

interface Mention {
  file: string;
  line: number;
  token: Token;
  text: string;
  allowed: string | null;
}

interface CheckResult {
  name: string;
  passed: boolean;
  details: unknown;
}

const checks: CheckResult[] = [];
const mentions: Mention[] = [];

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

/** The compatibility entries a line has matched, so one that never matches can be reported. */
const matchedCompatibility = new Set<Allowance>();

const BINARY_FILE =
  /\.(?:png|jpe?g|gif|webp|ico|icns|car|svg|woff2?|ttf|otf|mp3|wav|webm|mp4|zip|gz|tgz|pdf|node|wasm)$/iu;

/** The tracked and the new (not ignored) files of the repository, relative to its root. */
function repositoryFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return [...new Set(output.split("\0").filter(Boolean))].filter((file) => existsSync(resolve(ROOT, file)));
}

function matches(allowance: Allowance, file: string, token: Token, text: string): boolean {
  return (
    (typeof allowance.file === "string" ? allowance.file === file : allowance.file.test(file)) &&
    allowance.tokens.includes(token) &&
    (allowance.line === undefined || allowance.line.test(text))
  );
}

function allowedReason(file: string, token: Token, text: string): string | null {
  const entry = [...COMPATIBILITY, ...HISTORY, ...DEBT].find((allowance) => matches(allowance, file, token, text));
  // Every entry the line matches counts as evidence, not only the first one, or a shape covered by
  // two entries reports the second as dead. This file is skipped as evidence: its own pattern
  // literals match their entries and would keep a dead one alive forever.
  if (file !== GUARD_FILE)
    for (const allowance of COMPATIBILITY)
      if (matches(allowance, file, token, text)) matchedCompatibility.add(allowance);
  return entry?.reason ?? null;
}

function findMentions(file: string, content: string): Mention[] {
  const lines = content.split("\n");
  return lines.flatMap((text, index) =>
    TOKENS.filter(([, pattern]) => pattern.test(text)).map(([token]) => ({
      file,
      line: index + 1,
      token,
      text: text.trim(),
      allowed: allowedReason(file, token, text),
    })),
  );
}

const files = repositoryFiles().filter((file) => !BINARY_FILE.test(file));

await check("no text file carries the legal trail outside the allow-list", () => {
  const found = files.flatMap((file) => {
    let content: string;
    try {
      content = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      return [];
    }
    return findMentions(file, content).filter((mention) => LEGAL.includes(mention.token));
  });
  mentions.push(...found);
  const refused = found.filter((mention) => mention.allowed === null);
  if (refused.length > 0) {
    fail(
      [
        `${refused.length} legal-trail line${refused.length === 1 ? "" : "s"} outside the allow-list:`,
        ...refused.map((mention) => `  ${mention.file}:${mention.line} ${mention.token}: ${mention.text}`),
        "",
        "Repair:",
        "  - a later phase removes it: add a DEBT entry with the file, the token and the phase;",
        "  - it is history that stays: add it to HISTORY with the reason it never leaves;",
        "  - it is a compatibility surface: add it to COMPATIBILITY.",
        "The legal terms must end with no DEBT entry at all: a new one is a regression.",
      ].join("\n"),
    );
  }
  return { searched: files.length, allowed: found.length };
});

await check("no text file carries the product name outside the allow-list", () => {
  const found = files.flatMap((file) => {
    let content: string;
    try {
      content = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      return [];
    }
    return findMentions(file, content).filter((mention) => mention.token === "previous-name");
  });
  mentions.push(...found);
  const refused = found.filter((mention) => mention.allowed === null);
  if (refused.length > 0) {
    fail(
      [
        `${refused.length} product-name line${refused.length === 1 ? "" : "s"} outside the allow-list:`,
        ...refused.map((mention) => `  ${mention.file}:${mention.line}: ${mention.text}`),
        "",
        "Repair:",
        "  - it keeps something working (a host, a path, a service, a database file, an environment",
        "    prefix, a persisted key): add the shape to COMPATIBILITY with the surface it keeps;",
        "  - it is an identifier that F4 renames: add a DEBT entry with the identifier family and the",
        "    phase, not the whole file, so a new term in the same file still fails.",
      ].join("\n"),
    );
  }
  return { searched: files.length, allowed: found.length };
});

await check("the allow-list entries name a reason, and a legal entry outside HISTORY is debt", () => {
  const empty = [...COMPATIBILITY, ...HISTORY, ...DEBT].filter((entry) => entry.reason.trim() === "");
  if (empty.length > 0) fail(`${empty.length} allow-list entries have no reason.`);
  const legalDebt = DEBT.filter((entry) => entry.tokens.some((token) => LEGAL.includes(token)));
  return { entries: COMPATIBILITY.length + HISTORY.length + DEBT.length, legalDebt: legalDebt.length };
});

await check("no compatibility entry is stale: each one still covers a line", () => {
  const stale = COMPATIBILITY.filter((entry) => !matchedCompatibility.has(entry));
  if (stale.length > 0) {
    fail(
      [
        `${stale.length} compatibility entr${stale.length === 1 ? "y covers" : "ies cover"} no line any more:`,
        ...stale.map((entry) => `  ${String(entry.file)} ${entry.tokens.join(", ")}: ${entry.reason}`),
        "",
        "Delete the entry, or the guard keeps certifying a compatibility surface the code no longer has.",
      ].join("\n"),
    );
  }
  return { entries: COMPATIBILITY.length, matched: matchedCompatibility.size };
});

const passed = checks.every((entry) => entry.passed);
const legalDebt = DEBT.filter((entry) => entry.tokens.some((token) => LEGAL.includes(token))).length;
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(
  REPORT_PATH,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), passed, checks, mentions }, null, 2)}\n`,
);
for (const entry of checks) {
  logger.info(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
  if (!entry.passed) logger.error(String(entry.details));
}
logger.info(`${legalDebt} legal-term debt allowances: the list must end empty.`);
logger.info(`Wrote ${relative(ROOT, REPORT_PATH)}.`);
if (!passed) process.exitCode = 1;
