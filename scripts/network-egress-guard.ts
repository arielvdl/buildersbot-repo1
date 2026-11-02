// Checks that every host the source, the configuration, the workflows and the scripts name is on the
// network policy of section 5 of plans/legal/purga-de-autoria.md. `scripts/network-policy.ts` is the
// source of truth: this guard adds nothing of its own, so the guard and the package and E2E checks
// cannot disagree. It needs no network and sends no request.
//
// A host is read from a URL with a scheme, and from a bare host in an environment file. Comment lines
// are skipped: a link in a comment is not an egress. A host of the previous project (level 3) or a
// third-party analytics service (level 4) passes only while it is on the transition list, and the
// report prints that list so the debt stays visible. A host the policy does not know fails.
//
// The repair, when a host fails:
//   1. A host we operate: add it under level 0 in scripts/network-policy.ts. It must be a
//      `culturabuilder.com` subdomain; anything else needs the reason written next to it.
//   2. A provider or integration the user connects on purpose: add it under level 1, with the service
//      it belongs to in the reason. If the interface does not show it, the interface is also wrong.
//   3. A dependency, a runtime download or a platform push: add it under level 2, with what downloads
//      or pushes through it.
//   4. A host of the previous project or a third-party analytics service: add it to TRANSITION with
//      the phase that removes it. Do not add it to POLICY: it would stop being debt.
//
// Usage: bun scripts/network-egress-guard.ts
// It writes .buildersbot-build/network-egress-guard/report.json and exits with 1 when a check fails.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createBuildersBotLogger } from "@buildersbot/logging";
import { classifyHost, EGRESS_LEVELS, normalizeHost, TRANSITION } from "./network-policy";

const logger = createBuildersBotLogger("network-egress-guard");
const ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(ROOT, ".buildersbot-build/network-egress-guard/report.json");
const GUARD_FILE = "scripts/network-egress-guard.ts";
const POLICY_FILE = "scripts/network-policy.ts";

/** The files a build reads: source, configuration, workflow and script. Copy and docs are F6. */
const SCANNED =
  /(?:^|\/)(?:src|apps|packages|remote|marketplace\/plugin-catalog|docker|infra|nix|build|scripts)\/|^\.github\/workflows\/|^[^/]+\.(?:json|jsonc|ya?ml|nix|toml|conf|plist|nsh)$|(?:^|\/)Dockerfile$/u;
/** What a build does not read, or what is a fixture of a fixture. A binary has no text host. */
const SKIPPED =
  /(?:^|\/)(?:node_modules|vendor)\/|\.(?:test|spec)\.tsx?$|-e2e\.ts$|\.stories\.tsx$|(?:^|\/)(?:fixtures|preview)\/|^apps\/auth-api\/src\/content\/|(?:^|\/)plugin-catalog\.generated\.ts$|^scripts\/fake-hub\/|^scripts\/browser-|^scripts\/[^/]*-smoke\.ts$|\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|mp3|wav|webm|mp4|zip|gz|tgz|pdf|wasm)$/u;
/** Files whose hosts are only ever read with a scheme. */
const URL_ONLY = /\.(?:ts|tsx|js|mjs|cjs|json|jsonc)$/u;
/** A file whose bare host, without a scheme, is still an egress: the environment of a deployment. */
const ENVIRONMENT_FILE = /(?:^|\/)\.env(?:\.[^/]*)?$/u;
/** A URL with a scheme, or the authority of one. */
const URL_HOST = /(?:https?|wss?|ftp):\/\/([A-Za-z0-9._-]+)/gu;
/** A bare host in an environment file: a dotted name with a plausible top-level label. */
const BARE_HOST =
  /(?<![A-Za-z0-9_./@-])((?:[a-z0-9-]+\.)+(?:com|dev|io|ai|app|net|org|run|site|co|sh|bot|space|tech|cloud|br|tv|me))(?![A-Za-z0-9_/@-])/giu;
/**
 * A name that is not an egress: the loopback, a private address, the local suffixes, and the
 * documentation placeholders. Nothing here leaves the computer, so the policy does not list them.
 */
const NOT_EGRESS =
  /^(?:\d{1,3}(?:\.\d{1,3}){3}|localhost|(?:[a-z0-9-]+\.)*(?:localhost|local|internal|test|invalid|example|example\.(?:com|net|org)|exemplo\.[a-z.]+|nip\.io))$/u;

interface CheckResult {
  name: string;
  passed: boolean;
  details: unknown;
}

interface Finding {
  file: string;
  line: number;
  host: string;
  level: number | null;
  reason: string | null;
  transition: string | null;
}

const checks: CheckResult[] = [];
const findings: Finding[] = [];

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

/** The tracked and the new (not ignored) files of the repository, relative to its root. */
function repositoryFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return [...new Set(output.split("\0").filter(Boolean))].filter((file) => existsSync(resolve(ROOT, file)));
}

