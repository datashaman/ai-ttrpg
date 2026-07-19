import assert from "node:assert/strict";

import {
  runNaturalLanguagePlay,
  type InterpretationModel,
} from "../../src/natural-language-play.js";
import type {
  CheckActionDefinition,
  EventStore,
  StructuredPlayApplication,
  StructuredPlayOptions,
} from "../../src/structured-play.js";
import { beginAdventureFixture } from "./adventure-fixture.js";
import {
  enterConfrontation,
  resolveAction,
  scriptedRandomSource,
} from "./confrontation-fixture.js";
import { scriptedIO } from "./scripted-io.js";

export interface CanonicalV1Fixture {
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
): CanonicalV1Fixture => ({ name, eventStore, state: app.view().state });

export const canonicalV1Fixtures = async (): Promise<
  readonly CanonicalV1Fixture[]
> => {
  const fixtures: CanonicalV1Fixture[] = [];

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

  return fixtures;
};
