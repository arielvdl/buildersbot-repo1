/**
 * The popup: the link to the app, Stop all and Resume, and each project with its agents, its tabs, a
 * pause, and the floor sites it hit. Allowing one of those sites for one project needs a choice among
 * three sites at random places.
 */

import { ask, button, el, icon, setLanguage } from "../shared/dom";
import type { LinkView, ProjectView, StatusView } from "../shared/messages";
import { type TextKey, t } from "../shared/text";

const LINK_TEXT: Readonly<{ [link in LinkView]: TextKey }> = {
  connected: "chromeExtension.popup.connected",
  "app-offline": "chromeExtension.popup.appOffline",
  "not-paired": "chromeExtension.popup.notPaired",
  "no-host": "chromeExtension.popup.noHost",
  connecting: "chromeExtension.popup.connecting",
};

const root = document.getElementById("root");

async function refresh(): Promise<void> {
  const answer = await ask({ kind: "status" });
  if (answer.kind === "status") render(answer.status);
}

async function act(request: Parameters<typeof ask>[0]): Promise<void> {
  await ask(request);
  await refresh();
}

function brand(): HTMLElement {
  const logo = el("img", { className: "logo" });
  logo.src = "icons/48.png";
  logo.alt = "";
  return el("span", { className: "brand" }, logo, el("span", { text: t("chromeExtension.extName") }));
}

/** The seal of the header: connected is green, connecting is amber and pulses. Other states have a card. */
function seal(link: LinkView): HTMLElement | false {
  if (link !== "connected" && link !== "connecting") return false;
  const dot = el("span", { className: "dot" });
  dot.setAttribute("aria-hidden", "true");
  // The brand is next to the seal, so "Connected" is enough there; the full sentence stays for screen readers.
  const pill = el(
    "span",
    { className: link === "connected" ? "pill ok" : "pill busy", label: t(LINK_TEXT[link]) },
    dot,
    el("span", { text: t(link === "connected" ? "chromeExtension.popup.connectedShort" : LINK_TEXT[link]) }),
  );
  pill.setAttribute("role", "status");
  return pill;
}

/** Without a link: a card with what is wrong (the same words as before) and Connect as the main action. */
function stateCard(link: LinkView): HTMLElement {
  const connect = button(
    t("chromeExtension.popup.connect"),
    () => void act({ kind: "connect" }),
    "button primary wide",
  );
  // The seal of the header already says "Connecting…": the card only offers Connect again.
  if (link === "connecting")
    return el("section", { className: "state" }, el("span", { className: "badge" }, icon("plug")), connect);
  return el(
    "section",
    { className: "state" },
    el("span", { className: link === "not-paired" ? "badge" : "badge warn" }, icon("plug")),
    el("h2", { className: "state-title", text: t(LINK_TEXT[link]) }),
    connect,
  );
}

function stoppedBanner(): HTMLElement {
  return el(
    "section",
    { className: "stopped" },
    el("span", { className: "badge warn" }, icon("alert")),
    el("p", { text: t("chromeExtension.popup.stoppedNote") }),
    button(t("chromeExtension.popup.resume"), () => void act({ kind: "resume.all" }), "button primary wide"),
  );
}

function emptyState(): HTMLElement {
  return el(
    "section",
    { className: "empty" },
    el("span", { className: "badge" }, icon("layers")),
    el("p", { className: "muted", text: t("chromeExtension.popup.noProjects") }),
  );
}

/** Stop all stays in view in every state. Solid while an agent is active, outlined when none is. */
function footer(status: StatusView): HTMLElement {
  const working = status.projects.some((project) => project.agents.some((agent) => agent.active));
  const stop = button(
    t("chromeExtension.popup.stopAll"),
    () => void act({ kind: "stop.all" }),
    working ? "button danger solid" : "button danger",
  );
  stop.disabled = status.stopped;
  stop.setAttribute("aria-keyshortcuts", "Alt+Shift+K");
  const hint = el("kbd", { text: "⌥⇧K" });
  hint.setAttribute("aria-hidden", "true");
  stop.append(hint);
  return el(
    "footer",
    { className: "bar" },
    stop,
    button(t("chromeExtension.popup.disconnect"), () => void act({ kind: "disconnect" }), "link"),
  );
}

