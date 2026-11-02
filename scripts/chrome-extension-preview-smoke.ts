// Renders the popup and the welcome page of the Chrome extension in each state, dark and light, and
// writes one PNG per state. A preview only: it builds the extension to a folder of its own, serves it
// on 127.0.0.1, and gives each page a stub of `chrome.runtime` and `chrome.i18n` through
// `addInitScript`. The stub is not part of the extension, and nothing here reaches the package.
//
//   bun scripts/chrome-extension-preview-smoke.ts [--locale en|pt_BR] [--out <dir>]
//
// Output: .buildersbot-build/chrome-extension-preview/<page>-<state>-<dark|light>.png

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import type { PageResponse, ProjectView, StatusView } from "../apps/chrome-extension/src/shared/messages";
import { buildChromeExtension } from "./build-chrome-extension";

const ROOT = resolve(import.meta.dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const locale = option("--locale") ?? "pt_BR";
const out = resolve(option("--out") ?? join(ROOT, ".buildersbot-build/chrome-extension-preview"));
const buildDir = join(out, "build");

const base: StatusView = {
  link: "connected",
  stopped: false,
  projects: [],
  pairing: null,
  heldForGesture: false,
  platform: "mac",
};

const aurora: ProjectView = {
  projectKey: "p1",
  title: "Loja Aurora",
  color: "#007cf7",
  paused: false,
  pausedByPerson: false,
  tabs: 3,
  agents: [
    { label: "Ana", initials: "AN", active: true },
    { label: "Bruno", initials: "BR", active: false },
  ],
  blocked: ["https://www.itau.com.br"],
  unlocked: ["https://docs.google.com"],
};

const projects: ProjectView[] = [
  aurora,
  {
    projectKey: "p2",
    title: "Relatórios de vendas",
    color: "#31cf76",
    paused: true,
    pausedByPerson: true,
    tabs: 1,
    agents: [{ label: "Carla", initials: "CA", active: false }],
    blocked: [],
    unlocked: [],
  },
];

interface Shot {
  page: "popup" | "welcome";
  state: string;
  status: StatusView;
  /** A click before the shot, by selector. */
  click?: string;
}

const SHOTS: Shot[] = [
  { page: "popup", state: "connecting", status: { ...base, link: "connecting" } },
  { page: "popup", state: "not-paired", status: { ...base, link: "not-paired" } },
  { page: "popup", state: "connected", status: { ...base, projects } },
  { page: "popup", state: "allow-prompt", status: { ...base, projects }, click: ".floor .row button" },
  { page: "popup", state: "empty", status: base },
  {
    page: "popup",
    state: "long",
    status: {
      ...base,
      projects: [
        {
          ...aurora,
          title: "Pesquisa de concorrentes e preços para a campanha de fim de ano da loja",
          agents: Array.from({ length: 12 }, (_, index) => ({
            label: `Agente ${index + 1}`,
            initials: `A${index + 1}`,
            active: index === 0,
          })),
        },
      ],
    },
  },
  { page: "popup", state: "stopped", status: { ...base, stopped: true, projects } },
  {
    page: "welcome",
    state: "pairing",
    status: {
      ...base,
      link: "not-paired",
      pairing: {
        chrome: ["maçã", "rio", "pedra"],
        options: [
          ["lua", "casa", "vento"],
          ["maçã", "rio", "pedra"],
          ["sol", "mar", "ponte"],
        ],
      },
    },
  },
  { page: "welcome", state: "no-host", status: { ...base, link: "no-host" } },
  { page: "welcome", state: "connected", status: base },
];

/** A `_locales/<locale>/messages.json` file, as Chrome reads it. */
interface ChromeCatalog {
  [name: string]: { message: string; placeholders?: { [n: string]: { content: string } } };
}

/** What a page may call. Messages come from the build, as Chrome reads them from `_locales`. */
function stub({ catalog, status, language }: { catalog: ChromeCatalog; status: StatusView; language: string }): void {
  const messages = catalog;
  const answer = (request: { kind: string }): PageResponse => {
    if (request.kind === "status") return { kind: "status", status };
    if (request.kind === "floor.options")
      return {
        kind: "floor.options",
        options: ["https://www.bb.com.br", "https://www.itau.com.br", "https://www.caixa.gov.br"],
      };
    return { kind: "ok" };
  };
  Object.assign(window, {
    chrome: {
      runtime: { sendMessage: async (request: { kind: string }) => answer(request) },
      i18n: {
        getMessage: (name: string, substitutions?: string[]) => {
          if (name === "@@ui_locale") return language;
          const entry = messages[name];
          if (!entry) return "";
          return entry.message.replace(/\$\$|\$(\w+)\$/g, (token, key?: string) => {
            if (token === "$$") return "$";
            const content = entry.placeholders?.[key ?? ""]?.content ?? "";
            const index = Number(content.slice(1)) - 1;
            return substitutions?.[index] ?? "";
          });
        },
      },
    },
  });
}

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
};

