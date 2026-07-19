import assert from "node:assert/strict";

import type {
  CheckActionDefinition,
  RandomSource,
  StructuredPlayApplication,
} from "../../src/structured-play.js";

export const COLLAPSING_GATE_ACTION: CheckActionDefinition = {
  id: "hold-collapsing-gate",
  label: "Hold the collapsing gate",
  kind: "Check",
  goal: "Hold back the collapsing gate",
  trait: "Might",
  availableInScenes: ["confrontation"],
  repeatable: true,
  stakes: {
    Setback: {
      summary: "The gate crushes down and you lose 1 Health.",
      consequences: [{ type: "lose-health", amount: 1 }],
    },
    "Success with Cost": {
      summary: "The gate holds briefly.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
      ],
    },
    "Clean Success": {
      summary: "The gate holds.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
      ],
    },
  },
};

export const scriptedRandomSource = (rolls: readonly number[]): RandomSource => {
  const remaining = [...rolls];
  let position = 0;
  return {
    rollDie: () => {
      const roll = remaining.shift();
      if (roll === undefined) throw new Error("Scripted random input exhausted.");
      position += 1;
      return roll;
    },
    metadata: () => ({ source: "scripted", seed: null }),
    position: () => position,
  };
};

export const resolveAction = (
  app: StructuredPlayApplication,
  actionId: string,
) => {
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

export const enterConfrontation = (app: StructuredPlayApplication): void => {
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  resolveAction(app, "force-side-door");
  app.submit({ type: "transition-scene", scene: "discovery" });
  const entered = app.submit({
    type: "transition-scene",
    scene: "confrontation",
  });
  assert.equal(entered.status, "accepted");
};