/** One line without its comment: `//` outside a scheme, `#` outside a word, and a block comment line. */
function withoutComment(file: string, raw: string): string {
  if (/^\s*(?:\*|\/\*)/u.test(raw)) return "";
  if (URL_ONLY.test(file)) return raw.replace(/(^|[^:])\/\/.*$/u, "$1");
  if (ENVIRONMENT_FILE.test(file) || /\.(?:ya?ml|sh|conf|nix|toml|nsh)$|Dockerfile$/u.test(file)) {
    return raw.replace(/(^|\s)#.*$/u, "$1");
  }
  return raw;
}

/** Each host the file names, with its line. */
function hostsOf(file: string, content: string): Array<{ host: string; line: number }> {
  const found: Array<{ host: string; line: number }> = [];
  content.split("\n").forEach((raw, index) => {
    const line = withoutComment(file, raw);
    for (const match of line.matchAll(URL_HOST)) found.push({ host: normalizeHost(match[1] ?? ""), line: index + 1 });
    if (ENVIRONMENT_FILE.test(file)) {
      for (const match of line.matchAll(BARE_HOST))
        found.push({ host: normalizeHost(match[1] ?? ""), line: index + 1 });
    }
  });
  return found.filter((entry) => entry.host.includes(".") && !NOT_EGRESS.test(entry.host));
}

const files = repositoryFiles().filter(
  (file) => SCANNED.test(file) && !SKIPPED.test(file) && file !== GUARD_FILE && file !== POLICY_FILE,
);

await check("every host the build names is on the network policy", () => {
  const unknown: Finding[] = [];
  let allowed = 0;
  let transition = 0;
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const { host, line } of hostsOf(file, content)) {
      const entry = classifyHost(host);
      if (entry === null) {
        const finding: Finding = { file, line, host, level: null, reason: null, transition: null };
        findings.push(finding);
        unknown.push(finding);
        continue;
      }
      allowed += 1;
      if (entry.level === 3 || entry.level === 4) {
        transition += 1;
        findings.push({
          file,
          line,
          host,
          level: entry.level,
          reason: entry.reason,
          transition: "until" in entry && typeof entry.until === "string" ? entry.until : null,
        });
      }
    }
  }
  if (unknown.length > 0) {
    fail(
      [
        `${unknown.length} host${unknown.length === 1 ? "" : "s"} outside the network policy:`,
        ...unknown.map((finding) => `  ${finding.file}:${finding.line} ${finding.host}`),
        "",
        "Repair, in scripts/network-policy.ts:",
        "  level 0  a host we operate, under culturabuilder.com",
        "  level 1  a provider or integration the user chose, with the service in the reason",
        "  level 2  a dependency, a runtime download or a platform push, with what uses it",
        "  level 3  a host of the previous project: add it to TRANSITION with the phase that removes it",
        "  level 4  third-party analytics: add it to TRANSITION and write the justification",
        "A host of the previous project added to POLICY stops being debt: put it in TRANSITION.",
      ].join("\n"),
    );
  }
  return { files: files.length, allowed, transition };
});

await check("the policy levels are the five of the plan, and a level 3 host is never in POLICY", () => {
  const levels = Object.keys(EGRESS_LEVELS).join(",");
  if (levels !== "0,1,2,3,4") fail(`The levels are ${levels}, not 0,1,2,3,4.`);
  const wrong = TRANSITION.filter((entry) => entry.level !== 3 && entry.level !== 4);
  if (wrong.length > 0) fail(`Level 3 and 4 only in TRANSITION: ${wrong.map((entry) => entry.host).join(", ")}.`);
  const openpanel = classifyHost("api.openpanel.dev");
  if (openpanel?.level !== 3) fail("api.openpanel.dev is not level 3: the OpenPanel host must fail.");
  const registry = classifyHost("ghcr.io/nightly-labs/buildersbot");
  if (registry?.level !== 3)
    fail("ghcr.io/nightly-labs/buildersbot is not level 3: the specific path must beat ghcr.io.");
  const ours = classifyHost("signal.buildersbot.culturabuilder.com");
  if (ours?.level !== 0) fail("a culturabuilder.com subdomain is not level 0.");
  const site = classifyHost("demo.sites.buildersbot.culturabuilder.com");
  if (site?.level !== 0) fail("a published site is not level 0.");
  const provider = classifyHost("api.openai.com");
  if (provider?.level !== 1) fail("api.openai.com is not level 1.");
  const unknown = classifyHost("cdn.nowhere.example");
  if (unknown !== null) fail("cdn.nowhere.example is on the policy, but the policy must not know it.");
  return { levels: Object.values(EGRESS_LEVELS) };
});

const passed = checks.every((entry) => entry.passed);
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(
  REPORT_PATH,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      passed,
      checks,
      transition: TRANSITION.map((entry) => ({ host: entry.host, level: entry.level, until: entry.until })),
      findings,
    },
    null,
    2,
  )}\n`,
);
for (const entry of checks) {
  logger.info(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
  if (!entry.passed) logger.error(String(entry.details));
}
logger.info(`${TRANSITION.length} transition hosts (level 3 and 4) still allowed.`);
logger.info(`Wrote ${relative(ROOT, REPORT_PATH)}.`);
if (!passed) process.exitCode = 1;
