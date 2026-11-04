// Test only. The child half of `scripts/hub-connections-local-server-e2e.ts`: a process that stands in for
// a local server of the desktop app. It has no Cultura Builder session and its fetch refuses every
// request, so the only way to the Hub is the channel on its standard input and output, which the real
// delegate (`openParentHubChannel`) speaks. Around it run the real agent service, tool router, Guard and
// approval cards, with the fake Codex of the other Hub checks.
//
// The parent drives it with files in the folder `root`: `cmd-<n>.json` names the calls of one turn and
// the answer to each Hub card, and `out-<n>.json` has what the agent read. It ends when its input ends.
//
// `bun scripts/fake-hub/local-server-child.ts <root>`; started by the E2E script, not by hand.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HUB_DELEGATE_PREFIX } from "../../src/backend/hub-connections/hub-delegate-protocol";
import { openParentHubChannel } from "../../src/main/local-servers/parent-hub-channel";
import { type Call, startAgentHarness, waitFor } from "./agent-harness";

const root = process.argv[2];
if (!root) throw new Error("Usage: local-server-child.ts <root>");

// First of all, as in the app: the parent writes its hello line right after it starts this process.
const channel = openParentHubChannel(process.stdin, process.stdout);
process.stdin.once("end", () => process.exit(0));

interface Command {
  readonly calls?: readonly Call[];
  /** The answer to each Hub card of the turn (cost and payer), in order. Other cards are allowed. */
  readonly cards?: ReadonlyArray<"accept" | "decline">;
  /** Waits until the snapshot of the app says this, before the turn. */
  readonly signedIn?: boolean;
  /** Lines to write to the channel as they are, as a child that is not honest would. */
  readonly rawLines?: readonly string[];
  readonly done?: boolean;
}

const HUB_CARD = /^(?:An agent wants to run|Who pays for|Pay for)/u;
let plan: Array<"accept" | "decline"> = [];
const cards: Array<{ reason: string; decision: string }> = [];
let fetches = 0;

const harness = await startAgentHarness({
  root: join(root, "server"),
  mark: "HUB-LOCAL-SERVER",
  // The child has no session: a request of its own to the Hub would be a leak.
  hubFetch: Object.assign(
    () => {
      fetches += 1;
      return Promise.reject(new Error("The local server must not reach the Hub by itself."));
    },
    { preconnect: fetch.preconnect },
  ),
  session: () => null,
  saveSession: () => undefined,
  hubClient: channel,
  decide: (card) => {
    const decision = HUB_CARD.test(card.reason) ? (plan.shift() ?? "decline") : "accept";
    cards.push({ reason: card.reason, decision });
    return decision;
  },
  // As main does with `shell.openExternal`: the person approves on the Hub page, which the parent plays.
  openHub: async (url) => {
    appendFileSync(join(root, "opened.log"), `${url}\n`);
  },
});

writeFileSync(join(root, "ready"), "ready");
for (let index = 1; ; index += 1) {
  const path = join(root, `cmd-${index}.json`);
  const command: Command = await waitFor(
    `command ${index}`,
    () => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null),
    10 * 60_000,
  );
  if (command.done) break;
  if (command.signedIn !== undefined) {
    const expected = command.signedIn;
    await waitFor(`the snapshot to say signed in: ${expected}`, () => channel.signedIn() === expected, 30_000);
  }
  for (const line of command.rawLines ?? []) process.stdout.write(`${HUB_DELEGATE_PREFIX}${line}\n`);
  plan = [...(command.cards ?? [])];
  const cardsBefore = cards.length;
  const results = command.calls && command.calls.length > 0 ? await harness.turn([...command.calls]) : [];
  writeFileSync(
    join(root, `out-${index}.json`),
    JSON.stringify({ results, cards: cards.slice(cardsBefore), ownHubRequests: fetches }),
  );
}
await harness.stop();
process.exit(0);
