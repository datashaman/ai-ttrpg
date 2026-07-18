import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type CheckActionDefinition,
  type CheckOutcome,
} from "../src/structured-play.js";
import {
  runStructuredPlay,
  type StructuredPlayIO,
} from "../src/structured-play-runner.js";

const scriptedIO = (answers: readonly string[]) => {
  const remainingAnswers = [...answers];
  const output: string[] = [];
  const io: StructuredPlayIO = {
    read: async (prompt) => {
      output.push(prompt);
      const answer = remainingAnswers.shift();
      if (answer === undefined) {
        throw new Error("Scripted input exhausted.");
      }
      return answer;
    },
    write: (text) => output.push(text),
  };
  return { io, output };
};

test("scripted Structured Play configures, starts, and completes a Free Action", async () => {
  const eventStore = createInMemoryEventStore();
  const { io, output } = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "1",
    "s",
  ]);

  const view = await runStructuredPlay({ io, eventStore });

  assert.match(output.join(""), /Survey the manor grounds \[Free Action\]/);
  assert.match(output.join(""), /Fresh footprints lead from the manor gate/);
  assert.deepEqual(
    eventStore.readAll().map((event) => event.type),
    ["PlayerCharacterConfigured", "SceneStarted", "FreeActionCompleted"],
  );
  assert.equal(view.state.activeScene, "arrival");
  assert.deepEqual(view.state.establishedFacts, [
    {
      id: "fresh-footprints",
      text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
    },
  ]);
});

test("invalid rating is explained and reprompted without an invalid setup event", async () => {
  const eventStore = createInMemoryEventStore();
  const { io, output } = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "3",
    "0",
    "1",
    "2",
    "1",
    "s",
  ]);

  await runStructuredPlay({ io, eventStore });

  assert.match(output.join(""), /Enter 0, 1, or 2\./);
  assert.equal(
    eventStore
      .readAll()
      .filter((event) => event.type === "PlayerCharacterConfigured").length,
    1,
  );
});

