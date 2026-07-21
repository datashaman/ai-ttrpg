import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  createScriptedModelProvider,
  type ModelProvider,
} from "../src/model-gateway.js";
import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type EventStore,
} from "../src/structured-play.js";
import { runStructuredPlay } from "../src/structured-play-runner.js";
import { narrateCommittedOutcomeThroughGateway } from "../src/grounded-narration.js";
import {
  assertLockedManorHiddenKnowledgeAbsent,
  LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID,
  LOCKED_MANOR_HIDDEN_KNOWLEDGE_TEXT,
} from "./support/hidden-world-knowledge.js";
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

test("a committed Free Action receives Narration grounded in its accepted event", async () => {
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
  const outcome = app.submit({ type: "choose-action", actionId: "survey-manor" });
  const outcomeEvent = outcome.appendedEvents.find(
    ({ type }) => type === "FreeActionCompleted",
  );
  assert.ok(outcomeEvent);
  assert.equal(outcomeEvent.type, "FreeActionCompleted");
  const committedEvents = [outcomeEvent];
  const modelCallStore = createInMemoryModelCallRecordStore();

  const presented = await narrateCommittedOutcomeThroughGateway({
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
    gateway: createModelGateway({
      provider: createScriptedModelProvider({
        model: "free-action-narration-v1",
        responses: {
          [`narrate-committed-outcome:${outcomeEvent.id}`]: {
            segments: [{
              text: outcomeEvent.payload.establishedFact.text,
              evidenceItemIds: ["event:committed:0"],
            }],
          },
        },
      }),
    }),
    modelCallStore,
    context: {
      deterministicSummary: outcomeEvent.payload.establishedFact.text,
      visibleEvidence: outcome.state.establishedFacts,
      resolutionTrace: null,
      committedEvents,
    },
    acceptedEvents: eventStore.readAll(),
    state: outcome.state,
    timeoutMs: 1_000,
  });

  assert.deepEqual(presented, {
    source: "model",
    text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
  });
  assert.equal(modelCallStore.readAll()[0]?.validation.status, "accepted");
});

