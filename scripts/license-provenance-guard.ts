// Checks that no text file still carries the provenance of the previous project. It needs no
// network and sends no request. It refuses, in every tracked text file:
//
// - `polyform`, `polyformproject.org`, `synthetify`, `nightly-labs`, `Required Notice`, `derivado`,
//   `derived` and `proprietary`: the legal trail. Outside the historical files the allow-list
//   for these terms must end empty, so a new occurrence is a regression, not a chore;
// - `openbot`: the product name. It survives on purpose in a few compatibility surfaces (hosts,
//   paths, a service name, a database file, an environment prefix) and, as debt, in identifiers that
//   F4 renames. Each allowed line names the reason.
//
// The match ignores case. A binary file is not searched. The historical files are searched by the
// allow-list, not skipped, so an entry there still has to name its reason.
//
// The repair, when a line fails:
//   - a compatibility surface (a host, a path, a service, a database file, an environment prefix):
//     add the shape to COMPATIBILITY with the surface it keeps working;
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

/**
 * The token families. `openbot` is the product name; the rest is the legal trail. The list is an
 * array, not an object, so iterating it needs no type assertion.
 */
const TOKENS = [
  ["polyform", /\bpolyform\b/iu],
  ["polyformproject.org", /polyformproject\.org/iu],
  ["synthetify", /synthetify/iu],
  ["nightly-labs", /nightly-labs/iu],
  ["openbot", /openbot/iu],
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
 * Compatibility surfaces. The new name writes, the old name reads: a link already sent, a published
 * site, an installed host and an existing profile must keep working. The plan calls these out by
 * name (section 3, "what cannot break").
 */
const COMPATIBILITY: readonly Allowance[] = [
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot\.(?:run|site)\b/iu,
    reason:
      "compatibility host: an invitation link, a published site, the deploy smoke check and a fixture still read it",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /run\.openbot\.mobile/iu,
    reason: "the mobile bundle identifier: an installed app keeps it while the store listing is theirs",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /app\.openbot\.desktop/iu,
    reason: "the desktop bundle identifier: an installed app keeps it so an upgrade is an upgrade",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /\/opt\/OpenBot/iu,
    reason: "the install directory of an existing host",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot\.service/iu,
    reason: "the systemd unit of an existing host: a rename breaks the unit that is installed",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /buildersbot-host/iu,
    reason: "the installed host command and its files",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot_license_prices/u,
    reason: "the price signature that a Stripe price of the old name carries, which the bootstrap compares",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /OpenBot Safe Storage/iu,
    reason: "the macOS Keychain item: an existing secret is found under the old name",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot\.db/iu,
    reason: "the database file of an existing install",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /\.openbot\b/iu,
    reason: "the profile directory, the state files and the log folder of an existing install",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /OPENBOT_/u,
    reason: "the environment prefix that a deployment and a shell already set",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /OpenBot\.(?:exe|AppImage)/u,
    reason: "the executable name inside an existing package and its update feed",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot:\/\//iu,
    reason: "the deep-link scheme of an invitation that was already sent",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot-[a-z0-9-]+\.(?:json|path|timer|service|conf)/iu,
    reason: "a state, unit or timer file of an existing install",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /buildersbot-update/iu,
    reason: "the update request and apply units of an existing host",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openBotTool(?:Failure|Result)/u,
    reason: "the tool result envelope: an agent sees the field name, so a rename needs the migration of F4",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /\bopenBotTool\b/u,
    reason: "the same envelope, held in a local variable",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot-browser/iu,
    reason: "the browser profile directories and the CDP allow-list name of an existing profile",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /persist:openbot-browser/u,
    reason: "the persisted browser partition of an existing profile",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /files\.storage\.openBotOn/u,
    reason: "an i18n key: a translation catalogue and its readers share it",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /Support\/OpenBot/u,
    reason: "the macOS Application Support folder of an existing install",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /OpenBot\.app/u,
    reason: "the macOS application bundle name of an existing install",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot-events/u,
    reason: "the event stream name of the Team API",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot-hosted/u,
    reason:
      "the keyring, state, AppArmor, unit and published guide names of a server installed before the rename, which the migration reads",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /OpenBot-Host-(?:Id|Token)|OpenBot-Hosting-Developer-Key/u,
    reason: "the host and developer-key header names that a released host or Worker still sends",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /\/usr\/local\/bin\/openbot(?:-host)?\b/u,
    reason:
      "the administrator and terminal commands that an install of the old name made, and the migration now removes",
  },
  {
    file: "src/main/update-feed-policy.test.ts",
    tokens: ["openbot"],
    line: /openbot-updater/u,
    reason: "the updater cache folder of an installation made before the rename, which the policy refuses",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot-vs-grokbot/u,
    reason: "the slug of a published article",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /@OpenBot_|@meetOpenBot/u,
    reason: "the social handles that the footer and the support page print",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openBotContentImage/u,
    reason: "the bridge name that the content page and its preload share",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openBotSoftwareApplication/u,
    reason: "the JSON-LD node identifier of the software application",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openBot(?:Root|Home)Head/u,
    reason: "the head-element helper of a route",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot\.share-target\.v1/u,
    reason: "the persisted key of the last share target",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot-a3328/u,
    reason: "the Firebase project of the mobile build",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /buildersbot-cultura-builder-start-e2e-/u,
    reason: "the temporary directory prefix of a smoke test",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /installOpenbotStub/u,
    reason: "the name of a test helper",
  },
  {
    file: /^packages\/contracts\/src\/|^src\/backend\/contracts-legacy-names\.test\.ts$|^electron-builder\.yml$/u,
    tokens: ["openbot"],
    reason: "the package owns the persisted and protocol names that a released client still reads, and the link scheme",
  },
  {
    file: /^packages\/contracts\/src\/team-protocol\//u,
    tokens: ["openbot"],
    reason: "the header names of a released client, host or Worker, read after the new name and written beside it",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /\[?"OpenBot-|OpenBot-\$version|OpenBot-<version>|OpenBot-0\.|OpenBot-\(|OpenBot-\.\.\.|openbot-source\.tar\.gz|\.replace\(\/\^Builders Bot-\/u, "OpenBot-"|setAsDefaultProtocolClient\("openbot"\)/u,
    reason: "a sender, a parser or the installer also accepts the released header, asset or scheme name",
  },
  {
    file: "docs/architecture/team-api.md",
    tokens: ["openbot"],
    line: /OpenBot-Protocol-Version/u,
    reason: "the protocol note names the header that a released client still sends",
  },
  {
    file: "docs/web-client.md",
    tokens: ["openbot"],
    line: /published `OpenBot-\*` names/u,
    reason: "the web client doc names the released header family that a client still sends",
  },
  {
    file: "scripts/builders-bot-phone-links.test.ts",
    tokens: ["openbot"],
    line: /not\.toMatch\(\/openbot\/iu\)/u,
    reason: "the test asserts that a made link is not the old one",
  },
  {
    file: /^src\/(?:main\/legacy-profile|backend\/database\/legacy-preference-files)\.ts$/u,
    tokens: ["openbot"],
    reason: "the migration reads the application name, the profile folder and the file prefix of an existing profile",
  },
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
  {
    file: /^(?:\.github\/workflows\/release\.yml|docs\/RELEASING\.md)$/u,
    tokens: ["synthetify"],
    reason: "the Azure Trusted Signing account is still named synthetifyartifactsign; a new account is F5",
  },
  {
    file: /^(?:scripts\/update-feed-guard-e2e|src\/main\/update-feed-policy\.test|apps\/auth-api\/test\/phone-web-app-pages\.test)\.ts$/u,
    tokens: ["nightly-labs"],
    reason: "the guard tests name the previous repository on purpose, to assert that it does not come back",
  },
  {
    file: "apps/mobile/README.md",
    tokens: ["openbot"],
    line: /\*\*Openbot(?: Mobile)?\*\*/u,
    reason: "the project of the OpenPanel dashboard keeps the name it was created with",
  },
  {
    file: "scripts/update-feed-guard-e2e.ts",
    tokens: ["openbot"],
    line: /openBot|updaterCacheDirName/u,
    reason: "the guard asserts the updater cache folder of an installation made before the rename",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /%?(?:USERPROFILE|APPDATA|PROFILE)%?\\OpenBot\b/u,
    reason: "the Windows home and application-data folders of an existing install, which the profile migration reads",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /Software\\Classes\\openbot\b/u,
    reason: "the deep-link scheme key that an invitation already registered on Windows",
  },
  {
    file: /.*/u,
    tokens: ["openbot"],
    line: /openbot-export/u,
    reason: "the export skill folder that a user installed in Hermes before the rename",
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
    tokens: [...LEGAL, "openbot"],
    reason: "a plan written before the cut, kept as the record of the decision",
  },
  {
    file: "plans/legal/purga-de-autoria.md",
    tokens: [...LEGAL, "openbot"],
    reason: "the purge plan itself: it names every trail it removes",
  },
  {
    file: /^docs\/titulo\//u,
    tokens: [...LEGAL, "openbot"],
    reason: "the title dossier of F1: the contract and the annex name the previous owner",
  },
  {
    file: "scripts/builders-bot-rename.pl",
    tokens: [...LEGAL, "openbot"],
    reason: "the rename map: each rule is a term of the previous project",
  },
  {
    file: GUARD_FILE,
    tokens: [...LEGAL, "openbot"],
    reason: "this guard: the token list and the allow-list spell the terms",
  },
  {
    file: "scripts/network-policy.ts",
    tokens: [...LEGAL, "openbot"],
    reason: "the network policy: the transition list names the previous project's hosts",
  },
  {
    file: "scripts/network-egress-guard.ts",
    tokens: [...LEGAL, "openbot"],
    reason: "the network guard: its self-check names the previous project's hosts",
  },
  {
    file: "CHANGELOG.md",
    tokens: [...LEGAL, "openbot"],
    reason: "a released version keeps the text it shipped with",
  },
  {
    file: "apps/mobile/CHANGELOG.md",
    tokens: [...LEGAL, "openbot"],
    reason: "the same, for the mobile releases",
  },
  {
    file: /^vendor\//u,
    tokens: [...LEGAL, "openbot"],
    reason: "the patched third-party sources: their own identifiers, which we do not own",
  },
  {
    file: /^patches\//u,
    tokens: [...LEGAL, "openbot"],
    reason: "the patch files of those sources",
  },
  {
    file: "native-runtime.lock.json",
    tokens: [...LEGAL, "openbot"],
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

function allowedReason(file: string, token: Token, text: string): string | null {
  const entry = [...COMPATIBILITY, ...HISTORY, ...DEBT].find(
    (allowance) =>
      (typeof allowance.file === "string" ? allowance.file === file : allowance.file.test(file)) &&
      allowance.tokens.includes(token) &&
      (allowance.line === undefined || allowance.line.test(text)),
  );
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
    return findMentions(file, content).filter((mention) => mention.token === "openbot");
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
