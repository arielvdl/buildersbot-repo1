// Web access is the person's own Chrome through the Builders Bot extension, and it is the default:
// the instructions must name it, must say how to install and connect it, and must not offer
// Firecrawl. Playwright and the Builders Bot browser are the person's choices in Settings.
import { type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { developerInstructions } from "./developer-instructions";
import { toolGuidance } from "./tool-guidance";

function agent(): AgentSummary {
  return {
    id: "bot-web",
    name: "Web",
    title: "Web",
    description: "Reads pages.",
    notifications: true,
    provider: "codex",
    model: "gpt-6-luna",
    reasoningEffort: "low",
    threadId: null,
    workspacePath: "/tmp",
    preview: "",
    updatedAt: null,
    avatarSeed: "seed",
    avatarHue: null,
    avatarUrl: null,
  };
}

const instructions = () => developerInstructions(agent(), "/tmp/shared", [], "/tmp/automation", DEFAULT_AGENT_DEFAULTS);

describe("web access when the Builders Bot extension is the default", () => {
  it("points at buildersbot_chrome and says it is the default route", () => {
    const text = instructions();
    expect(text).toContain("Web access is the person's own Chrome, through the Builders Bot extension");
    expect(text).toContain("this is the default route");
    expect(text).not.toContain("Web access is Playwright");
  });

  it("tells the agent to check the connection and to install and connect the extension", () => {
    const text = instructions();
    expect(text).toContain("buildersbot_chrome.status");
    expect(text).toContain("control.sessions is empty");
    expect(text).toContain("bun run chrome-extension:kit");
    expect(text).toContain("chrome://extensions");
    expect(text).toContain("Developer mode");
    expect(text).toContain("Load unpacked");
    expect(text).toContain("BUILDERSBOT_CHROME_BRIDGE_REAL_CHROME=1");
  });

  it("reuses one tab, opens no new browser, and does not open DevTools", () => {
    const text = instructions();
    expect(text).toContain("Reuse your tab");
    expect(text).toContain("never open a second browser");
    expect(text).toContain("Do not open DevTools or a new browser window");
    expect(text).toContain("open a second tab only when you need two pages at the same time");
  });

  it("keeps buildersbot_browser for the sign-ins, the Vault, and a tab that outlives the turn", () => {
    const text = instructions();
    expect(text).toContain("buildersbot_browser is Builders Bot's own persistent browser, the fallback");
    expect(text).toContain("request_takeover");
  });

  it("does not let the agent pick the Builders Bot browser while the extension is connected", () => {
    const text = instructions();
    expect(text).toContain("do every web step in buildersbot_chrome, also a page that needs a sign-in");
    expect(text).toContain("to keep the person's Chrome session untouched");
    expect(text).toContain("only for what the Chrome tools cannot do");
    expect(toolGuidance("buildersbot_browser", "snapshot").join("\n")).toContain(
      "never to keep the person's Chrome session untouched",
    );
  });
});

describe("web access when the person chooses another route in Settings", () => {
  it("uses the Builders Bot browser when that switch is on", () => {
    const text = developerInstructions(agent(), "/tmp/shared", [], "/tmp/automation", DEFAULT_AGENT_DEFAULTS, {
      browserInApp: true,
      chromeAgents: false,
    });
    expect(text).toContain("Web access is the Builders Bot browser");
    expect(text).not.toContain("Web access is Playwright");
  });

  it("uses Playwright when the person turned the extension off and kept Playwright", () => {
    const text = developerInstructions(agent(), "/tmp/shared", [], "/tmp/automation", DEFAULT_AGENT_DEFAULTS, {
      browserInApp: false,
      chromeAgents: false,
    });
    expect(text).toContain("Web access is Playwright, on the person's own computer");
    expect(text).toContain("The person turned the Builders Bot extension off in Settings");
    expect(text).toContain("playwright.browser_navigate");
  });

  it("tells where to install Playwright when its tools are missing", () => {
    const text = developerInstructions(agent(), "/tmp/shared", [], "/tmp/automation", DEFAULT_AGENT_DEFAULTS, {
      browserInApp: false,
      chromeAgents: false,
    });
    expect(text).toContain("Playwright is not installed and where to get it (Marketplace, Apps tab, Playwright");
    expect(text).toContain("npx -y @playwright/mcp@latest");
  });

  it("forbids offering a scraping service and asking about one", () => {
    const text = instructions();
    expect(text).toContain("do not propose Playwright");
    expect(text).toContain("do not ask whether to add one");
  });
});

describe("web access in the tool guidance", () => {
  it("names the extension as the default in the browser guidance", () => {
    expect(toolGuidance("buildersbot_browser", "snapshot").join("\n")).toContain(
      "Web access is the person's own Chrome through the Builders Bot extension",
    );
  });

  it("keeps a web-access service out of the Marketplace suggestions", () => {
    const guidance = toolGuidance("buildersbot", "suggest_marketplace_app").join("\n");
    expect(guidance).toContain("Web access is not a Marketplace case");
    expect(guidance).toContain("do not suggest firecrawl");
  });
});