function render(status: StatusView): void {
  if (!root) return;
  const scrolled = root.querySelector(".scroll")?.scrollTop ?? 0;
  const content =
    status.link !== "connected"
      ? stateCard(status.link)
      : status.projects.length === 0
        ? emptyState()
        : el("ul", { className: "projects" }, ...status.projects.map(renderProject));
  const body = el("div", { className: "scroll" }, status.stopped && stoppedBanner(), content);
  root.replaceChildren(el("header", { className: "top" }, brand(), seal(status.link)), body, footer(status));
  body.scrollTop = scrolled;
}

function renderProject(project: ProjectView): HTMLLIElement {
  const tabs = el("span", { className: "chip", text: t("chromeExtension.popup.tabCount", [String(project.tabs)]) });
  const toggle = project.paused
    ? button(
        t("chromeExtension.popup.resume"),
        () => void act({ kind: "project.resume", projectKey: project.projectKey }),
        "button compact accent",
      )
    : button(
        t("chromeExtension.popup.pause"),
        () => void act({ kind: "project.pause", projectKey: project.projectKey }),
        "button compact",
      );
  const head = el(
    "div",
    { className: "project-head" },
    el("div", { className: "project-title" }, el("strong", { text: project.title }), tabs),
    toggle,
  );
  const agents =
    project.agents.length > 0 &&
    el(
      "div",
      { className: "agents" },
      ...project.agents.map((agent) => {
        const avatar = el("span", {
          className: agent.active ? "avatar active" : "avatar",
          text: agent.initials,
          label: agent.label,
        });
        avatar.setAttribute("role", "img");
        return avatar;
      }),
    );
  const blocked =
    project.blocked.length > 0 &&
    el(
      "section",
      { className: "floor" },
      el("h3", {}, icon("lock", "icon small"), el("span", { text: t("chromeExtension.popup.blockedTitle") })),
      el("p", { className: "muted", text: t("chromeExtension.popup.blockedHelp") }),
      ...project.blocked.map((origin) => blockedRow(project.projectKey, origin)),
    );
  const allowed =
    project.unlocked.length > 0 &&
    el(
      "section",
      { className: "floor" },
      el("h3", {}, icon("check", "icon small"), el("span", { text: t("chromeExtension.popup.allowedTitle") })),
      ...project.unlocked.map((origin) =>
        el(
          "div",
          { className: "row" },
          el("span", { className: "origin", text: origin }),
          button(
            t("chromeExtension.popup.blockAgain"),
            () => void act({ kind: "floor.relock", projectKey: project.projectKey, origin }),
            "button compact",
          ),
        ),
      ),
    );
  const card = el("li", { className: project.paused ? "project paused" : "project" }, head, agents, blocked, allowed);
  card.style.setProperty("--pc", project.color);
  return card;
}

function blockedRow(projectKey: string, origin: string): HTMLDivElement {
  const row = el("div", { className: "row" });
  const offer = async () => {
    const answer = await ask({ kind: "floor.options", projectKey, origin });
    if (answer.kind !== "floor.options") return;
    const choices = answer.options.map((option) => button(option, () => void choose(option), "button choice"));
    row.classList.add("offer");
    row.replaceChildren(
      el("p", { text: t("chromeExtension.popup.allowPrompt", [origin]) }),
      ...choices,
      button(t("chromeExtension.popup.cancel"), () => void refresh(), "link"),
    );
  };
  const choose = async (choice: string) => {
    const answer = await ask({ kind: "floor.unlock", projectKey, origin, choice });
    if (answer.kind === "error") row.replaceChildren(el("p", { text: t("chromeExtension.popup.choiceMismatch") }));
    else await refresh();
  };
  row.append(
    el("span", { className: "origin", text: origin }),
    button(t("chromeExtension.popup.allow"), () => void offer(), "button compact"),
  );
  return row;
}

setLanguage();
void refresh();
