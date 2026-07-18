import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type CheckActionDefinition,
  type CheckOutcome,
  type StructuredPlayApplication,
} from "../src/structured-play.js";

const beginArrival = (seed: number): StructuredPlayApplication => {
  const app = createStructuredPlayApplication({
    randomSource: createSeededRandomSource(seed),
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

const proposeForceSideDoor = (app: StructuredPlayApplication) => {
  const result = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.equal(result.status, "accepted");
  const proposal = result.state.pendingCheckProposal;
  assert.ok(proposal);
  return proposal;
};

test("uncertain authored action presents a complete Check Proposal", () => {
  const app = beginArrival(1);

  const proposal = proposeForceSideDoor(app);

  assert.equal(proposal.goal, "Force open the manor's side door");
  assert.equal(proposal.trait, "Might");
  assert.deepEqual(Object.keys(proposal.stakes), [
    "Setback",
    "Success with Cost",
    "Clean Success",
  ]);
  assert.match(proposal.stakes.Setback.summary, /stays shut/i);
  assert.match(proposal.stakes["Success with Cost"].summary, /opens/i);
  assert.match(proposal.stakes["Clean Success"].summary, /quietly/i);
});

test("confirmed Check reveals a durable roll before committing its outcome", () => {
  const eventStore = createInMemoryEventStore();
  const randomSource = createSeededRandomSource(5);
  const app = createStructuredPlayApplication({ eventStore, randomSource });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const proposal = proposeForceSideDoor(app);

  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });

  assert.equal(revealed.status, "accepted");
  assert.equal(revealed.state.pendingCheckProposal, null);
  assert.deepEqual(revealed.state.pendingChoice, {
    id: revealed.state.pendingChoice?.id,
    type: "spend-resolve",
    proposal,
    roll: {
      rule: { id: "micro-ruleset.check", version: "1.0.0" },
      random: { source: "seeded-lcg", seed: 5, inputs: [2, 5] },
      modifiers: [{ source: "Might", value: 0 }],
      result: { diceTotal: 7, total: 7 },
    },
    availableChoices: ["decline", "spend-resolve"],
  });
  assert.equal(revealed.state.lastCheckResolution, null);
  assert.deepEqual(revealed.state.establishedFacts, []);
  assert.equal(revealed.state.playerCharacter?.health, 3);
  assert.equal(randomSource.position(), 2);
  assert.deepEqual(
    revealed.appendedEvents.map((event) => event.type),
    ["CheckRollRevealed"],
  );
  assert.deepEqual(
    eventStore.readAll().map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "SceneStarted",
      "CheckProposalCreated",
      "CheckRollRevealed",
    ],
  );
});

test("Player may spend one Resolve after a revealed roll to change the committed stakes", () => {
  const app = beginArrival(260);
  const proposal = proposeForceSideDoor(app);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });
  assert.equal(revealed.status, "accepted");
  const pendingChoice = revealed.state.pendingChoice;
  assert.ok(pendingChoice);

  const resolved = app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "spend-resolve",
  });

  assert.equal(resolved.status, "accepted");
  assert.equal(resolved.state.pendingChoice, null);
  assert.equal(resolved.state.playerCharacter?.resolve, 2);
  assert.deepEqual(
    resolved.state.establishedFacts.map((fact) => fact.id),
    ["side-door-open"],
  );
  assert.deepEqual(resolved.state.lastCheckResolution, {
    proposalId: proposal.id,
    pendingChoiceId: pendingChoice.id,
    goal: proposal.goal,
    trait: "Might",
    resolveSpent: 1,
    adjustedTotal: 10,
    outcome: "Clean Success",
    committedStake: proposal.stakes["Clean Success"],
    resultingResolve: 2,
    trace: {
      rule: pendingChoice.roll.rule,
      random: pendingChoice.roll.random,
      modifiers: [
        ...pendingChoice.roll.modifiers,
        { source: "Resolve", value: 1 },
      ],
      result: {
        diceTotal: 9,
        originalTotal: 9,
        total: 10,
        outcome: "Clean Success",
      },
    },
  });
  assert.deepEqual(
    resolved.appendedEvents.map((event) => event.type),
    ["CheckResolved"],
  );

  const duplicateSpend = app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "spend-resolve",
  });
  assert.equal(duplicateSpend.status, "rejected");
  assert.equal(duplicateSpend.code, "pending-choice-unavailable");
  assert.deepEqual(duplicateSpend.appendedEvents, []);
  assert.equal(duplicateSpend.state.playerCharacter?.resolve, 2);
});

