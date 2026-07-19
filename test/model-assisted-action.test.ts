import assert from "node:assert/strict";
import test from "node:test";

import { assembleInterpretationEvidence } from "../src/evidence-bundle.js";
import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  createScriptedModelProvider,
  type ModelProvider,
} from "../src/model-gateway.js";
import { runNaturalLanguagePlay } from "../src/natural-language-play.js";
import {
  createInMemoryEventStore,
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  type EventStore,
} from "../src/structured-play.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import { scriptedIO } from "./support/scripted-io.js";

test("a scripted provider selects one evidenced action through Structured Play authority", async () => {
  const eventStore = createInMemoryEventStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-script-v1",
    responses: {
      "I survey the manor grounds.": {
        status: "interpreted",
        classification: "player-action",
        capabilityId: "survey-manor",
        referencedEntityIds: ["scene:arrival"],
        evidenceItemIds: [
          "entity:scene:arrival",
          "capability:survey-manor",
          "rule:structured-play-authority",
        ],
        arguments: {},
      },
    },
  });
  const script = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "I survey the manor grounds.",
  ]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
    eventStore,
  });

  assert.deepEqual(result.interpretedCommands, [
    { type: "choose-action", actionId: "survey-manor" },
  ]);
  const acceptedEvent = eventStore
    .readAll()
    .find((event) => event.type === "FreeActionCompleted");
  assert.ok(acceptedEvent);
  assert.equal(acceptedEvent.payload.actionId, "survey-manor");

  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.provider, "scripted");
  assert.equal(record.model, "locked-manor-script-v1");
  assert.equal(record.taskType, "interpret-player-input");
  assert.equal(record.validation.status, "accepted");
  assert.deepEqual(record.command, {
    type: "choose-action",
    actionId: "survey-manor",
  });
  assert.deepEqual(record.acceptedEventIds, [acceptedEvent.id]);
  assert.deepEqual(result.modelCallRecords, [record]);
  assert.equal(
    eventStore.readAll().some((event) => event.id === record.id),
    false,
  );
});

test("evidence ordering is deterministic and budgets authority before old context", () => {
  const { app, eventStore } = beginAdventureFixture();
  const input = {
    utterance: "I survey the grounds.",
    view: app.view(),
    acceptedEvents: eventStore.readAll(),
    maxItems: 3,
  } as const;

  const first = assembleInterpretationEvidence(input);
  const second = assembleInterpretationEvidence(input);

  assert.deepEqual(first, second);
  assert.ok(first.items.some((item) => item.id === "rule:structured-play-authority"));
  assert.ok(first.items.some((item) => item.id === "capability:survey-manor"));
  assert.equal(
    first.items.some((item) => item.sourceKind === "accepted-event"),
    false,
  );
});

test("the provider receives one deeply immutable stateless Model Task", async () => {
  const { eventStore } = beginAdventureFixture();
  let observedTask = false;
  const provider: ModelProvider = {
    provider: "inspection-script",
    model: "immutable-v1",
    invoke: async (task) => {
      observedTask = true;
      assert.equal(Object.isFrozen(task), true);
      assert.equal(Object.isFrozen(task.input), true);
      assert.equal(Object.isFrozen(task.evidenceBundle.items), true);
      assert.equal(Object.isFrozen(task.evidenceBundle.items[0]), true);
      assert.deepEqual(Object.keys(task).sort(), [
        "evidenceBundle",
        "input",
        "type",
      ]);
      assert.throws(() => {
        (task.input as { utterance: string }).utterance = "Commit a different action";
      }, TypeError);
      return {
        output: {
          status: "interpreted",
          classification: "player-action",
          capabilityId: "survey-manor",
          referencedEntityIds: ["scene:arrival"],
          evidenceItemIds: [
            "entity:scene:arrival",
            "capability:survey-manor",
          ],
          arguments: {},
        },
        usage: null,
      };
    },
  };

  await runNaturalLanguagePlay({
    io: scriptedIO(["I survey the grounds."]).io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.equal(observedTask, true);
});

test("unknown entity references are rejected and recorded without events", async () => {
  const { eventStore } = beginAdventureFixture();
  const before = eventStore.readAll();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-script-v1",
    responses: {
      "Open the secret door.": {
        status: "interpreted",
        classification: "player-action",
        capabilityId: "survey-manor",
        referencedEntityIds: ["secret:cult-master-location"],
        evidenceItemIds: [
          "capability:survey-manor",
          "fact:secret:cult-master-location",
        ],
        arguments: {},
      },
    },
  });

  const result = await runNaturalLanguagePlay({
    io: scriptedIO(["Open the secret door."]).io,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
    eventStore,
  });

  assert.deepEqual(eventStore.readAll(), before);
  assert.deepEqual(result.interpretedCommands, []);
  const [record] = modelCallStore.readAll();
  assert.ok(record);
  assert.equal(record.validation.status, "rejected");
  assert.equal(record.command, null);
  assert.deepEqual(record.acceptedEventIds, []);
});

