import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type CheckActionDefinition,
} from "../src/structured-play.js";
import {
  DEFAULT_CHECK_ACTIONS,
  DEFAULT_CONFRONTATION,
} from "../src/locked-manor-content.js";
import {
  COLLAPSING_GATE_ACTION,
  enterConfrontation as enterConfrontationFlow,
  resolveAction,
  scriptedRandomSource,
} from "./support/confrontation-fixture.js";

const enterConfrontation = (rolls: readonly number[]) => {
  const app = createStructuredPlayApplication({
    randomSource: scriptedRandomSource(rolls),
  });
  enterConfrontationFlow(app);
  return app;
};

test("filling Resistance commits the visible successful ending and closes the Confrontation", () => {
  const app = enterConfrontation([6, 6, 6, 6, 6, 6]);
  const started = app.view();

  assert.equal(started.state.activeScene, "confrontation");
  assert.deepEqual(started.state.confrontation, {
    id: "cellar-guardian",
    status: "active",
    resistanceClock: {
      current: 0,
      capacity: 2,
      fillingConsequence: {
        id: "cellar-guardian-overcome",
        text: "The cult guardian is overcome and the cellar is secured.",
      },
    },
    dangerClock: {
      current: 0,
      capacity: 2,
      fillingConsequence: {
        id: "mara-captured-by-guardian",
        text: "The cult guardian captures Mara and drags her into the cells.",
      },
    },
    healthZeroConsequence: {
      id: "mara-overwhelmed-and-imprisoned",
      text: "Overwhelmed by her injuries, Mara wakes imprisoned in the manor cells.",
    },
    defeatEffects: [{ type: "add-condition", condition: "Restrained" }],
    ending: null,
  });

  const firstExchange = resolveAction(app, "drive-back-cult-guardian");
  assert.equal(firstExchange.status, "accepted");
  assert.equal(firstExchange.state.confrontation?.resistanceClock.current, 1);
  assert.equal(firstExchange.state.confrontation?.dangerClock.current, 0);
  assert.ok(
    firstExchange.availableActions.some(
      (action) => action.id === "drive-back-cult-guardian",
    ),
  );

  const victory = resolveAction(app, "drive-back-cult-guardian");

  assert.equal(victory.status, "accepted");
  assert.equal(victory.state.confrontation, null);
  assert.equal(victory.state.activeScene, null);
  assert.equal(
    victory.state.establishedFacts.some(
      (fact) => fact.id === "cellar-guardian-overcome",
    ),
    true,
  );
  assert.deepEqual(
    victory.appendedEvents.map((event) => event.type),
    ["CheckResolved", "ConfrontationEnded", "AdventureEnded"],
  );
});

test("filling Danger commits the visible Defeat and enters a consequence Scene", () => {
  const app = enterConfrontation([6, 6, 1, 1, 1, 1]);

  const firstExchange = resolveAction(app, "drive-back-cult-guardian");
  assert.equal(firstExchange.state.confrontation?.dangerClock.current, 1);
  assert.equal(firstExchange.state.playerCharacter?.health, 2);

  const defeat = resolveAction(app, "drive-back-cult-guardian");

  assert.equal(defeat.status, "accepted");
  assert.equal(defeat.state.confrontation, null);
  assert.equal(defeat.state.activeScene, "consequence");
  assert.equal(defeat.state.playerCharacter?.health, 1);
  assert.deepEqual(defeat.state.conditions, ["Restrained"]);
  assert.match(defeat.message, /captures Mara/);
  assert.deepEqual(
    defeat.appendedEvents.map((event) => event.type),
    ["CheckResolved", "ConfrontationEnded"],
  );
  assert.equal(
    defeat.state.establishedFacts.some(
      (fact) => fact.id === "mara-captured-by-guardian",
    ),
    true,
  );
});

test("Success with Cost advances both predeclared Confrontation Clocks", () => {
  const app = enterConfrontation([6, 6, 2, 5]);

  const exchange = resolveAction(app, "drive-back-cult-guardian");

  assert.equal(exchange.state.lastCheckResolution?.outcome, "Success with Cost");
  assert.equal(exchange.state.confrontation?.resistanceClock.current, 1);
  assert.equal(exchange.state.confrontation?.dangerClock.current, 1);
  assert.equal(exchange.state.confrontation?.status, "active");
});

test("zero Health commits Defeat even when Danger is not filled", () => {
  const app = createStructuredPlayApplication({
    randomSource: scriptedRandomSource([6, 6, 1, 1, 1, 1, 1, 1]),
    checkActions: [
      ...DEFAULT_CHECK_ACTIONS.filter(
        (action) => action.id === "force-side-door",
      ),
      COLLAPSING_GATE_ACTION,
    ],
  });
  enterConfrontationFlow(app);

  resolveAction(app, "hold-collapsing-gate");
  resolveAction(app, "hold-collapsing-gate");
  const defeat = resolveAction(app, "hold-collapsing-gate");

  assert.equal(defeat.state.playerCharacter?.health, 0);
  assert.equal(defeat.state.confrontation, null);
  assert.equal(
    defeat.state.establishedFacts.some(
      (fact) => fact.id === "mara-overwhelmed-and-imprisoned",
    ),
    true,
  );
  assert.equal(defeat.state.activeScene, "consequence");
  assert.deepEqual(defeat.state.conditions, ["Restrained"]);
});