for (const example of [
  { seed: 1, outcome: "Setback" },
  { seed: 5, outcome: "Success with Cost" },
  { seed: 690, outcome: "Clean Success" },
] as const satisfies readonly { seed: number; outcome: CheckOutcome }[]) {
  test(`scripted Structured Play visibly resolves a seeded ${example.outcome}`, async () => {
    const eventStore = createInMemoryEventStore();
    const { io, output } = scriptedIO([
      "Mara Vey",
      "she/her",
      "Find her missing sister",
      "0",
      "2",
      "1",
      "2",
      "c",
      "d",
    ]);

    const view = await runStructuredPlay({
      io,
      eventStore,
      randomSource: createSeededRandomSource(example.seed),
    });
    const transcript = output.join("");

    assert.match(transcript, /Check Proposal/);
    assert.match(transcript, /Setback:.*stays shut/i);
    assert.match(transcript, /Success with Cost:.*opens/i);
    assert.match(transcript, /Clean Success:.*quietly/i);
    assert.match(transcript, new RegExp(example.outcome));
    assert.match(transcript, /micro-ruleset\.check@1\.0\.0/);
    assert.match(transcript, /Random inputs:/);
    assert.match(transcript, /Spend 1 Resolve \(s\) or decline \(d\)/);
    assert.match(transcript, /Committed events:\n\[/);
    assert.match(transcript, /"type": "CheckRollRevealed"/);
    assert.match(transcript, /"type": "CheckResolved"/);
    assert.match(transcript, /"sequence": 5/);
    assert.equal(view.state.lastCheckResolution?.outcome, example.outcome);
  });
}

test("Structured Play runs item recovery and distinct Condition lifecycles end to end", async () => {
  const sceneExitFact = {
    id: "runner-scene-exit-open",
    text: "The cellar passage opens into the discovery Scene.",
  };
  const checkActions: readonly CheckActionDefinition[] = [
    {
      id: "lantern-search",
      label: "Search by Lantern light",
      kind: "Check",
      goal: "Search the dark cellar",
      trait: "Wits",
      requiredItem: "Lantern",
      requiresFreeMovement: true,
      stakes: {
        Setback: { summary: "The search fails.", consequences: [] },
        "Success with Cost": { summary: "The search succeeds noisily.", consequences: [] },
        "Clean Success": { summary: "The search succeeds.", consequences: [] },
      },
    },
    {
      id: "pick-trapped-lock",
      label: "Pick the trapped lock with the Lockpick Set",
      kind: "Check",
      goal: "Open the trapped lock",
      trait: "Wits",
      requiredItem: "Lockpick Set",
      requiresFreeMovement: true,
      stakes: {
        Setback: {
          summary: "The trap springs, causing harm and binding you.",
          consequences: [
            { type: "lose-health", amount: 1 },
            { type: "add-condition", condition: "Shaken" },
            { type: "add-condition", condition: "Restrained" },
            {
              type: "remove-inventory-item",
              item: "Lockpick Set",
              reason: "breakage",
            },
            { type: "establish-fact", fact: sceneExitFact },
          ],
        },
        "Success with Cost": { summary: "The lock opens noisily.", consequences: [] },
        "Clean Success": { summary: "The lock opens.", consequences: [] },
      },
    },
    {
      id: "cut-bonds",
      label: "Cut the bonds with the Short Blade",
      kind: "Check",
      goal: "Cut the bonds",
      trait: "Might",
      requiredItem: "Short Blade",
      requiresFreeMovement: false,
      stakes: {
        Setback: { summary: "The bonds hold.", consequences: [] },
        "Success with Cost": {
          summary: "The bonds part noisily.",
          consequences: [{ type: "remove-condition", condition: "Restrained" }],
        },
        "Clean Success": {
          summary: "The bonds part.",
          consequences: [{ type: "remove-condition", condition: "Restrained" }],
        },
      },
    },
  ];
  const applicationOptions = {
    checkActions,
    oracleActions: [],
    sceneTransitions: [
      {
        from: "arrival" as const,
        to: "discovery" as const,
        requiredFactIds: [sceneExitFact.id],
      },
    ],
  };
  const eventStore = createInMemoryEventStore();
  const trapped = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "3",
    "c",
    "d",
  ]);
  let view = await runStructuredPlay({
    io: trapped.io,
    eventStore,
    randomSource: createSeededRandomSource(8),
    applicationOptions,
  });
  assert.match(trapped.output.join(""), /Lantern light/);
  assert.match(trapped.output.join(""), /Lockpick Set/);
  assert.match(trapped.output.join(""), /Short Blade/);
  assert.equal(view.state.playerCharacter?.health, 2);
  assert.deepEqual(view.state.conditions, ["Shaken", "Restrained"]);
  assert.equal(
    view.state.playerCharacter?.inventory.find(
      (item) => item.name === "Lockpick Set",
    )?.state,
    "removed",
  );

  const recovery = scriptedIO(["3"]);
  view = await runStructuredPlay({
    io: recovery.io,
    eventStore,
    applicationOptions,
  });
  assert.match(recovery.output.join(""), /restore 1 Health \[Recovery\]/);
  assert.equal(view.state.playerCharacter?.health, 3);
  assert.equal(
    view.state.playerCharacter?.inventory.find(
      (item) => item.name === "Field Kit",
    )?.state,
    "removed",
  );

  const transition = scriptedIO(["3"]);
  view = await runStructuredPlay({
    io: transition.io,
    eventStore,
    applicationOptions,
  });
  assert.match(transition.output.join(""), /discovery Scene \[Scene Transition\]/);
  assert.deepEqual(view.state.conditions, ["Restrained"]);

  const escape = scriptedIO(["1", "c", "d"]);
  view = await runStructuredPlay({
    io: escape.io,
    eventStore,
    randomSource: createSeededRandomSource(690),
    applicationOptions,
  });
  assert.doesNotMatch(escape.output.join(""), /Search by Lantern light/);
  assert.deepEqual(view.state.conditions, []);
});

test("scripted Structured Play spends Resolve after the roll is revealed", async () => {
  const eventStore = createInMemoryEventStore();
  const { io, output } = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "2",
    "c",
    "s",
  ]);

  const view = await runStructuredPlay({
    io,
    eventStore,
    randomSource: createSeededRandomSource(260),
  });

  assert.match(output.join(""), /Clean Success \(10\)/);
  assert.equal(view.state.playerCharacter?.resolve, 2);
  assert.equal(view.state.lastCheckResolution?.resolveSpent, 1);
  assert.deepEqual(
    eventStore.readAll().map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "SceneStarted",
      "CheckProposalCreated",
      "CheckRollRevealed",
      "CheckResolved",
    ],
  );
});