test("a committed Check receives original Narration from attributable evidence", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const scriptedProvider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:micro-ruleset.check@1.0.0:Clean Success": {
        segments: [
          {
            text:
              "With quiet certainty, the outcome settles: The door opens quietly.",
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
  const provider: ModelProvider = {
    ...scriptedProvider,
    invoke: async (task) => {
      assert.equal(task.type, "narrate-committed-outcome");
      assert.deepEqual(Object.keys(task.input), ["outcomeReference"]);
      assert.equal(Object.isFrozen(task), true);
      assert.equal(Object.isFrozen(task.evidenceBundle.items), true);
      const serializedTask = JSON.stringify(task);
      assert.doesNotMatch(serializedTask, /deterministicSummary/);
      assert.doesNotMatch(
        serializedTask,
        /Clean Success \(10\): The door opens quietly\./,
      );
      return scriptedProvider.invoke(task);
    },
  };
  const script = scriptedIO(["d", "c"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

  assert.match(
    script.output.join(""),
    /Narration\nWith quiet certainty, the outcome settles: The door opens quietly\./,
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
        text:
          "With quiet certainty, the outcome settles: The door opens quietly.",
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
  assert.ok(
    record.evidenceReferences.every((reference) =>
      /^[0-9a-f]{64}$/.test(reference.contentHash),
    ),
  );
  assert.deepEqual(
    record.correlationIds,
    [
      ...new Set(
        eventStore
          .readAll()
          .filter((event) => event.type === "CheckResolved")
          .map((event) => event.correlationId),
      ),
    ],
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
      "narrate-committed-outcome:micro-ruleset.check@1.0.0:Clean Success": {
        segments: [
          {
            text:
              "A ghost watches as the outcome settles: The door opens quietly.",
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
      "narrate-committed-outcome:micro-ruleset.check@1.0.0:Clean Success": {
        segments: [
          {
            text:
              "With quiet certainty, the outcome settles: The door opens quietly.",
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

for (const [kind, hiddenClaim] of [
  ["exact hidden content", LOCKED_MANOR_HIDDEN_KNOWLEDGE_TEXT],
  [
    "a hidden relationship paraphrase",
    "The housekeeper secretly guards the cellar.",
  ],
] as const) {
  test(`${kind} cannot become Narration`, async () => {
    const eventStore = pendingCheckStore();
    const modelCallStore = createInMemoryModelCallRecordStore();
    const scriptedProvider = createScriptedModelProvider({
      model: "hidden-narration-v1",
      responses: {
        "narrate-committed-outcome:micro-ruleset.check@1.0.0:Clean Success": {
          segments: [
            {
              text: `${hiddenClaim} The door opens quietly.`,
              evidenceItemIds: [
                "event:committed:0",
                `fact:${LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID}`,
              ],
            },
          ],
        },
      },
    });
    const provider: ModelProvider = {
      ...scriptedProvider,
      invoke: async (task) => {
        assertLockedManorHiddenKnowledgeAbsent(task);
        return scriptedProvider.invoke(task);
      },
    };
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
    assert.equal(view.state.playerCharacter?.health, 3);
    assert.deepEqual(
      view.state.establishedFacts.map((fact) => fact.id),
      ["side-door-open"],
    );
    const [record] = modelCallStore.readAll();
    assert.ok(record);
    assert.equal(record.validation.status, "rejected");
    assert.equal(record.validatedOutput, null);
    assert.equal(record.fallbackOutcome, "deterministic-narration");
    assert.deepEqual(
      record.acceptedEventIds,
      eventStore
        .readAll()
        .filter((event) => event.type === "CheckResolved")
        .map((event) => event.id),
    );
    const playerVisibleResult = JSON.stringify({
      output: script.output,
      record,
    });
    assertLockedManorHiddenKnowledgeAbsent(playerVisibleResult);
  });
}

test("cited outcome terms cannot be recombined into a different outcome", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:micro-ruleset.check@1.0.0:Clean Success": {
        segments: [
          {
            text: "The outcome is a Setback. The door opens quietly.",
            evidenceItemIds: [
              "event:committed:0",
              "resolution:committed",
              "rule:micro-ruleset.check@1.0.0",
            ],
          },
        ],
      },
    },
  });

  await runStructuredPlay({
    io: scriptedIO(["d"]).io,
    eventStore,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
  });

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
      "narrate-committed-outcome:micro-ruleset.check@1.0.0:Clean Success": {
        segments: [
          {
            text:
              "With quiet certainty, the outcome settles: The door opens quietly.",
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
  const scriptedProvider = createScriptedModelProvider({
    model: "locked-manor-narration-v1",
    responses: {
      "narrate-committed-outcome:micro-ruleset.oracle@1.0.0:No": {
        segments: [
          {
            text:
              "The answer settles clearly: No one is currently inside the manor.",
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
  const provider: ModelProvider = {
    ...scriptedProvider,
    invoke: async (task) => {
      assert.equal(task.type, "narrate-committed-outcome");
      const serializedTask = JSON.stringify(task);
      assert.doesNotMatch(serializedTask, /someone-inside-manor-yes/);
      assert.doesNotMatch(serializedTask, /exceptionalConsequences/);
      assert.doesNotMatch(serializedTask, /"answers"/);
      assert.doesNotMatch(serializedTask, /"seed"/);
      assert.doesNotMatch(serializedTask, /missing sister/i);
      return scriptedProvider.invoke(task);
    },
  };
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
    /Narration\nThe answer settles clearly: No one is currently inside the manor\./,
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
    record.evidenceReferences.find(
      (reference) => reference.itemId === "fact:fresh-footprints",
    )?.sourceReference,
    "world-knowledge:fresh-footprints",
  );
  assert.equal(
    record.evidenceReferences.some(
      (reference) => reference.itemId === "fact:side-door-open",
    ),
    false,
  );
});
