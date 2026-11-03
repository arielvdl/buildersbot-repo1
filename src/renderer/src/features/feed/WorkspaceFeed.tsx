import { FeedPage } from "@buildersbot/ui/features/feed/FeedPage";
import type { FeedAgentProfile } from "@buildersbot/ui/features/feed/feed-tables-model";
import { feedAgentKey } from "@buildersbot/ui/features/feed/feed-view";
import { useText } from "@buildersbot/ui/text";
import { createMemo } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { createFeedOpener } from "./feed-open";
import { feedPort } from "./feed-port";
import { createFeedTablesFold } from "./feed-tables-storage";
import { createFeedStore } from "./stores/feed-store";

/**
 * The feed page of the desktop window. The cards come from main, for every server. The agents of the
 * active server give each card its face. An action on a card goes to main with ids only (`feed.act`),
 * and main calls the operation of the conversation or of the load panel.
 */
export function WorkspaceFeed() {
  const { t, errorMessage } = useText();
  const { activeServerId } = useServers();
  const { agentList } = useAgents();
  const feed = createFeedStore(feedPort, (cause) => errorMessage(cause, t("app.feed.loadFailed")));
  const faces = createMemo((): FeedAgentProfile[] =>
    agentList().map((agent) => ({
      key: feedAgentKey({ serverId: activeServerId(), agentId: agent.id }),
      avatarSeed: agent.avatarSeed,
      avatarHue: agent.avatarHue,
      avatarUrl: agent.avatarUrl,
      provider: agent.provider,
      model: agent.model,
    })),
  );
  const tables = createFeedTablesFold();
  const open = createFeedOpener();
  return (
    <FeedPage
      items={feed.items()}
      agents={faces()}
      tablesFolded={tables.folded()}
      onTablesFoldedChange={tables.setFolded}
      loading={feed.state.loading}
      error={feed.state.error}
      onOpen={open}
      onAct={(input) => feedPort().act(input)}
    />
  );
}
