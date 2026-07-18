import assert from "node:assert/strict";
import test from "node:test";

import {
  createSeededRandomSource,
  createStructuredPlayApplication,
  type CheckActionDefinition,
  type StructuredPlayApplication,
} from "../src/structured-play.js";

const SCENE_EXIT_OPEN = {
  type: "establish-fact" as const,
  fact: {
    id: "scene-exit-open",
    text: "The way into the next Scene is open.",
  },
};

const riskyApproaches: readonly CheckActionDefinition[] = [
  {
    id: "search-dark-cellar",
    label: "Search the dark cellar by Lantern light",
    kind: "Check",
    goal: "Search the dark cellar safely",
    trait: "Wits",
    requiredItem: "Lantern",
    requiresFreeMovement: true,
    stakes: {
      Setback: {
        summary: "The search causes harm and leaves you Shaken.",
        consequences: [
          { type: "lose-health", amount: 1 },
          { type: "add-condition", condition: "Shaken" },
          SCENE_EXIT_OPEN,
        ],
      },
      "Success with Cost": {
        summary: "The search succeeds, but the Lantern is lost.",
        consequences: [
          {
            type: "remove-inventory-item",
            item: "Lantern",
            reason: "loss",
          },
        ],
      },
      "Clean Success": { summary: "The search succeeds.", consequences: [] },
    },
  },
  {
    id: "pick-cellar-lock",
    label: "Pick the cellar lock",
    kind: "Check",
    goal: "Open the cellar lock",
    trait: "Wits",
    requiredItem: "Lockpick Set",
    requiresFreeMovement: true,
    stakes: {
      Setback: {
        summary: "The Lockpick Set breaks.",
        consequences: [
          {
            type: "remove-inventory-item",
            item: "Lockpick Set",
            reason: "breakage",
          },
        ],
      },
      "Success with Cost": { summary: "The lock opens noisily.", consequences: [] },
      "Clean Success": { summary: "The lock opens quietly.", consequences: [] },
    },
  },
  {
    id: "cut-bonds",
    label: "Cut the bonds with the Short Blade",
    kind: "Check",
    goal: "Cut through the bonds",
    trait: "Might",
    requiredItem: "Short Blade",
    requiresFreeMovement: false,
    stakes: {
      Setback: { summary: "The bonds hold.", consequences: [] },
      "Success with Cost": {
        summary: "The bonds part, but the blade is surrendered.",
        consequences: [
          { type: "remove-condition", condition: "Restrained" },
          {
            type: "remove-inventory-item",
            item: "Short Blade",
            reason: "surrender",
          },
        ],
      },
      "Clean Success": {
        summary: "The bonds part.",
        consequences: [{ type: "remove-condition", condition: "Restrained" }],
      },
    },
  },
];

const begin = (seed: number, actions = riskyApproaches): StructuredPlayApplication => {
  const app = createStructuredPlayApplication({
    randomSource: createSeededRandomSource(seed),
    checkActions: actions,
    sceneTransitions: [
      {
        from: "arrival",
        to: "discovery",
        requiredFactIds: [SCENE_EXIT_OPEN.fact.id],
      },
      {
        from: "discovery",
        to: "confrontation",
        requiredFactIds: [SCENE_EXIT_OPEN.fact.id],
      },
    ],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  return app;
};

const resolveAction = (app: StructuredPlayApplication, actionId: string) => {
  const chosen = app.submit({ type: "choose-action", actionId });
  assert.equal(chosen.status, "accepted");
  assert.ok(chosen.state.pendingCheckProposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: chosen.state.pendingCheckProposal.id,
  });
  assert.equal(revealed.status, "accepted");
  assert.ok(revealed.state.pendingChoice);
  return app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: revealed.state.pendingChoice.id,
    choice: "decline",
  });
};