test("restart restores the identical Pending Choice without rerolling", () => {
  const eventStore = createInMemoryEventStore();
  const firstRandomSource = createSeededRandomSource(5);
  const firstSession = createStructuredPlayApplication({
    eventStore,
    randomSource: firstRandomSource,
  });
  firstSession.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  firstSession.submit({ type: "begin-adventure" });
  const proposal = proposeForceSideDoor(firstSession);
  firstSession.submit({
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });
  const beforeRestart = firstSession.view();
  assert.equal(firstRandomSource.position(), 2);

  const resumedRandomSource = createSeededRandomSource(999);
  const resumedSession = createStructuredPlayApplication({
    eventStore,
    randomSource: resumedRandomSource,
  });
  const afterRestart = resumedSession.view();

  assert.equal(JSON.stringify(afterRestart), JSON.stringify(beforeRestart));
  assert.equal(resumedRandomSource.position(), 0);
  const pendingChoice = afterRestart.state.pendingChoice;
  assert.ok(pendingChoice);
  const resolved = resumedSession.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "decline",
  });
  assert.equal(resolved.status, "accepted");
  assert.equal(resumedRandomSource.position(), 0);
  assert.equal(resolved.state.lastCheckResolution?.adjustedTotal, 7);
  assert.equal(resolved.state.lastCheckResolution?.resolveSpent, 0);
  assert.equal(resolved.state.playerCharacter?.resolve, 3);
  const rebuilt = createStructuredPlayApplication({ eventStore }).view();
  assert.equal(
    JSON.stringify(rebuilt),
    JSON.stringify(resumedSession.view()),
  );
});

test("zero Resolve removes the spend option and cannot fall below zero", () => {
  const sourceStore = createInMemoryEventStore();
  const sourceApp = createStructuredPlayApplication({ eventStore: sourceStore });
  sourceApp.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  sourceApp.submit({ type: "begin-adventure" });

  const eventStore = createInMemoryEventStore();
  for (const event of sourceStore.readAll()) {
    eventStore.append(
      event.type === "PlayerCharacterConfigured"
        ? {
            ...event,
            payload: { ...event.payload, resolve: 0 },
          }
        : event,
    );
  }
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(5),
  });
  const proposal = proposeForceSideDoor(app);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });
  const pendingChoice = revealed.state.pendingChoice;
  assert.ok(pendingChoice);
  assert.deepEqual(pendingChoice.availableChoices, ["decline"]);

  const spend = app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "spend-resolve",
  });
  assert.equal(spend.status, "rejected");
  assert.equal(spend.code, "resolve-unavailable");
  assert.deepEqual(spend.appendedEvents, []);
  assert.equal(spend.state.playerCharacter?.resolve, 0);
});

const outcomeExamples: readonly {
  seed: number;
  rolls: readonly [number, number];
  outcome: CheckOutcome;
  factIds: readonly string[];
  health: 2 | 3;
}[] = [
  {
    seed: 1,
    rolls: [2, 3],
    outcome: "Setback",
    factIds: ["side-door-held", "manor-alerted"],
    health: 2,
  },
  {
    seed: 5,
    rolls: [2, 5],
    outcome: "Success with Cost",
    factIds: ["side-door-open", "manor-alerted"],
    health: 3,
  },
  {
    seed: 690,
    rolls: [4, 6],
    outcome: "Clean Success",
    factIds: ["side-door-open"],
    health: 3,
  },
];

