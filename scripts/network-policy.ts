// The single source of truth for every host that Builders Bot may contact. Section 5 of
// plans/legal/purga-de-autoria.md fixes the levels; this file is the only place that may add, move
// or excuse a host. `scripts/network-egress-guard.ts` reads it, and the package and E2E checks read
// the same functions, so a host that is not here cannot pass any of them.
//
// A host is written without a scheme. An entry without `*.` matches the host itself and every
// subdomain; an entry with `*.` matches subdomains only. The most specific match wins, so
// `ghcr.io/nextlevelcommunity/*` beats `ghcr.io`.
//
// Level 3 and level 4 have no permanent entry: they live in TRANSITION, because both are debt.
// Level 3 is a host of the previous project that must stop being called; level 4 is a third-party
// analytics service that may stay only while someone wrote down why. An entry there names the phase
// that removes it, and the guard prints the list on every run.

/** What each level means. The guard prints these lines in its failure message. */
export const EGRESS_LEVELS = {
  0: "our house: the only default egress. Anything here is ours to operate.",
  1: "a provider or integration the user chose. Allowed, and visible in the interface.",
  2: "a dependency: package registry, runtime download, platform push, reference data.",
  3: "forbidden: a host of the previous project. Allowed only through TRANSITION.",
  4: "forbidden by default: third-party analytics. Allowed only with a written justification.",
} as const;

export type EgressLevel = keyof typeof EGRESS_LEVELS;

/** One allowed host. `host` is a glob as described at the top of the file. */
export interface EgressEntry {
  level: EgressLevel;
  host: string;
  reason: string;
}

/**
 * A level 3 or level 4 host that is still called, with the reason and the phase that removes it.
 * `until` is a phase of the plan, so the entry has an expiry that a reader can check.
 */
export interface TransitionEntry extends EgressEntry {
  level: 3 | 4;
  until: string;
}

/** Our own house. Every other host exists because this one cannot serve the request. */
const HOME: readonly EgressEntry[] = [
  {
    level: 0,
    host: "culturabuilder.com",
    reason: "the Cultura Builder domain: the site, the account API, Signal, TURN, sites and the update feed",
  },
];

/**
 * Providers and integrations. Each is a service the user connects on purpose, so the interface names
 * it and the user can remove it. A provider that ships its own CLI endpoint belongs here too: the CLI
 * is the user's, not ours.
 */