test("Lantern, Lockpick Set, and Short Blade permit approaches without numeric modifiers", () => {
  const app = begin(690);

  assert.deepEqual(
    app.view().availableActions
      .filter((action) => action.kind === "Check")
      .map((action) => action.id),
    ["search-dark-cellar", "pick-cellar-lock", "cut-bonds"],
  );

  const result = resolveAction(app, "search-dark-cellar");

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.state.lastCheckResolution?.trace.modifiers, [
    { source: "Wits", value: 2 },
  ]);
});

test("predeclared breakage removes an Inventory Item with no damaged state", () => {
  const app = begin(8);

  const result = resolveAction(app, "pick-cellar-lock");

  assert.equal(result.status, "accepted");
  assert.deepEqual(
    result.state.playerCharacter?.inventory.find(
      (item) => item.name === "Lockpick Set",
    ),
    { name: "Lockpick Set", state: "removed" },
  );
  assert.equal(
    result.availableActions.some((action) => action.id === "pick-cellar-lock"),
    false,
  );
});

test("proposal revision cannot bypass an Inventory Item permission", () => {
  const app = begin(8);
  resolveAction(app, "pick-cellar-lock");
  const chosen = app.submit({ type: "choose-action", actionId: "search-dark-cellar" });
  assert.ok(chosen.state.pendingCheckProposal);

  const revised = app.submit({
    type: "revise-check-action",
    proposalId: chosen.state.pendingCheckProposal.id,
    actionId: "pick-cellar-lock",
  });

  assert.equal(revised.status, "rejected");
  assert.equal(revised.code, "action-unavailable");
});

test("Field Kit restores exactly one Health outside a Confrontation and is consumed", () => {
  const app = begin(8);
  resolveAction(app, "search-dark-cellar");
  assert.equal(app.view().state.playerCharacter?.health, 2);

  const recovered = app.submit({ type: "use-field-kit", resource: "Health" });

  assert.equal(recovered.status, "accepted");
  assert.equal(recovered.state.playerCharacter?.health, 3);
  assert.deepEqual(
    recovered.state.playerCharacter?.inventory.find(
      (item) => item.name === "Field Kit",
    ),
    { name: "Field Kit", state: "removed" },
  );
  assert.deepEqual(
    recovered.appendedEvents.map((event) => event.type),
    ["FieldKitUsed"],
  );
  const [event] = recovered.appendedEvents;
  assert.equal(event?.type, "FieldKitUsed");
  if (event?.type === "FieldKitUsed") {
    assert.equal(event.payload.removalReason, "consumption");
    assert.equal(event.payload.restored, 1);
  }
});

test("Field Kit can restore exactly one Resolve and cannot be consumed at full resources", () => {
  const app = begin(690);
  const chosen = app.submit({ type: "choose-action", actionId: "search-dark-cellar" });
  assert.ok(chosen.state.pendingCheckProposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: chosen.state.pendingCheckProposal.id,
  });
  assert.ok(revealed.state.pendingChoice);
  app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: revealed.state.pendingChoice.id,
    choice: "spend-resolve",
  });

  const recovered = app.submit({ type: "use-field-kit", resource: "Resolve" });

  assert.equal(recovered.status, "accepted");
  assert.equal(recovered.state.playerCharacter?.resolve, 3);

  const fresh = begin(690);
  const rejected = fresh.submit({ type: "use-field-kit", resource: "Health" });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.code, "field-kit-unavailable");
  assert.deepEqual(
    rejected.state.playerCharacter?.inventory.find(
      (item) => item.name === "Field Kit",
    ),
    { name: "Field Kit", state: "carried" },
  );
});

test("resources do not recover passively and Field Kit cannot be used in a Confrontation", () => {
  const app = begin(8);
  resolveAction(app, "search-dark-cellar");

  app.submit({ type: "transition-scene", scene: "discovery" });
  assert.equal(app.view().state.playerCharacter?.health, 2);
  app.submit({ type: "transition-scene", scene: "confrontation" });
  assert.equal(app.view().state.playerCharacter?.health, 2);

  const rejected = app.submit({ type: "use-field-kit", resource: "Health" });

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.code, "field-kit-unavailable");
  assert.equal(rejected.state.playerCharacter?.health, 2);
});

