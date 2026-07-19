import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  type CheckActionDefinition,
  type EventStore,
  type StructuredPlayApplication,
  type StructuredPlayOptions,
} from "../src/structured-play.js";
import {
  runNaturalLanguagePlay,
  type InterpretationModel,
} from "../src/natural-language-play.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import {
  enterConfrontation,
  resolveAction,
  scriptedRandomSource,
} from "./support/confrontation-fixture.js";
import { scriptedIO } from "./support/scripted-io.js";

interface CanonicalFixture {
  readonly name: string;
  readonly eventStore: EventStore;
  readonly state: ReturnType<StructuredPlayApplication["view"]>["state"];
}

const begin = (
  rolls: readonly number[] = [],
  options: Omit<
    StructuredPlayOptions,
    "eventStore" | "randomSource" | "timelineStore"
  > = {},
) =>
  beginAdventureFixture({
    applicationOptions: options,
    randomSource: scriptedRandomSource(rolls),
  });

const record = (
  name: string,
  app: StructuredPlayApplication,
  eventStore: EventStore,
): CanonicalFixture => ({ name, eventStore, state: app.view().state });

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
  const fixtures: CanonicalFixture[] = [];

  const freeAction = begin();
  freeAction.app.submit({ type: "choose-action", actionId: "survey-manor" });
  fixtures.push(record("Free Action", freeAction.app, freeAction.eventStore));

  const check = begin([3, 4]);
  resolveAction(check.app, "force-side-door");
  fixtures.push(record("Check", check.app, check.eventStore));

  const interrupted = begin([3, 4]);
  const proposed = interrupted.app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  interrupted.app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  fixtures.push(
    record(
      "Pending Choice interruption",
      interrupted.app,
      interrupted.eventStore,
    ),
  );

  const resolveSpend = begin([3, 4]);
  resolveAction(resolveSpend.app, "force-side-door", "spend-resolve");
  fixtures.push(
    record("Resolve spend", resolveSpend.app, resolveSpend.eventStore),
  );

  const inventoryAction: CheckActionDefinition = {
    id: "cross-broken-floor",
    label: "Cross the broken floor",
    kind: "Check",
    goal: "Cross the broken floor safely",
    trait: "Wits",
    stakes: {
      Setback: {
        summary: "The floor gives way and causes harm.",
        consequences: [{ type: "lose-health", amount: 1 }],
      },
      "Success with Cost": {
        summary: "The floor gives way after the crossing.",
        consequences: [],
      },
      "Clean Success": { summary: "The crossing is safe.", consequences: [] },
    },
  };
  const inventory = begin([1, 1], { checkActions: [inventoryAction] });
  resolveAction(inventory.app, inventoryAction.id);
  inventory.app.submit({ type: "use-field-kit", resource: "Health" });
  fixtures.push(
    record("Inventory Item use", inventory.app, inventory.eventStore),
  );

  const oracle = begin([50]);
  oracle.app.submit({ type: "choose-action", actionId: "survey-manor" });
  const recommendation = oracle.app.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  });
  assert.ok(recommendation.state.pendingNarratorRecommendation);
  oracle.app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.state.pendingNarratorRecommendation.id,
    likelihood: "Even",
  });
  fixtures.push(record("Oracle question", oracle.app, oracle.eventStore));

  const transitioned = begin([], {
    checkActions: [],
    oracleActions: [],
    freeActions: [
      {
        id: "open-servants-passage",
        label: "Open the servants' passage",
        kind: "Free Action",
        establishedFact: {
          id: "servants-passage-open",
          text: "The servants' passage is open.",
        },
        availableInScenes: ["arrival"],
        requiredFactIds: [],
      },
    ],
    sceneTransitions: [
      {
        from: "arrival",
        to: "discovery",
        requiredFactIds: ["servants-passage-open"],
        automatic: true,
      },
    ],
    adventureEndings: [],
  });
  transitioned.app.submit({
    type: "choose-action",
    actionId: "open-servants-passage",
  });
  fixtures.push(
    record("Scene transition", transitioned.app, transitioned.eventStore),
  );

  const confrontation = begin([6, 6, 6, 6, 6, 6]);
  enterConfrontation(confrontation.app);
  resolveAction(confrontation.app, "drive-back-cult-guardian");
  resolveAction(confrontation.app, "drive-back-cult-guardian");
  fixtures.push(
    record(
      "Contested Action and Confrontation exchange",
      confrontation.app,
      confrontation.eventStore,
    ),
  );

  const invalidCommand = begin();
  const rejected = invalidCommand.app.submit({
    type: "choose-action",
    actionId: "not-an-authored-action",
  });
  assert.equal(rejected.status, "rejected");
  fixtures.push(
    record("invalid command", invalidCommand.app, invalidCommand.eventStore),
  );

  const rulesQuery = begin();
  const beforeQuery = JSON.stringify(rulesQuery.eventStore.readAll());
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "interpreted",
      classification: "rules-query",
      referencedEntityIds: ["scene:arrival"],
    }),
  };
  await runNaturalLanguagePlay({
    io: scriptedIO(["What rules apply here?"]).io,
    interpreter,
    eventStore: rulesQuery.eventStore,
  });
  assert.equal(JSON.stringify(rulesQuery.eventStore.readAll()), beforeQuery);
  fixtures.push(record("rules query", rulesQuery.app, rulesQuery.eventStore));

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      assert.equal(replay(fixture.eventStore), JSON.stringify(fixture.state));
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