const PROVIDERS: readonly EgressEntry[] = [
  { level: 1, host: "openai.com", reason: "OpenAI: API, sign-in and account pages for Codex" },
  { level: 1, host: "chatgpt.com", reason: "ChatGPT: sign-in and account pages of the OpenAI provider" },
  { level: 1, host: "anthropic.com", reason: "Anthropic: API and account pages for Claude" },
  { level: 1, host: "claude.ai", reason: "Claude: sign-in page of the Anthropic provider" },
  { level: 1, host: "claude.com", reason: "Claude Code: documentation and the CLI download page" },
  { level: 1, host: "x.ai", reason: "xAI: API and documentation for Grok" },
  { level: 1, host: "google.com", reason: "Google: sign-in, Gemini and the Antigravity provider" },
  { level: 1, host: "google.dev", reason: "Google for Developers: Gemini API documentation" },
  { level: 1, host: "googleapis.com", reason: "Google APIs: Gemini, FCM and OAuth endpoints" },
  { level: 1, host: "cursor.com", reason: "Cursor: account and the Cursor agent CLI" },
  { level: 1, host: "cursor.sh", reason: "Cursor API endpoint of the agent CLI" },
  { level: 1, host: "cline.bot", reason: "Cline: provider API and documentation" },
  { level: 1, host: "inceptionlabs.ai", reason: "Inception: provider API and documentation" },
  { level: 1, host: "meta.ai", reason: "Meta AI: the Muse provider" },
  { level: 1, host: "meta.com", reason: "Meta: account and policy pages of the Muse provider" },
  { level: 1, host: "githubcopilot.com", reason: "GitHub Copilot: the provider endpoint" },
  { level: 1, host: "opencode.ai", reason: "OpenCode: provider API and documentation" },
  { level: 1, host: "huggingface.co", reason: "Hugging Face: model and space downloads the user asks for" },
  { level: 1, host: "elevenlabs.io", reason: "ElevenLabs: voice provider API and documentation" },
  { level: 1, host: "brave.com", reason: "Brave Search: the search plugin" },
  { level: 1, host: "boat.dev", reason: "Boat: sandbox and payment API" },
  { level: 1, host: "agentclientprotocol.com", reason: "ACP: the protocol registry and its schema" },
  { level: 1, host: "modelcontextprotocol.io", reason: "MCP: the protocol documentation that a plugin link opens" },
  { level: 1, host: "telegram.org", reason: "Telegram: the messaging channel and the Bot API" },
  { level: 1, host: "t.me", reason: "Telegram: short invite links" },
  { level: 1, host: "discord.com", reason: "Discord: the messaging channel and its gateway" },
  { level: 1, host: "slack.com", reason: "Slack: the messaging channel and its OAuth pages" },
  { level: 1, host: "stripe.com", reason: "Stripe: billing, checkout and the Stripe plugin" },
  { level: 1, host: "figma.com", reason: "Figma: the design plugin and its MCP server" },
  { level: 1, host: "notion.com", reason: "Notion: the Notion plugin and its MCP server" },
  { level: 1, host: "notion.so", reason: "Notion: workspace pages that a plugin link opens" },
  { level: 1, host: "atlassian.com", reason: "Atlassian: the Jira and Confluence plugins" },
  { level: 1, host: "atlassian.net", reason: "Atlassian Cloud: a customer site that a plugin link opens" },
  { level: 1, host: "linear.app", reason: "Linear: the Linear plugin and its MCP server" },
  { level: 1, host: "canva.com", reason: "Canva: the design plugin and its MCP server" },
  { level: 1, host: "canva.dev", reason: "Canva Developers: plugin documentation" },
  { level: 1, host: "airtable.com", reason: "Airtable: the base plugin and its MCP server" },
  { level: 1, host: "todoist.com", reason: "Todoist: the task plugin and its MCP server" },
  { level: 1, host: "todoist.net", reason: "Todoist: the API host of the task plugin" },
  { level: 1, host: "trello.com", reason: "Trello: the board plugin and its MCP server" },
  { level: 1, host: "neon.com", reason: "Neon: the database plugin" },
  { level: 1, host: "neon.tech", reason: "Neon: the MCP server of the database plugin" },
  { level: 1, host: "supabase.com", reason: "Supabase: the database plugin and its MCP server" },
  { level: 1, host: "railway.com", reason: "Railway: the hosting plugin and its MCP server" },
  { level: 1, host: "render.com", reason: "Render: the hosting plugin and its MCP server" },
  { level: 1, host: "vercel.com", reason: "Vercel: the hosting plugin and its MCP server" },
  { level: 1, host: "cloudflare.com", reason: "Cloudflare: the hosting plugin, its MCP server and the API" },
  { level: 1, host: "composio.dev", reason: "Composio: the integration plugin and its MCP server" },
  { level: 1, host: "context7.com", reason: "Context7: the documentation plugin and its MCP server" },
  { level: 1, host: "firecrawl.dev", reason: "Firecrawl: the scraping plugin and its MCP server" },
  { level: 1, host: "prisma.io", reason: "Prisma: the database plugin and its MCP server" },
  { level: 1, host: "obsidian.md", reason: "Obsidian: the notes plugin" },
  { level: 1, host: "playwright.dev", reason: "Playwright: the browser automation plugin" },
  { level: 1, host: "netlify.com", reason: "Netlify: the hosting plugin" },
  { level: 1, host: "netlify.app", reason: "Netlify: a deployed site that a plugin link opens" },
  { level: 1, host: "databricks.com", reason: "Databricks: a data plugin" },
  { level: 1, host: "resend.com", reason: "Resend: the mail plugin" },
  { level: 1, host: "paper.design", reason: "Paper: the design plugin" },
  { level: 1, host: "cobrain.space", reason: "Cobrain: a plugin" },
  { level: 1, host: "aave.com", reason: "Aave: the DeFi plugin and its MCP server" },
  { level: 1, host: "bitwarden.com", reason: "Bitwarden: the vault connector" },
  { level: 1, host: "1password.com", reason: "1Password: the vault connector" },
  { level: 1, host: "agilebits.com", reason: "1Password: the CLI download host" },
  { level: 1, host: "zaidan.carere.dev", reason: "a plugin author's documentation site" },
  { level: 1, host: "arxiv.org", reason: "arXiv: a paper link in a seeded conversation" },
  { level: 1, host: "x.com", reason: "X: a profile link and a browser suggestion" },
  { level: 1, host: "whatsapp.com", reason: "WhatsApp: the messaging plugin and the web client link" },
  { level: 1, host: "antigravity.google", reason: "Antigravity: the provider download page" },
];

