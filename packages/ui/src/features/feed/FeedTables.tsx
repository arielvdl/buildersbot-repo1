/**
 * The top of the feed page: one table for each project that has an agent at work. The agents sit at
 * the table with the cube of the app, in the motion of what they do. A click on the name of a project
 * filters the feed by it, and a click on a cube filters it by that agent; the table itself is only a
 * picture. The tables come from `feedTablesModel`, which reads the cards and nothing else, and the page
 * draws again only when what the tables show has changed. With nobody at work it is a strip, with no
 * observer, no timer and no animation.
 */

import { Button, ChevronDown, ChevronUp, IconButton } from "@buildersbot/ui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { createTaskListPlayState } from "../conversation/TaskList";
import type { StageActorData } from "../stage/StageActor";
import { StageBoard } from "../stage/StageBoard";
import "../stage/agent-stage.css";
import "./feed-tables.css";
import type { FeedItem } from "@buildersbot/contracts/ipc";
import {
  assignTableSeats,
  EMPTY_FEED_TABLES,
  type FeedAgentProfile,
  type FeedTable,
  type FeedTablesModel,
  feedTablesModel,
  sameFeedTables,
} from "./feed-tables-model";

/** The widest table: a feed table is a small version of the table of a channel. */
const TABLE_MAX_WIDTH = 164;

export interface FeedTablesProps {
  items: readonly FeedItem[];
  /** The agents that the window knows, for the model and the colour of a cube. */
  agents: readonly FeedAgentProfile[];
  /** The project and the agent that the feed is filtered by, as keys. */
  project: string | null;
  agent: string | null;
  onProject: (key: string | null) => void;
  onAgent: (key: string | null) => void;
  /** The reader folded the tables into a strip. */
  folded: boolean;
  onFoldedChange: (folded: boolean) => void;
}

export function FeedTables(props: FeedTablesProps) {
  const { t } = useText();
  // One reading of the page visibility for every table: each call of this registers a listener.
  const playState = createTaskListPlayState();
  const [tick, setTick] = createSignal(0);
  const seats = new Map<string, number>();
  const profiles = createMemo(() => new Map(props.agents.map((agent) => [agent.key, agent] as const)));

  // The sweep of the cards runs at each delta. The memo stops there unless what the tables show changed.
  const model = createMemo(
    (): FeedTablesModel => {
      tick();
      const next = props.items.length === 0 ? EMPTY_FEED_TABLES : feedTablesModel(props.items, profiles(), Date.now());
      assignTableSeats(seats, next.tables);
      return next;
    },
    { equals: sameFeedTables },
  );

  // One timer, for the next moment that a run leaves its table. None while no run waits to leave.
  createEffect(
    () => model().deadline,
    (deadline) => {
      if (deadline === null) return;
      const timer = setTimeout(() => setTick((value) => value + 1), Math.max(0, deadline - Date.now()) + 20);
      return () => clearTimeout(timer);
    },
  );

  return (
    <section class="feed-tables" aria-label={t("app.feed.tables.label")}>
      <Show when={model().tables.length > 0} fallback={<p class="feed-tables-strip">{t("app.feed.tables.empty")}</p>}>
        <Show
          when={!props.folded}
          fallback={
            <div class="feed-tables-strip">
              <span>{t("app.feed.tables.folded", { count: model().tables.length })}</span>
              <Button variant="ghost" size="sm" type="button" onClick={() => props.onFoldedChange(false)}>
                <ChevronDown aria-hidden="true" />
                {t("app.feed.tables.show")}
              </Button>
            </div>
          }
        >
          <div class="feed-tables-head">
            <h2>{t("app.feed.tables.title")}</h2>
            <IconButton
              label={t("app.feed.tables.fold")}
              variant="ghost"
              size="icon-sm"
              onClick={() => props.onFoldedChange(true)}
            >
              <ChevronUp aria-hidden="true" />
            </IconButton>
          </div>
          <div class="feed-tables-row">
            <For each={model().tables} keyed={(table) => table.key}>
              {(table) => (
                <FeedTableView
                  table={table()}
                  seats={seats}
                  suspended={playState() === "paused"}
                  project={props.project}
                  agent={props.agent}
                  onProject={props.onProject}
                  onAgent={props.onAgent}
                />
              )}
            </For>
            <Show when={model().overflowTables > 0}>
              <span
                class="feed-tables-more"
                role="img"
                aria-label={t("app.feed.tables.moreProjectsLabel", { count: model().overflowTables })}
              >
                {t("app.feed.tables.more", { count: model().overflowTables })}
              </span>
            </Show>
          </div>
        </Show>
      </Show>
    </section>
  );
}

function FeedTableView(props: {
  table: FeedTable;
  seats: ReadonlyMap<string, number>;
  suspended: boolean;
  project: string | null;
  agent: string | null;
  onProject: (key: string | null) => void;
  onAgent: (key: string | null) => void;
}) {
  const { t } = useText();
  const name = () => props.table.name ?? t("app.feed.filter.noProject");
  const actors = createMemo((): StageActorData[] =>
    props.table.actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      provider: actor.provider,
      model: actor.model,
      hue: actor.hue,
      activity: actor.activity,
      line: null,
      delegatesTo: null,
      seat: props.seats.get(`${props.table.key}|${actor.id}`) ?? 0,
    })),
  );
  const chosen = () => props.project === props.table.key;
  return (
    <article class="feed-table" data-chosen={chosen() ? "" : undefined}>
      <div class="feed-table-stage">
        <StageBoard
          actors={actors()}
          links={props.table.links}
          bubbles={false}
          maxTable={TABLE_MAX_WIDTH}
          suspended={props.suspended}
          selectedActor={props.agent}
          onSelectActor={(id) => props.onAgent(props.agent === id ? null : id)}
          selectLabel={(actor) => t("app.feed.tables.filterBy", { name: actor.name })}
        >
          <Show when={props.table.overflow > 0}>
            <span class="feed-table-overflow">{t("app.feed.tables.more", { count: props.table.overflow })}</span>
          </Show>
        </StageBoard>
      </div>
      <div class="feed-table-label">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="feed-table-name"
          aria-pressed={chosen() ? "true" : "false"}
          aria-label={t("app.feed.tables.filterBy", { name: name() })}
          onClick={() => props.onProject(chosen() ? null : props.table.key)}
        >
          {name()}
        </Button>
        <Show when={props.table.now}>
          {(now) => <p class="feed-table-now">{t("app.feed.tables.now", { title: now() })}</p>}
        </Show>
        <p class="feed-table-counts">
          <Show when={props.table.needsYou > 0}>
            <span data-state="needs-you">{t("app.feed.tables.needsYou", { count: props.table.needsYou })}</span>
          </Show>
          <Show when={props.table.working > 0}>
            <span data-state="working">{t("app.feed.tables.working", { count: props.table.working })}</span>
          </Show>
        </p>
      </div>
    </article>
  );
}