await mkdir(out, { recursive: true });
await buildChromeExtension("dev", buildDir);

const css = await readFile(join(buildDir, "pages.css"), "utf8");
check(!/data:|@import|url\(|https?:\/\//u.test(css), "pages.css loads something: data:, @import, url() or a URL");
for (const page of ["popup.html", "welcome.html"])
  check(!/<script[^>]*>[^<]|\son\w+=/u.test(await readFile(join(buildDir, page), "utf8")), `${page} has inline script`);

const catalog: ChromeCatalog = JSON.parse(await readFile(join(buildDir, `_locales/${locale}/messages.json`), "utf8"));
const TYPES: { [extension: string]: string } = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    // Chrome asks for a favicon that an extension page never has.
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    const path = join(buildDir, pathname);
    if (!path.startsWith(buildDir) || !existsSync(path)) return new Response("not found", { status: 404 });
    return new Response(Bun.file(path), {
      headers: { "content-type": TYPES[extname(path)] ?? "application/octet-stream" },
    });
  },
});

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const written: string[] = [];
try {
  for (const scheme of ["dark", "light"] as const) {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        colorScheme: scheme,
        deviceScaleFactor: 2,
        viewport: shot.page === "popup" ? { width: 360, height: 640 } : { width: 960, height: 900 },
      });
      const page = await context.newPage();
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
      await page.addInitScript(stub, { catalog, status: shot.status, language: locale.replace("_", "-") });
      await page.goto(`http://127.0.0.1:${server.port}/${shot.page}.html`);
      await page.waitForSelector(shot.page === "popup" ? ".top" : ".pair-title");
      if (shot.click) {
        await page.click(shot.click);
        await page.waitForSelector("button.choice");
      }
      const label = `${shot.page}-${shot.state}-${scheme}`;
      if (shot.page === "popup") {
        check((await page.locator("button.danger").count()) === 1, `${label}: Stop all is not in view`);
        if (shot.state === "connected")
          check((await page.locator(".project").count()) === 2, `${label}: not 2 projects`);
        // A long title or many agents wrap or cut inside the card: no part of a card may pass its right
        // edge (the card hides what passes, so the page itself never grows).
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll(".project")].some((card) => {
            const edge = card.getBoundingClientRect().right + 0.5;
            return [...card.querySelectorAll("*")].some((part) => part.getBoundingClientRect().right > edge);
          }),
        );
        check(!overflow, `${label}: a part of a project card passes its edge`);
        await page.locator("body").screenshot({ path: join(out, `${label}.png`) });
      } else {
        if (shot.state === "pairing") {
          check(
            (await page.locator(".words").textContent()) === shot.status.pairing?.chrome.join(" · "),
            `${label}: words`,
          );
          check((await page.locator("button.choice").count()) === 3, `${label}: not 3 choices`);
        }
        await page.screenshot({ path: join(out, `${label}.png`), fullPage: true });
      }
      check(problems.length === 0, `${label}: ${problems.join("; ")}`);
      written.push(join(out, `${label}.png`));
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.stop(true);
}

process.stdout.write(`${written.join("\n")}\n`);
if (failures.length > 0) {
  process.stderr.write(`Preview smoke failed:\n${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Preview smoke passed: ${written.length} screenshots in ${out}\n`);