test("Shaken prevents Resolve spending and clears when its Scene ends", () => {
  const app = begin(8);
  resolveAction(app, "search-dark-cellar");
  assert.deepEqual(app.view().state.conditions, ["Shaken"]);

  const chosen = app.submit({ type: "choose-action", actionId: "pick-cellar-lock" });
  assert.ok(chosen.state.pendingCheckProposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: chosen.state.pendingCheckProposal.id,
  });
  assert.deepEqual(revealed.state.pendingChoice?.availableChoices, ["decline"]);

  const transitioned = app.submit({ type: "transition-scene", scene: "discovery" });
  assert.equal(transitioned.status, "rejected");
  app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: revealed.state.pendingChoice!.id,
    choice: "decline",
  });
  const ended = app.submit({ type: "transition-scene", scene: "discovery" });
  assert.equal(ended.status, "accepted");
  assert.deepEqual(ended.state.conditions, []);
});

test("Restrained rejects free-movement actions and persists until explicitly removed", () => {
  const { requiredItem: _requiredItem, ...baseRestrainedAction } =
    riskyApproaches[0]!;
  const restrainedAction: CheckActionDefinition = {
    ...baseRestrainedAction,
    id: "become-restrained",
    label: "Risk becoming restrained",
    requiresFreeMovement: false,
    stakes: {
      ...riskyApproaches[0]!.stakes,
      Setback: {
        summary: "The trap restrains you.",
        consequences: [
          { type: "add-condition", condition: "Restrained" },
          SCENE_EXIT_OPEN,
        ],
      },
    },
  };
  const app = begin(8, [restrainedAction, ...riskyApproaches]);
  resolveAction(app, "become-restrained");

  const blocked = app.submit({ type: "choose-action", actionId: "search-dark-cellar" });
  assert.equal(blocked.status, "rejected");
  assert.equal(blocked.code, "action-requires-free-movement");

  app.submit({ type: "transition-scene", scene: "discovery" });
  assert.deepEqual(app.view().state.conditions, ["Restrained"]);

  const cutProposal = app.submit({ type: "choose-action", actionId: "cut-bonds" });
  assert.ok(cutProposal.state.pendingCheckProposal);
  const revised = app.submit({
    type: "revise-check-action",
    proposalId: cutProposal.state.pendingCheckProposal.id,
    actionId: "search-dark-cellar",
  });
  assert.equal(revised.status, "rejected");
  assert.equal(revised.code, "action-requires-free-movement");
  app.submit({
    type: "withdraw-check-proposal",
    proposalId: cutProposal.state.pendingCheckProposal.id,
  });

  const escaped = resolveAction(app, "cut-bonds");
  assert.equal(escaped.status, "accepted");
  assert.deepEqual(escaped.state.conditions, []);
});

test("Restrained cannot be removed by Setback stakes", () => {
  const invalidAction: CheckActionDefinition = {
    ...riskyApproaches[2]!,
    stakes: {
      ...riskyApproaches[2]!.stakes,
      Setback: {
        summary: "The bonds remain.",
        consequences: [{ type: "remove-condition", condition: "Restrained" }],
      },
    },
  };

  assert.throws(
    () => begin(8, [invalidAction]),
    /Invalid Outcome Consequence or stake/,
  );
});

test("Shaken cannot be removed by an authored Check stake", () => {
  const invalidAction = {
    ...riskyApproaches[0]!,
    stakes: {
      ...riskyApproaches[0]!.stakes,
      "Clean Success": {
        summary: "The action clears Shaken early.",
        consequences: [{ type: "remove-condition", condition: "Shaken" }],
      },
    },
  } as unknown as CheckActionDefinition;

  assert.throws(
    () => begin(690, [invalidAction]),
    /Invalid Outcome Consequence or stake/,
  );
});