/**
 * Dependencies and platform services. Nothing here is chosen per user: a build, an install, a push
 * notification or a signed update needs them, and the user cannot remove them.
 */
const DEPENDENCIES: readonly EgressEntry[] = [
  {
    level: 2,
    host: "github.com",
    reason: "the repository, its releases and its API: runtime downloads and the update feed",
  },
  { level: 2, host: "githubusercontent.com", reason: "raw files of a GitHub release" },
  { level: 2, host: "ghcr.io", reason: "the container registry: runtime images" },
  { level: 2, host: "registry.npmjs.org", reason: "the package registry of the install" },
  { level: 2, host: "cdn.jsdelivr.net", reason: "a versioned package file that a fixture loads" },
  { level: 2, host: "nodejs.org", reason: "the Node.js runtime download of the container image" },
  { level: 2, host: "bun.sh", reason: "the Bun runtime and its documentation" },
  { level: 2, host: "biomejs.dev", reason: "the Biome schema of biome.json" },
  { level: 2, host: "jitpack.io", reason: "a Gradle dependency of the Android modules" },
  { level: 2, host: "dl.google.com", reason: "the Android SDK and platform downloads" },
  { level: 2, host: "play.google.com", reason: "the Play Store listing of the Android app" },
  { level: 2, host: "apple.com", reason: "the App Store listing and the Apple developer pages" },
  { level: 2, host: "push.apple.com", reason: "APNs: push notifications" },
  { level: 2, host: "fcm.googleapis.com", reason: "FCM: push notifications to Android" },
  { level: 2, host: "microsoft.com", reason: "Azure Trusted Signing and the Windows signing toolchain" },
  { level: 2, host: "codesigning.azure.net", reason: "Azure Trusted Signing: the Windows signature" },
  { level: 2, host: "amazonaws.com", reason: "AWS: the container image build and the ECS deployment" },
  { level: 2, host: "w3.org", reason: "the XML and SVG namespaces of the documents we write" },
  { level: 2, host: "schemas.openxmlformats.org", reason: "the OOXML namespace of the spreadsheet writer" },
  { level: 2, host: "schemas.android.com", reason: "the Android manifest namespace" },
  { level: 2, host: "schema.org", reason: "the structured data vocabulary of the pages" },
  { level: 2, host: "purl.org", reason: "the Dublin Core namespace of the feed" },
  { level: 2, host: "sitemaps.org", reason: "the sitemap namespace" },
  { level: 2, host: "ssl.com", reason: "the C2PA certificate chain of a signed image" },
  { level: 2, host: "creativecommons.org", reason: "a licence link of a bundled model" },
  { level: 2, host: "apache.org", reason: "the Apache licence of a bundled model" },
  { level: 2, host: "gnu.org", reason: "the GPL text of the bundled remote-desktop runtime" },
  { level: 2, host: "fsf.org", reason: "the address the GPL text names" },
  { level: 2, host: "semver.org", reason: "the version grammar that a changelog link names" },
  { level: 2, host: "developer.mozilla.org", reason: "the web platform reference that a fixture names" },
  { level: 2, host: "expo.dev", reason: "the Expo documentation of the mobile app" },
  { level: 2, host: "fastlane.tools", reason: "the Fastlane documentation of the mobile release" },
  { level: 2, host: "rocketsim.app", reason: "the iOS simulator tool of the mobile release" },
  { level: 2, host: "dotenvx.com", reason: "the encrypted environment files of the stack" },
  { level: 2, host: "ecb.europa.eu", reason: "the European Central Bank reference rates of the USD price" },
  { level: 2, host: "httpbin.org", reason: "a request echo in the AWS runbook" },
  { level: 2, host: "reactbits.dev", reason: "a component reference in the API readme" },
  { level: 2, host: "analytics.builders", reason: "the truncated host of a documentation sample" },
  { level: 2, host: "workers.dev", reason: "a Cloudflare Workers host: the test deployment of the account API" },
  { level: 2, host: "privateemail.com", reason: "the SMTP mailbox that the account service sends from" },
  { level: 2, host: "slack.dev", reason: "Slack's developer documentation, linked from the app runbook" },
  { level: 2, host: "producthunt.com", reason: "the Product Hunt listing, named in the page metadata" },
  { level: 2, host: "lookaside.facebook.com", reason: "the download CDN of the provider runtimes" },
  {
    level: 2,
    host: "github.com.helper",
    reason: "the git credential key that the connector writes; the host is github.com",
  },
  {
    level: 2,
    host: "github.com.usehttppath",
    reason: "the git credential key that the connector writes; the host is github.com",
  },
];

