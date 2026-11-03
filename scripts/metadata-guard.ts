// Checks the metadata of the repository itself: who wrote each commit, what the commits credit, where
// the repository points and what the packages say about it. Section 1 and F0 of
// plans/legal/purga-de-autoria.md: the new repository is born ours, so a commit of a third party, a
// remote of the previous project or a tag that is not ours is a regression. It needs no network.
//
// It refuses:
//
// - an author or a committer that is not `Cultura Builder <dev@culturabuilder.com>`;
// - a `Co-authored-by` or `Signed-off-by` trailer of anyone else;
// - a remote other than `origin`, and an `origin` that is not the new repository;
// - a tag that is not `v<major>.<minor>.<patch>`, and a tag that is not signed;
// - a `repository`, `bugs` or `homepage` of a `package.json` outside the new repository and site.
//
// A shallow clone cannot see every commit, so the guard refuses one and names the checkout setting.
//
// The repair, for each failure:
//   - identity: `git commit --amend --author="Cultura Builder <dev@culturabuilder.com>"` on the tip,
//     or a rebase for an older commit. A history that is not pushed yet may be rewritten;
//   - remote: `git remote remove <name>` for every name but `origin`, and
//     `git remote set-url origin https://github.com/nextlevelcommunity/buildersbot.git`;
//   - tag: `git tag -s v1.2.3` (signed, three numbers). A tag already pushed needs a new version;
//   - package metadata: copy the `repository`, `bugs` and `homepage` of the root `package.json`.
//
// Usage: bun scripts/metadata-guard.ts
// It writes .buildersbot-build/metadata-guard/report.json and exits with 1 when a check fails.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createBuildersBotLogger } from "@buildersbot/logging";
import { z } from "zod";

const logger = createBuildersBotLogger("metadata-guard");
const ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(ROOT, ".buildersbot-build/metadata-guard/report.json");

const IDENTITY = "Cultura Builder <dev@culturabuilder.com>";
const ORIGIN_URL = "https://github.com/nextlevelcommunity/buildersbot.git";
const REPOSITORY_URL = `git+${ORIGIN_URL}`;
const BUGS_URL = "https://github.com/nextlevelcommunity/buildersbot/issues";
const HOMEPAGE_URL = "https://buildersbot.culturabuilder.com";
const TAG = /^v\d+\.\d+\.\d+$/u;
/** The build publishes its own artifact tag; it is not a release of the app. */
const RUNTIME_TAG = /^remote-desktop-runtime-[0-9a-f]{64}$/u;
/** The fields of a manifest that must point at the new repository and site. Each is optional. */
const MANIFEST = z.object({
  repository: z.union([z.string(), z.object({ url: z.string().optional() })]).optional(),
  bugs: z.union([z.string(), z.object({ url: z.string().optional() })]).optional(),
  homepage: z.string().optional(),
});
const TRAILERS = ["Co-authored-by", "Signed-off-by"] as const;

/**
 * The one trailer that may credit someone else: the provider that wrote part of the change. It names
 * no project and no company of the previous work, and the commits already carry it.
 */
const PROVIDER_TRAILER = /^co-authored-by:\s*Claude[^<]*<noreply@anthropic\.com>$/iu;

interface CheckResult {
  name: string;
  passed: boolean;
  details: unknown;
}

const checks: CheckResult[] = [];

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

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** `hash`, author, committer and body of every commit, oldest first. */
function commits(): Array<{ hash: string; author: string; committer: string; body: string }> {
  const output = git("log", "--reverse", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x00%x00");
  return output
    .split("\0\0")
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [hash = "", author = "", committer = "", body = ""] = record.split("\0");
      return { hash, author, committer, body };
    });
}

await check("the clone is complete, so every commit is checked", () => {
  const shallow = git("rev-parse", "--is-shallow-repository").trim();
  if (shallow !== "false") {
    fail(
      "This is a shallow clone, so older commits and their identity are invisible. Fetch the whole history: `git fetch --unshallow`, or `actions/checkout` with `fetch-depth: 0`.",
    );
  }
  return { shallow };
});

await check("every commit has our author and our committer", () => {
  const wrong = commits().flatMap((commit) =>
    [
      commit.author === IDENTITY ? null : `  ${commit.hash.slice(0, 12)} author ${commit.author}`,
      commit.committer === IDENTITY ? null : `  ${commit.hash.slice(0, 12)} committer ${commit.committer}`,
    ].filter((line): line is string => line !== null),
  );
  if (wrong.length > 0) {
    fail(
      [
        `${wrong.length} identity line${wrong.length === 1 ? "" : "s"} outside \`${IDENTITY}\`:`,
        ...wrong,
        "",
        'Repair the tip with `git commit --amend --author="Cultura Builder <dev@culturabuilder.com>"` and',
        '`git -c user.name="Cultura Builder" -c user.email=dev@culturabuilder.com commit --amend --no-edit`.',
        "An older commit needs a rebase. History that is not pushed yet may be rewritten.",
      ].join("\n"),
    );
  }
  return { commits: commits().length };
});