for (const example of outcomeExamples) {
  test(`declined Resolve commits only ${example.outcome} stakes and an inspectable trace`, () => {
    const app = beginArrival(example.seed);
    const proposal = proposeForceSideDoor(app);

    const revealed = app.submit({
      type: "confirm-check-proposal",
      proposalId: proposal.id,
    });
    const pendingChoice = revealed.state.pendingChoice;
    assert.ok(pendingChoice);
    const result = app.submit({
      type: "resolve-pending-check",
      pendingChoiceId: pendingChoice.id,
      choice: "decline",
    });

    assert.equal(result.status, "accepted");
    assert.deepEqual(
      result.state.establishedFacts.map((fact) => fact.id),
      example.factIds,
    );
    assert.equal(result.state.playerCharacter?.health, example.health);
    assert.equal(result.state.pendingCheckProposal, null);
    assert.equal(result.state.pendingChoice, null);
    assert.equal(result.state.lastCheckResolution?.outcome, example.outcome);
    assert.deepEqual(result.state.lastCheckResolution?.trace, {
      rule: { id: "micro-ruleset.check", version: "1.0.0" },
      random: {
        source: "seeded-lcg",
        seed: example.seed,
        inputs: example.rolls,
      },
      modifiers: [{ source: "Might", value: 0 }],
      result: {
        diceTotal: example.rolls[0] + example.rolls[1],
        originalTotal: example.rolls[0] + example.rolls[1],
        total: example.rolls[0] + example.rolls[1],
        outcome: example.outcome,
      },
    });
    assert.deepEqual(
      result.appendedEvents.map((event) => event.type),
      ["CheckResolved"],
    );
    const [event] = result.appendedEvents;
    assert.equal(event?.type, "CheckResolved");
    if (event?.type === "CheckResolved") {
      assert.equal(event.payload.proposalId, proposal.id);
      assert.equal(event.payload.resolveSpent, 0);
      assert.equal(event.payload.resultingResolve, 3);
      assert.deepEqual(event.payload.trace.random, pendingChoice.roll.random);
    }
  });
}

test("Player can correct a proposal and the superseded proposal cannot roll", () => {
  const app = beginArrival(1);
  const original = proposeForceSideDoor(app);

  const corrected = app.submit({
    type: "correct-check-proposal",
    proposalId: original.id,
    goal: "Break the swollen side door off its hinges",
    trait: "Wits",
  });

  assert.equal(corrected.status, "accepted");
  const replacement = corrected.state.pendingCheckProposal;
  assert.ok(replacement);
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.goal, "Break the swollen side door off its hinges");
  assert.equal(replacement.trait, "Wits");

  const staleConfirmation = app.submit({
    type: "confirm-check-proposal",
    proposalId: original.id,
  });
  assert.equal(staleConfirmation.status, "rejected");
  assert.equal(staleConfirmation.code, "check-proposal-unavailable");
  assert.deepEqual(staleConfirmation.appendedEvents, []);
});

test("revising the action produces a newly validated Check Proposal", () => {
  const app = beginArrival(1);
  const original = proposeForceSideDoor(app);

  const revised = app.submit({
    type: "revise-check-action",
    proposalId: original.id,
    actionId: "pick-side-door-lock",
  });

  assert.equal(revised.status, "accepted");
  assert.equal(revised.state.pendingCheckProposal?.actionId, "pick-side-door-lock");
  assert.equal(revised.state.pendingCheckProposal?.trait, "Wits");
  assert.notEqual(revised.state.pendingCheckProposal?.id, original.id);
});

test("Player can withdraw before rolling", () => {
  const app = beginArrival(1);
  const proposal = proposeForceSideDoor(app);

  const withdrawn = app.submit({
    type: "withdraw-check-proposal",
    proposalId: proposal.id,
  });

  assert.equal(withdrawn.status, "accepted");
  assert.equal(withdrawn.state.pendingCheckProposal, null);
  assert.deepEqual(
    withdrawn.appendedEvents.map((event) => event.type),
    ["CheckProposalWithdrawn"],
  );
});