test("replay reproduces Adventure consequences and completed Confrontation teardown", () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: scriptedRandomSource([6, 6, 1, 1, 1, 1]),
  });
  enterConfrontationFlow(app);
  resolveAction(app, "drive-back-cult-guardian");
  resolveAction(app, "drive-back-cult-guardian");
  const beforeRestart = app.view();

  const afterRestart = createStructuredPlayApplication({ eventStore }).view();

  assert.deepEqual(afterRestart.state, beforeRestart.state);
  assert.equal(afterRestart.state.confrontation, null);
  assert.equal(afterRestart.state.playerCharacter?.health, 1);
  assert.deepEqual(afterRestart.state.conditions, ["Restrained"]);
  assert.equal(
    afterRestart.state.establishedFacts.some(
      (fact) => fact.id === "mara-captured-by-guardian",
    ),
    true,
  );
  assert.equal(afterRestart.state.activeScene, "consequence");
});

test("Clock effects are rejected on actions available outside a Confrontation", () => {
  const invalidAction: CheckActionDefinition = {
    ...DEFAULT_CHECK_ACTIONS.find(
      (action) => action.id === "drive-back-cult-guardian",
    )!,
    availableInScenes: ["arrival", "confrontation"],
  };

  assert.throws(
    () => createStructuredPlayApplication({ checkActions: [invalidAction] }),
    /Invalid Outcome Consequence or stake/,
  );
});

test("an active Confrontation completes from its recorded definition after configuration changes", () => {
  const eventStore = createInMemoryEventStore();
  const firstSession = createStructuredPlayApplication({
    eventStore,
    randomSource: scriptedRandomSource([6, 6]),
  });
  enterConfrontationFlow(firstSession);
  const replacementDefinition = {
    ...DEFAULT_CONFRONTATION,
    resistanceClock: {
      capacity: 1,
      fillingConsequence: {
        id: "replacement-victory",
        text: "A replacement definition claims immediate victory.",
      },
    },
    defeatEffects: [{ type: "add-condition" as const, condition: "Shaken" as const }],
  };
  const resumed = createStructuredPlayApplication({
    eventStore,
    confrontation: replacementDefinition,
    randomSource: scriptedRandomSource([6, 6, 6, 6]),
  });

  const firstExchange = resolveAction(resumed, "drive-back-cult-guardian");
  assert.equal(firstExchange.state.confrontation?.status, "active");
  assert.equal(firstExchange.state.confrontation?.resistanceClock.capacity, 2);
  const victory = resolveAction(resumed, "drive-back-cult-guardian");

  assert.equal(victory.state.confrontation, null);
  assert.equal(
    victory.state.establishedFacts.some(
      (fact) => fact.id === "cellar-guardian-overcome",
    ),
    true,
  );
  assert.deepEqual(victory.state.conditions, []);
});

test("ending a Confrontation clears Shaken with the Scene", () => {
  const finishingAction: CheckActionDefinition = {
    id: "rally-against-guardian",
    label: "Rally against the guardian",
    kind: "Check",
    goal: "Overcome the guardian",
    trait: "Might",
    availableInScenes: ["confrontation"],
    stakes: {
      Setback: {
        summary: "Danger escalates.",
        consequences: [{ type: "advance-clock", clock: "Danger", amount: 1 }],
      },
      "Success with Cost": {
        summary: "You make progress while Shaken.",
        consequences: [
          { type: "advance-clock", clock: "Resistance", amount: 1 },
          { type: "add-condition", condition: "Shaken" },
        ],
      },
      "Clean Success": {
        summary: "You prevail but remain Shaken for the moment.",
        consequences: [
          { type: "advance-clock", clock: "Resistance", amount: 1 },
          { type: "add-condition", condition: "Shaken" },
        ],
      },
    },
  };
  const app = createStructuredPlayApplication({
    randomSource: scriptedRandomSource([6, 6, 6, 6]),
    checkActions: [
      ...DEFAULT_CHECK_ACTIONS.filter(
        (action) => action.id === "force-side-door",
      ),
      finishingAction,
    ],
    confrontation: {
      ...DEFAULT_CONFRONTATION,
      resistanceClock: {
        ...DEFAULT_CONFRONTATION.resistanceClock,
        capacity: 1,
      },
    },
  });
  enterConfrontationFlow(app);

  const victory = resolveAction(app, "rally-against-guardian");

  assert.equal(victory.state.confrontation, null);
  assert.deepEqual(victory.state.conditions, []);
});