await check("no commit credits a third party in a trailer", () => {
  const wrong = commits().flatMap((commit) => {
    const trailers = commit.body
      .split("\n")
      .map((line) => line.match(/^(co-authored-by|signed-off-by):\s*(.+)$/iu))
      .filter((match): match is RegExpMatchArray => match !== null);
    return trailers
      .filter((match) => !PROVIDER_TRAILER.test(match[0].trim()) && (match[2] ?? "").trim() !== IDENTITY)
      .map((match) => `  ${commit.hash.slice(0, 12)} ${match[1]}: ${match[2]}`);
  });
  if (wrong.length > 0) {
    fail(
      [
        `${wrong.length} trailer${wrong.length === 1 ? "" : "s"} credit someone else:`,
        ...wrong,
        "",
        `Only \`${TRAILERS.join(": …`, `")}: …\` with \`${IDENTITY}\`, or a provider trailer, is allowed.`,
        "Remove the line, or rewrite it, in the commit that carries it.",
      ].join("\n"),
    );
  }
  return { trailers: TRAILERS };
});

await check("the only remote is origin, and it is the new repository", () => {
  const names = git("remote").split("\n").filter(Boolean);
  if (names.join(",") !== "origin") {
    fail(
      [
        `The remotes are ${names.length === 0 ? "none" : names.join(", ")}, not only origin.`,
        "",
        "Repair: `git remote remove <name>` for every name but origin. An upstream remote would fetch",
        "the previous project's refs and its tags back into this repository.",
      ].join("\n"),
    );
  }
  const urls = git("remote", "get-url", "--all", "origin").split("\n").filter(Boolean);
  // A checkout made by a runner can omit `.git`, and a developer can use SSH. Both name the same
  // repository, so the comparison is by owner and name.
  const sameRepository = (url: string): boolean =>
    url
      .replace(/^git@github\.com:/u, "https://github.com/")
      .replace(/\.git$/u, "")
      .replace(/\/$/u, "") === ORIGIN_URL.replace(/\.git$/u, "");
  if (urls.length !== 1 || !sameRepository(urls[0] ?? "")) {
    fail(
      [
        `The origin URLs are ${urls.length === 0 ? "none" : urls.join(", ")}, not \`${ORIGIN_URL}\`.`,
        "",
        `Repair: \`git remote set-url origin ${ORIGIN_URL}\`. Drop a second URL with \`git remote set-url --delete origin <url>\`.`,
      ].join("\n"),
    );
  }
  return { remotes: names, origin: urls[0] };
});

await check("every tag is a three-number version, and signed", () => {
  const tags = git("tag", "--list").split("\n").filter(Boolean);
  const wrong: string[] = [];
  for (const tag of tags) {
    if (RUNTIME_TAG.test(tag)) continue;
    if (!TAG.test(tag)) {
      wrong.push(`  ${tag}: not v<major>.<minor>.<patch>`);
      continue;
    }
    // A lightweight tag points at a commit; a signed one is an annotated tag object with a signature.
    let object: string;
    try {
      object = git("cat-file", "-p", `refs/tags/${tag}`);
    } catch {
      wrong.push(`  ${tag}: unreadable tag object`);
      continue;
    }
    if (!/^-----BEGIN (?:PGP|SSH) SIGNATURE-----$/mu.test(object)) wrong.push(`  ${tag}: not signed`);
  }
  if (wrong.length > 0) {
    fail(
      [
        `${wrong.length} tag${wrong.length === 1 ? "" : "s"} refused:`,
        ...wrong,
        "",
        'Repair: `git tag -s v1.0.0 -m "v1.0.0"` on the release commit. The signature is what ties the',
        "tag to us; a lightweight tag ties it to nothing.",
      ].join("\n"),
    );
  }
  return { tags };
});

await check("the package metadata points at the new repository and site", () => {
  const files = git("ls-files", "*package.json").split("\n").filter(Boolean);
  const wrong: string[] = [];
  for (const file of files) {
    const parsed = MANIFEST.safeParse(JSON.parse(readFileSync(resolve(ROOT, file), "utf8")));
    if (!parsed.success) {
      wrong.push(`  ${file}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      continue;
    }
    const { repository, bugs, homepage } = parsed.data;
    const url = typeof repository === "string" ? repository : repository?.url;
    if (url !== undefined && url !== REPOSITORY_URL) wrong.push(`  ${file}: repository ${url}`);
    const bugsUrl = typeof bugs === "string" ? bugs : bugs?.url;
    if (bugsUrl !== undefined && bugsUrl !== BUGS_URL) wrong.push(`  ${file}: bugs ${bugsUrl}`);
    if (homepage !== undefined && homepage !== HOMEPAGE_URL) wrong.push(`  ${file}: homepage ${homepage}`);
  }
  if (wrong.length > 0) {
    fail(
      [
        `${wrong.length} package metadata line${wrong.length === 1 ? "" : "s"} outside the new repository and site:`,
        ...wrong,
        "",
        `Expected repository \`${REPOSITORY_URL}\`, bugs \`${BUGS_URL}\` and homepage \`${HOMEPAGE_URL}\`.`,
        "Copy the three fields of the root package.json.",
      ].join("\n"),
    );
  }
  return { files: files.length };
});

const passed = checks.every((entry) => entry.passed);
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), passed, checks }, null, 2)}\n`);
for (const entry of checks) {
  logger.info(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
  if (!entry.passed) logger.error(String(entry.details));
}
logger.info(`Wrote ${relative(ROOT, REPORT_PATH)}.`);
if (!passed) process.exitCode = 1;