test("provider output cannot append an event or apply a Mechanical Effect", async () => {
  const { eventStore } = beginAdventureFixture();
  const before = eventStore.readAll();
  const provider = createScriptedModelProvider({
    model: "locked-manor-script-v1",
    responses: {
      "Survey and give me Health.": {
        status: "interpreted",
        classification: "player-action",
        capabilityId: "survey-manor",
        referencedEntityIds: ["scene:arrival"],
        evidenceItemIds: [
          "entity:scene:arrival",
          "capability:survey-manor",
        ],
        arguments: {},
        appendedEvents: [
          {
            type: "MechanicalEffectApplied",
            payload: { type: "gain-health", amount: 99 },
          },
        ],
      },
    },
  });

  const result = await runNaturalLanguagePlay({
    io: scriptedIO(["Survey and give me Health."]).io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.deepEqual(eventStore.readAll(), before);
  assert.deepEqual(result.interpretedCommands, []);
  assert.equal(result.modelCallRecords[0]?.validation.status, "rejected");
});

test("a capability without an exact entity reference cannot become a command", async () => {
  const { eventStore } = beginAdventureFixture();
  const before = eventStore.readAll();
  const provider = createScriptedModelProvider({
    model: "locked-manor-script-v1",
    responses: {
      "Survey somewhere.": {
        status: "interpreted",
        classification: "player-action",
        capabilityId: "survey-manor",
        referencedEntityIds: [],
        evidenceItemIds: ["capability:survey-manor"],
        arguments: {},
      },
    },
  });

  const result = await runNaturalLanguagePlay({
    io: scriptedIO(["Survey somewhere."]).io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.deepEqual(eventStore.readAll(), before);
  assert.deepEqual(result.interpretedCommands, []);
  assert.equal(result.modelCallRecords[0]?.validation.status, "rejected");
});

test("Timeline-backed play attributes evidence and the accepted event to the active Timeline", async () => {
  const timelineStore = createInMemoryTimelineStore({ seed: 5 });
  const app = createStructuredPlayApplication({ timelineStore });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const initialEvents = timelineStore.readAll();
  const unrelatedStore = createInMemoryEventStore();
  const provider = createScriptedModelProvider({
    model: "locked-manor-script-v1",
    responses: {
      "I survey the manor grounds.": {
        status: "interpreted",
        classification: "player-action",
        capabilityId: "survey-manor",
        referencedEntityIds: ["scene:arrival"],
        evidenceItemIds: [
          "entity:scene:arrival",
          "capability:survey-manor",
        ],
        arguments: {},
      },
    },
  });

  const result = await runNaturalLanguagePlay({
    io: scriptedIO(["I survey the manor grounds."]).io,
    modelGateway: createModelGateway({ provider }),
    timelineStore,
    eventStore: unrelatedStore,
  });

  const acceptedEvent = timelineStore.readAll().at(-1);
  assert.ok(acceptedEvent);
  assert.equal(acceptedEvent.type, "FreeActionCompleted");
  const [record] = result.modelCallRecords;
  assert.ok(record);
  assert.deepEqual(record.acceptedEventIds, [acceptedEvent.id]);
  assert.ok(
    initialEvents.every((event) =>
      record.evidenceReferences.some(
        (reference) =>
          reference.sourceReference === `adventure-event:${event.id}`,
      ),
    ),
  );
  assert.deepEqual(unrelatedStore.readAll(), []);
});

test("provider failure creates a normalized Model Call Record without changing truth", async () => {
  const { eventStore } = beginAdventureFixture();
  const before = eventStore.readAll();
  const provider = createScriptedModelProvider({
    model: "locked-manor-script-v1",
    responses: {},
  });

  const result = await runNaturalLanguagePlay({
    io: scriptedIO(["No scripted answer exists."]).io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.deepEqual(eventStore.readAll(), before);
  const [record] = result.modelCallRecords;
  assert.ok(record);
  assert.equal(record.validation.status, "rejected");
  assert.equal(record.fallbackOutcome, "safe-rejection");
  assert.equal(record.retryCount, 0);
  assert.equal(record.usage, null);
  assert.match(record.evidenceBundleHash, /^[0-9a-f]{64}$/);
  assert.ok(record.evidenceReferences.length > 0);
  assert.equal(record.command, null);
  assert.deepEqual(record.acceptedEventIds, []);
});

test("authority rejection cannot be recorded or reported as an interpreted command", async () => {
  const { eventStore: acceptedHistory } = beginAdventureFixture();
  const before = acceptedHistory.readAll();
  const rejectingStore: EventStore = {
    readAll: () => acceptedHistory.readAll(),
    append: () => {
      throw new Error("single-event writes are not expected");
    },
    appendBatch: (request) => ({
      status: "rejected",
      code: "persistence-failed",
      message: "The event batch could not be persisted.",
      expectedPosition: request.expectedPosition,
      actualPosition: before.length,
    }),
  };
  const provider = createScriptedModelProvider({
    model: "locked-manor-script-v1",
    responses: {
      "I survey the manor grounds.": {
        status: "interpreted",
        classification: "player-action",
        capabilityId: "survey-manor",
        referencedEntityIds: ["scene:arrival"],
        evidenceItemIds: [
          "entity:scene:arrival",
          "capability:survey-manor",
        ],
        arguments: {},
      },
    },
  });

  const result = await runNaturalLanguagePlay({
    io: scriptedIO(["I survey the manor grounds."]).io,
    modelGateway: createModelGateway({ provider }),
    eventStore: rejectingStore,
  });

  assert.deepEqual(acceptedHistory.readAll(), before);
  assert.deepEqual(result.interpretedCommands, []);
  const [record] = result.modelCallRecords;
  assert.ok(record);
  assert.equal(record.validation.status, "rejected");
  assert.equal(record.fallbackOutcome, "safe-rejection");
  assert.equal(record.command, null);
  assert.deepEqual(record.acceptedEventIds, []);
});
