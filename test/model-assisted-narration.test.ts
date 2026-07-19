import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  createScriptedModelProvider,
} from "../src/model-gateway.js";
import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type EventStore,
} from "../src/structured-play.js";
import { runStructuredPlay } from "../src/structured-play-runner.js";
import { scriptedIO } from "./support/scripted-io.js";

const pendingCheckStore = (): EventStore => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(690),
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const proposed = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  return eventStore;
};

const pendingOracleStore = (): EventStore => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({ eventStore });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const recommended = app.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  });
  assert.ok(recommended.state.pendingNarratorRecommendation);
  return eventStore;
};

test("a committed Check receives original Narration from attributable evidence", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:Clean Success (10): The door opens quietly.": {
        segments: [
          {
            text: "Mara quietly opens the door: Clean Success.",
            evidenceItemIds: [
              "event:committed:0",
              "resolution:committed",
              "rule:micro-ruleset.check@1.0.0",
              "fact:side-door-open",
              "entity:player-character",
            ],
          },
        ],
      },
    },
  });
  const script = scriptedIO(["d", "c"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

  assert.match(
    script.output.join(""),
    /Narration\nMara quietly opens the door: Clean Success\./,
  );
  assert.equal(view.state.lastCheckResolution?.outcome, "Clean Success");
  assert.deepEqual(
    view.state.establishedFacts.map((fact) => fact.id),
    ["side-door-open"],
  );
  assert.deepEqual(
    createStructuredPlayApplication({ eventStore }).view().state,
    view.state,
  );

  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.taskType, "narrate-committed-outcome");
  assert.equal(record.promptVersion, "narrate-committed-outcome-v1");
  assert.equal(record.validation.status, "accepted");
  assert.equal(record.fallbackOutcome, "none");
  assert.deepEqual(record.validatedOutput, {
    segments: [
      {
        text: "Mara quietly opens the door: Clean Success.",
        evidenceItemIds: [
          "event:committed:0",
          "resolution:committed",
          "rule:micro-ruleset.check@1.0.0",
          "fact:side-door-open",
          "entity:player-character",
        ],
      },
    ],
  });
  assert.deepEqual(
    record.acceptedEventIds,
    eventStore
      .readAll()
      .filter((event) => event.type === "CheckResolved")
      .map((event) => event.id),
  );
  assert.equal(
    eventStore.readAll().some((event) => event.id === record.id),
    false,
  );
});

test("unsupported additions select deterministic Narration without changing game truth", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:Clean Success (10): The door opens quietly.": {
        segments: [
          {
            text: "Quietly, a ghost opens the door: Clean Success.",
            evidenceItemIds: [
              "event:committed:0",
              "resolution:committed",
              "rule:micro-ruleset.check@1.0.0",
              "fact:side-door-open",
            ],
          },
        ],
      },
    },
  });
  const script = scriptedIO(["d"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

  const output = script.output.join("");
  assert.match(
    output,
    /Narration \(deterministic fallback\)\nClean Success \(10\): The door opens quietly\./,
  );
  assert.doesNotMatch(output, /ghost/);
  assert.equal(
    eventStore.readAll().filter((event) => event.type === "CheckResolved")
      .length,
    1,
  );
  assert.deepEqual(
    view.state.establishedFacts.map((fact) => fact.id),
    ["side-door-open"],
  );
  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.validation.status, "rejected");
  assert.equal(record.fallbackOutcome, "deterministic-narration");
  assert.equal(record.validatedOutput, null);
});

test("unknown Narration citations select deterministic presentation", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:Clean Success (10): The door opens quietly.": {
        segments: [
          {
            text: "Quietly, the door opens: Clean Success.",
            evidenceItemIds: ["fact:hidden-ghost"],
          },
        ],
      },
    },
  });
  const script = scriptedIO(["d"]);

  await runStructuredPlay({
    io: script.io,
    eventStore,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

  assert.match(
    script.output.join(""),
    /Narration \(deterministic fallback\)\nClean Success \(10\): The door opens quietly\./,
  );
  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.validation.status, "rejected");
  assert.equal(record.fallbackOutcome, "deterministic-narration");
});

test("Narration provider failure preserves the deterministic committed outcome", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "unavailable-narration-v1",
    responses: {},
  });
  const script = scriptedIO(["d"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

  assert.match(
    script.output.join(""),
    /Narration \(deterministic fallback\)\nClean Success \(10\): The door opens quietly\./,
  );
  assert.equal(view.state.lastCheckResolution?.outcome, "Clean Success");
  assert.equal(
    eventStore.readAll().filter((event) => event.type === "CheckResolved")
      .length,
    1,
  );
  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.validation.status, "rejected");
  assert.equal(record.fallbackOutcome, "deterministic-narration");
  assert.equal(record.validatedOutput, null);
});

test("Narration output cannot apply a Mechanical Effect or survive malformed repair", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:Clean Success (10): The door opens quietly.": {
        segments: [
          {
            text: "Quietly, the door opens: Clean Success.",
            evidenceItemIds: ["event:committed:0"],
          },
        ],
        mechanicalEffects: [{ type: "lose-health", amount: 1 }],
        establishedFacts: [
          { id: "invented-ghost", text: "A ghost enters the manor." },
        ],
      },
    },
  });
  const script = scriptedIO(["d"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

  assert.match(script.output.join(""), /Narration \(deterministic fallback\)/);
  assert.equal(view.state.playerCharacter?.health, 3);
  assert.deepEqual(
    view.state.establishedFacts.map((fact) => fact.id),
    ["side-door-open"],
  );
  assert.equal(
    eventStore.readAll().some(
      (event) => event.type === ("MechanicalEffectApplied" as string),
    ),
    false,
  );
  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.retryCount, 1);
  assert.equal(record.validation.status, "rejected");
  assert.equal(record.fallbackOutcome, "deterministic-narration");
});

test("a committed Oracle answer is narrated from relevant Player-visible evidence", async () => {
  const eventStore = pendingOracleStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:No (30 <= 25): No one is currently inside the manor.": {
        segments: [
          {
            text: "No one is inside the manor currently.",
            evidenceItemIds: [
              "event:committed:0",
              "resolution:committed",
              "rule:micro-ruleset.oracle@1.0.0",
              "fact:someone-inside-manor-no",
            ],
          },
        ],
      },
    },
  });
  const script = scriptedIO(["u"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    randomSource: createSeededRandomSource(140),
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

  assert.match(
    script.output.join(""),
    /Narration\nNo one is inside the manor currently\./,
  );
  assert.equal(view.state.lastOracleResolution?.trace.result.answer, "No");
  assert.equal(
    eventStore.readAll().filter((event) => event.type === "OracleAnswered")
      .length,
    1,
  );
  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.validation.status, "accepted");
  assert.ok(
    record.evidenceReferences.some(
      (reference) =>
        reference.itemId === "entity:proposition:someone-inside-manor",
    ),
  );
  assert.ok(
    record.evidenceReferences.some(
      (reference) => reference.itemId === "fact:fresh-footprints",
    ),
  );
  assert.equal(
    record.evidenceReferences.some(
      (reference) => reference.itemId === "fact:side-door-open",
    ),
    false,
  );
});