test("direct stake softening is rejected without changing the proposal", () => {
  const app = beginArrival(1);
  const proposal = proposeForceSideDoor(app);

  const softened = app.submit({
    type: "amend-check-stakes",
    proposalId: proposal.id,
    stakes: {
      ...proposal.stakes,
      Setback: { summary: "Nothing happens.", consequences: [] },
    },
  });

  assert.equal(softened.status, "rejected");
  assert.equal(softened.code, "check-stakes-immutable");
  assert.deepEqual(softened.appendedEvents, []);
  assert.deepEqual(softened.state.pendingCheckProposal, proposal);
});

test("routine authored action remains a Free Action and consumes no randomness", () => {
  const randomSource = createSeededRandomSource(1);
  const app = createStructuredPlayApplication({ randomSource });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });

  const completed = app.submit({
    type: "choose-action",
    actionId: "survey-manor",
  });

  assert.equal(completed.status, "accepted");
  assert.deepEqual(
    completed.appendedEvents.map((event) => event.type),
    ["FreeActionCompleted"],
  );
  assert.equal(completed.state.lastCheckResolution, null);
  assert.equal(randomSource.position(), 0);
});

test("invalid Mechanical Effects are rejected before a Check can be presented", () => {
  const invalidAction = {
    id: "invented-penalty",
    label: "Risk an invented penalty",
    kind: "Check",
    goal: "Cross the courtyard",
    trait: "Might",
    stakes: {
      Setback: {
        summary: "An undefined penalty applies.",
        consequences: [{ type: "disadvantage", amount: 1 }],
      },
      "Success with Cost": { summary: "Cross noisily.", consequences: [] },
      "Clean Success": { summary: "Cross quietly.", consequences: [] },
    },
  } as unknown as CheckActionDefinition;

  assert.throws(
    () => createStructuredPlayApplication({ checkActions: [invalidAction] }),
    /Invalid Outcome Consequence.*invented-penalty.*Setback/,
  );

  const undefinedEffect = {
    ...invalidAction,
    id: "undefined-effect",
    stakes: {
      ...invalidAction.stakes,
      Setback: {
        summary: "An effect is missing.",
        consequences: [undefined],
      },
    },
  } as unknown as CheckActionDefinition;
  assert.throws(
    () => createStructuredPlayApplication({ checkActions: [undefinedEffect] }),
    /Invalid Outcome Consequence.*undefined-effect.*Setback/,
  );
});

test("2d6 resolution adds the confirmed Trait rating", () => {
  const app = beginArrival(1);
  const chosen = app.submit({
    type: "choose-action",
    actionId: "pick-side-door-lock",
  });
  assert.equal(chosen.status, "accepted");
  const proposal = chosen.state.pendingCheckProposal;
  assert.ok(proposal);

  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });
  const pendingChoice = revealed.state.pendingChoice;
  assert.ok(pendingChoice);
  const result = app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "decline",
  });

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.state.lastCheckResolution?.trace.result, {
    diceTotal: 5,
    originalTotal: 7,
    total: 7,
    outcome: "Success with Cost",
  });
  assert.deepEqual(result.state.lastCheckResolution?.trace.modifiers, [
    { source: "Wits", value: 2 },
  ]);
});

test("committed Check outcome and trace rebuild from canonical events", () => {
  const eventStore = createInMemoryEventStore();
  const firstSession = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(690),
  });
  firstSession.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  firstSession.submit({ type: "begin-adventure" });
  const proposed = firstSession.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.equal(proposed.status, "accepted");
  assert.ok(proposed.state.pendingCheckProposal);
  const revealed = firstSession.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  const pendingChoice = revealed.state.pendingChoice;
  assert.ok(pendingChoice);
  firstSession.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "decline",
  });

  const resumed = createStructuredPlayApplication({ eventStore }).view();

  assert.equal(resumed.state.lastCheckResolution?.outcome, "Clean Success");
  assert.deepEqual(resumed.state.lastCheckResolution?.trace.random.inputs, [4, 6]);
  assert.deepEqual(
    resumed.state.establishedFacts.map((fact) => fact.id),
    ["side-door-open"],
  );
});