/**
 * Level 3 and level 4. Every entry is debt with an expiry: the phase that removes it. The guard
 * prints this list on every run, so the count is visible.
 */
export const TRANSITION: readonly TransitionEntry[] = [
  {
    level: 3,
    host: "api.openpanel.dev",
    until: "F3",
    reason: "the OpenPanel service of the previous project: the account Worker still sends product events there",
  },
  {
    level: 3,
    host: "ghcr.io/nextlevelcommunity/*",
    until: "F3",
    reason: "the previous project's container registry path; a pull that still names it gets their image, not ours",
  },
  {
    level: 4,
    host: "sentry.io",
    until: "F3",
    reason: "the Sentry plugin and its MCP server: the user connects it, and no code sends to it by itself",
  },
  {
    level: 4,
    host: "sentry.dev",
    until: "F3",
    reason: "the Sentry MCP server of the plugin",
  },
  {
    level: 4,
    host: "posthog.com",
    until: "F3",
    reason: "the PostHog plugin and its MCP server: the user connects it, and no code sends to it by itself",
  },
  {
    level: 4,
    host: "google-analytics.com",
    until: "F3",
    reason: "Google Analytics: no page loads it today, and it stays refused while that is true",
  },
  {
    level: 4,
    host: "googletagmanager.com",
    until: "F3",
    reason: "Google Tag Manager: the loader of the same analytics, refused while nothing loads it",
  },
];

/** Every permanent entry, in level order. */
export const POLICY: readonly EgressEntry[] = [...HOME, ...PROVIDERS, ...DEPENDENCIES];

/** The level table plus the transition list, as one list for the matcher. */
const ALL_ENTRIES: readonly EgressEntry[] = [...POLICY, ...TRANSITION];

/** A host as written in a file: lower case, no scheme, no port, no trailing dot. The path stays. */
export function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, "")
    .replace(/:\d+(?=[/?#]|$)/u, "")
    .replace(/[?#].*$/u, "")
    .replace(/\/+$/u, "")
    .replace(/\.+$/u, "");
}

function matches(entry: string, host: string): boolean {
  if (entry.includes("*")) {
    const pattern = new RegExp(`^${entry.replaceAll(".", "\\.").replaceAll("*", ".*")}$`, "u");
    return pattern.test(host);
  }
  return host === entry || host.endsWith(`.${entry}`) || host.startsWith(`${entry}/`);
}

function bestMatch(host: string): EgressEntry | null {
  let best: EgressEntry | null = null;
  let bestLength = -1;
  for (const entry of ALL_ENTRIES) {
    if (!matches(entry.host, host)) continue;
    const length = entry.host.replaceAll("*", "").length;
    if (length > bestLength) {
      best = entry;
      bestLength = length;
    }
  }
  return best;
}

/**
 * The entry that governs a host, or null when the policy does not know it. The most specific entry
 * wins: `ghcr.io/nextlevelcommunity/*` is level 3 even though `ghcr.io` is level 2. A path is tried whole
 * first, so a registry path can have its own rule, then without it.
 */
export function classifyHost(value: string): EgressEntry | null {
  const host = normalizeHost(value);
  if (!host.includes(".")) return null;
  return bestMatch(host) ?? bestMatch(host.replace(/\/.*$/u, ""));
}

/** The level that governs a host, or null when the policy does not know it. */
export function egressLevel(value: string): EgressLevel | null {
  return classifyHost(value)?.level ?? null;
}

/** True when the host is on the transition list, at any level. */
export function isTransitionHost(value: string): boolean {
  const entry = classifyHost(value);
  return entry !== null && TRANSITION.some((transition) => transition === entry);
}
