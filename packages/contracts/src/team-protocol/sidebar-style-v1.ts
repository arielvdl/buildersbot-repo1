// Frozen optional sidebar-style-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member reads and
// changes the sidebar layout of a host with everything the host stores, not only the five keys that
// the released `/v1/sidebar-layout` routes carry. The layout adds the color and the icon of each
// section, the markers of the sections and `itemOrder`, the chats and the markers in one sequence.
// The action route takes every action of the released one and the six that no released protocol
// carries: set the color or the icon of a section, and create, update, delete and move a marker. Both
// routes answer with the whole layout. A host sends `sidebar-layout-changed` as it always did, with
// the five released keys, and a client with this capability reads the layout again on that event.
// The released routes keep their meaning and their projection for every peer. Bounds and meaning do
// not follow IPC changes; widening any of it needs a second capability string. A glyph name is
// bounded as text and not as a list, so that a new glyph does not break the wire.
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const SIDEBAR_STYLE_CAPABILITY = "sidebar-style-v1";
export const SIDEBAR_STYLE_ROUTES = {
  /** Read the layout. A POST with an empty body, as the other optional read routes. */
  read: "/v1/sidebar-style",
  /** One action; the answer is the layout after it. */
  action: "/v1/sidebar-style/actions",
} as const;

const STORED_COLOR = /^#[0-9a-f]{6}$/;
const INPUT_COLOR = /^#[0-9a-f]{6}$/i;
const storedColor: AdminDecoder = (value) => {
  if (!isString(value) || !STORED_COLOR.test(value)) throw new Error("Invalid sidebar color.");
  return value;
};
const inputColor: AdminDecoder = (value) => {
  if (!isString(value) || !INPUT_COLOR.test(value)) throw new Error("Invalid sidebar color.");
  return value;
};

const sectionName = string(40);
const markerStyle = oneOf("normal", "dim", "grayscale", "tint");
// The longest stored image is 40 KiB, so its `data:` URL has at most 54,663 characters.
const icon = variant({
  letter: fields({ kind: oneOf("letter"), text: string(16) }),
  glyph: fields({ kind: oneOf("glyph"), glyph: string(64) }),
  emoji: fields({ kind: oneOf("emoji"), emoji: string(32) }),
  image: fields({ kind: oneOf("image"), dataUrl: string(54_700) }),
});

const section = fields({ id: identifier, name: sectionName }, { color: storedColor, icon });
const marker = fields(
  { id: identifier, sectionId: nullable(identifier), label: string(40), style: markerStyle },
  { color: storedColor },
);
const assignments: AdminDecoder = (value) => {
  if (!isDynamicRecord(value)) throw new Error("Invalid sidebar assignments.");
  const entries = Object.entries(value);
  if (entries.length > 10_000) throw new Error("Invalid sidebar assignments.");
  return Object.fromEntries(
    entries.map(([agentId, assigned]) => {
      identifier(agentId);
      return [agentId, identifier(assigned)];
    }),
  );
};

/** The layout of the host: the five released keys, and the style and the markers when there are any. */
const layout = fields(
  {
    revision: count,
    sections: list(section, 100),
    order: list(identifier, 102),
    agentAssignments: assignments,
    agentOrder: list(identifier, 10_000),
  },
  { markers: list(marker, 1_300), itemOrder: list(identifier, 11_300) },
);

const byType =
  (cases: Record<string, AdminDecoder>): AdminDecoder =>
  (value) => {
    const decode =
      isDynamicRecord(value) && isString(value.type) ? new Map(Object.entries(cases)).get(value.type) : undefined;
    if (!decode) throw new Error("Invalid sidebar style action.");
    return decode(value);
  };

const markerFields = { label: string(200), style: markerStyle, color: nullable(inputColor) };
const action = byType({
  create: fields({ type: oneOf("create"), name: sectionName }, { agentId: identifier }),
  rename: fields({ type: oneOf("rename"), sectionId: identifier, name: sectionName }),
  delete: fields({ type: oneOf("delete"), sectionId: identifier }),
  move: fields({ type: oneOf("move"), sectionId: identifier, direction: oneOf("up", "down") }, { steps: count }),
  assign: fields({ type: oneOf("assign"), agentId: identifier, sectionId: nullable(identifier) }),
  "move-agent": fields({
    type: oneOf("move-agent"),
    agentId: identifier,
    sectionId: nullable(identifier),
    beforeAgentId: nullable(identifier),
  }),
  "set-section-color": fields({ type: oneOf("set-section-color"), sectionId: identifier, color: nullable(inputColor) }),
  "set-section-icon": fields({ type: oneOf("set-section-icon"), sectionId: identifier, icon: nullable(icon) }),
  "create-marker": fields({ type: oneOf("create-marker"), sectionId: nullable(identifier), ...markerFields }),
  "update-marker": fields({ type: oneOf("update-marker"), markerId: identifier, ...markerFields }),
  "delete-marker": fields({ type: oneOf("delete-marker"), markerId: identifier }),
  "move-marker": fields({
    type: oneOf("move-marker"),
    markerId: identifier,
    sectionId: nullable(identifier),
    beforeId: nullable(identifier),
  }),
});

export const SIDEBAR_STYLE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIDEBAR_STYLE_ROUTES.read, adminRoute(empty, layout)],
  [SIDEBAR_STYLE_ROUTES.action, adminRoute(action, layout)],
]);
