import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  type EventStore,
} from "../src/structured-play.js";
import {
  projectWorldKnowledge,
  type WorldKnowledgeActorScope,
} from "../src/world-knowledge.js";
import { canonicalV1Fixtures } from "./support/canonical-v1-fixtures.js";

const replay = (eventStore: EventStore): string => {
  const events = structuredClone(eventStore.readAll());
  const replayStore: EventStore = {
    readAll: () => events,
    append: () => {
      throw new Error("Replay must not append events.");
    },
  };
  return JSON.stringify(
    createStructuredPlayApplication({ eventStore: replayStore }).view().state,
  );
};

test("every canonical v1 fixture rebuilds a byte-equivalent normalized projection", async (t) => {
  for (const fixture of await canonicalV1Fixtures()) {
    await t.test(fixture.name, () => {
      assert.equal(replay(fixture.eventStore), JSON.stringify(fixture.state));
    });
  }
});

test("every canonical v1 fixture rebuilds byte-equivalent World Knowledge", async (t) => {
  const actorScopes: readonly WorldKnowledgeActorScope[] = [
    "Player",
    "Game Master",
  ];
  for (const fixture of await canonicalV1Fixtures()) {
    await t.test(fixture.name, () => {
      for (const actorScope of actorScopes) {
        const expected = projectWorldKnowledge({
          actorScope,
          events: fixture.eventStore.readAll(),
        });
        const rebuilt = projectWorldKnowledge({
          actorScope,
          events: structuredClone(fixture.eventStore.readAll()),
        });
        assert.equal(JSON.stringify(rebuilt), JSON.stringify(expected));
        if (actorScope === "Player") {
          assert.deepEqual(
            rebuilt.entries
              .filter((entry) => entry.kind === "Established Fact")
              .map(({ id, text }) => ({ id, text })),
            fixture.state.establishedFacts,
          );
        }
      }
    });
  }
});

test("the canonical Timeline branch fixture preserves and rebuilds both histories", () => {
  const timelineStore = createInMemoryTimelineStore({ seed: 5 });
  const app = createStructuredPlayApplication({ timelineStore });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "force-side-door" });
  const sourceTimelineId = timelineStore.view().activeTimelineId;
  const sourceEvents = JSON.stringify(
    timelineStore.readTimeline(sourceTimelineId),
  );

  const branched = app.submit({ type: "branch-timeline", eventPosition: 2 });
  assert.equal(branched.status, "accepted");
  const branchTimelineId = timelineStore.view().activeTimelineId;
  const branchEvents = JSON.stringify(
    timelineStore.readTimeline(branchTimelineId),
  );
  const beforeRebuild = JSON.stringify(app.view());

  const rebuilt = createStructuredPlayApplication({ timelineStore }).view();

  assert.equal(JSON.stringify(rebuilt), beforeRebuild);
  assert.equal(
    JSON.stringify(timelineStore.readTimeline(sourceTimelineId)),
    sourceEvents,
  );
  assert.equal(
    JSON.stringify(timelineStore.readTimeline(branchTimelineId)),
    branchEvents,
  );
});
