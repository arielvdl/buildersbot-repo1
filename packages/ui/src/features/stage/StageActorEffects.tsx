import { Match, Switch } from "solid-js";
import type { StageActivity } from "./stage-activity";

/**
 * What flies, spins or glows round an agent for what it does: thought puffs, code glyphs, an orbit
 * with a terminal, a page that is read, sparks, a question. Only the effects of the current activity
 * are in the DOM, so a stage of eight agents holds a few nodes for each and nothing else. Each one
 * is a CSS loop on `transform` or `opacity` (`agent-stage.css`). It is drawn on the 100 by 108 plane
 * of the figure; the actor scales the plane with `--stage-scale`.
 */
export function StageActorEffects(props: { activity: StageActivity }) {
  return (
    <div class="agent-stage-fx" aria-hidden="true">
      <Switch>
        <Match when={props.activity === "thinking"}>
          <i class="agent-stage-fx-puff agent-stage-fx-puff-1" />
          <i class="agent-stage-fx-puff agent-stage-fx-puff-2" />
          <i class="agent-stage-fx-puff agent-stage-fx-puff-3" />
        </Match>
        <Match when={props.activity === "editing"}>
          <b class="agent-stage-fx-glyph agent-stage-fx-glyph-1" />
          <b class="agent-stage-fx-glyph agent-stage-fx-glyph-2" />
          <b class="agent-stage-fx-glyph agent-stage-fx-glyph-3" />
        </Match>
        <Match when={props.activity === "running"}>
          <span class="agent-stage-fx-orbit">
            <span>
              <i />
              <i />
              <i />
            </span>
          </span>
          <span class="agent-stage-fx-terminal">
            <u />
          </span>
        </Match>
        <Match when={props.activity === "reading"}>
          <span class="agent-stage-fx-sheet">
            <i />
            <i />
            <i />
            <s />
          </span>
        </Match>
        <Match when={props.activity === "done"}>
          <span class="agent-stage-fx-spark agent-stage-fx-spark-1" />
          <span class="agent-stage-fx-spark agent-stage-fx-spark-2" />
          <span class="agent-stage-fx-spark agent-stage-fx-spark-3" />
          <span class="agent-stage-fx-spark agent-stage-fx-spark-4" />
        </Match>
        <Match when={props.activity === "waiting"}>
          <span class="agent-stage-fx-question" />
        </Match>
      </Switch>
    </div>
  );
}
