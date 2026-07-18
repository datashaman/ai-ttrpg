import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
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