test("scripted Structured Play resumes a persisted Pending Choice without rerolling", async () => {
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
  const proposed = firstSession.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  firstSession.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });

  const { io, output } = scriptedIO(["d"]);
  const resumedRandomSource = createSeededRandomSource(999);
  const view = await runStructuredPlay({
    io,
    eventStore,
    randomSource: resumedRandomSource,
  });

  assert.match(output.join(""), /Resuming Pending Choice/);
  assert.match(output.join(""), /Spend 1 Resolve \(s\) or decline \(d\)/);
  assert.equal(view.state.lastCheckResolution?.outcome, "Success with Cost");
  assert.equal(resumedRandomSource.position(), 0);
  assert.deepEqual(
    eventStore.readAll().map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "SceneStarted",
      "CheckProposalCreated",
      "CheckRollRevealed",
      "CheckResolved",
    ],
  );
});

test("scripted Structured Play visibly establishes a seeded Oracle answer after Player correction", async () => {
  const eventStore = createInMemoryEventStore();
  const oracle = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "1",
    "c",
    "5",
    "u",
  ]);
  const view = await runStructuredPlay({
    io: oracle.io,
    eventStore,
    randomSource: createSeededRandomSource(140),
  });
  const transcript = oracle.output.join("");

  assert.match(transcript, /Ask whether someone is inside the manor \[Oracle\]/);
  assert.match(transcript, /Unresolved Proposition/);
  assert.match(transcript, /Is someone currently inside the manor\?/);
  assert.match(transcript, /Narrator recommendation: Likely/);
  assert.match(transcript, /Fresh footprints lead from the manor gate/);
  assert.match(transcript, /Confirmed Likelihood: Unlikely/);
  assert.match(transcript, /micro-ruleset\.oracle@1\.0\.0/);
  assert.match(transcript, /Percentile roll: 30/);
  assert.match(transcript, /No one is currently inside the manor\./);
  assert.match(transcript, /"type": "NarratorLikelihoodRecommended"/);
  assert.match(transcript, /"type": "OracleAnswered"/);
  assert.equal(view.state.lastOracleResolution?.trace.result.answer, "No");
  assert.equal(
    view.state.lastOracleResolution?.trace.confirmedLikelihood,
    "Unlikely",
  );
  assert.ok(
    view.state.establishedFacts.some(
      (fact) => fact.id === "someone-inside-manor-no",
    ),
  );
});

for (const example of [
  {
    label: "Yes",
    seed: 140,
    likelihoodChoice: "l",
    answer: "Yes",
    exceptionalKind: null,
  },
  {
    label: "No",
    seed: 1327,
    likelihoodChoice: "l",
    answer: "No",
    exceptionalKind: null,
  },
  {
    label: "01–05 extreme",
    seed: 2023,
    likelihoodChoice: "e",
    answer: "Yes",
    exceptionalKind: "favourable",
  },
  {
    label: "96–100 extreme",
    seed: 1894,
    likelihoodChoice: "e",
    answer: "No",
    exceptionalKind: "adverse",
  },
] as const) {
  test(`seeded Oracle end-to-end covers ${example.label}`, async () => {
    const eventStore = createInMemoryEventStore();
    const setup = scriptedIO([
      "Mara Vey",
      "she/her",
      "Find her missing sister",
      "0",
      "2",
      "1",
      "1",
      "s",
    ]);
    await runStructuredPlay({ io: setup.io, eventStore });
    const oracle = scriptedIO(["5", example.likelihoodChoice]);

    const view = await runStructuredPlay({
      io: oracle.io,
      eventStore,
      randomSource: createSeededRandomSource(example.seed),
    });

    assert.equal(
      view.state.lastOracleResolution?.trace.result.answer,
      example.answer,
    );
    assert.equal(
      view.state.lastOracleResolution?.trace.result.exceptionalConsequence
        ?.kind ?? null,
      example.exceptionalKind,
    );
  });
}
