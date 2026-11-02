/**
 * A small DOM builder for the extension pages. Text goes in through `textContent` only: a project title
 * or a site comes from the app or a page, and is never parsed as HTML.
 */

import type { PageRequest, PageResponse } from "./messages";

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; label?: string; onClick?: () => void } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.label !== undefined) node.setAttribute("aria-label", options.label);
  if (options.onClick) {
    const click = options.onClick;
    node.addEventListener("click", click);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function button(text: string, onClick: () => void, className = "button"): HTMLButtonElement {
  const node = el("button", { className, text, onClick });
  node.type = "button";
  return node;
}

/** Sends a request to the service worker and returns its answer. */
export async function ask(request: PageRequest): Promise<PageResponse> {
  const answer = await chrome.runtime.sendMessage<PageResponse>(request);
  return answer ?? { kind: "error", message: "no answer" };
}

export function setLanguage(): void {
  document.documentElement.lang = chrome.i18n.getMessage("@@ui_locale").replace("_", "-") || "en";
}

export type IconName = "eye" | "send" | "ban" | "stop" | "plug" | "alert" | "lock" | "layers" | "check";

type Shape = readonly [tag: "path" | "circle" | "rect", attributes: { readonly [name: string]: string }];

/** Fixed drawings on a 24 x 24 grid. Constants of this file: nothing from the app or a page goes in. */
const ICONS: Readonly<{ [name in IconName]: readonly Shape[] }> = {
  eye: [
    ["path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" }],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
  send: [["path", { d: "M7 17 17 7M8 7h9v9" }]],
  ban: [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "m5.6 5.6 12.8 12.8" }],
  ],
  stop: [["path", { d: "M8 3h8l5 5v8l-5 5H8l-5-5V8z" }]],
  plug: [["path", { d: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5" }]],
  alert: [["path", { d: "M12 3 22 21H2zM12 10v5M12 18h.01" }]],
  lock: [
    ["rect", { x: "5", y: "11", width: "14", height: "10", rx: "2" }],
    ["path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }],
  ],
  layers: [["path", { d: "m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" }]],
  check: [["path", { d: "m5 12.5 4.5 4.5L19 7.5" }]],
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** A decorative stroke icon that takes the text color. It is hidden from screen readers. */
export function icon(name: IconName, className = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, attributes] of ICONS[name]) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}
