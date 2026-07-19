import assert from "node:assert/strict";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInMemoryAdventureRepository,
  createLocalAdventureRepository,
  type AdventureRepository,
} from "../src/adventure-repository.js";
import {
  createStructuredPlayApplication,
  type CanonicalEvent,
} from "../src/structured-play.js";

const repositories = [
  {
    name: "in-memory",
    create: (): AdventureRepository => createInMemoryAdventureRepository(),
  },
  {
    name: "local durable",
    create: (): AdventureRepository =>
      createLocalAdventureRepository(
        mkdtempSync(join(tmpdir(), "ai-ttrpg-safe-writes-")),
      ),
  },
] as const;

const configuredEvent = (
  idempotencyKey: string,
  name = "Mara Vey",
  sequence = 1,
): CanonicalEvent => ({
  id: `event-${idempotencyKey}`,
  streamId: "adventure",
  sequence,
  type: "PlayerCharacterConfigured",
  schemaVersion: 1,
  timestamp: "2026-07-19T00:00:00.000Z",
  origin: "structured-play",
  correlationId: idempotencyKey,
  causationId: idempotencyKey,
  payload: {
    name,
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
    health: 3,
    resolve: 3,
    inventory: [
      { name: "Lantern", state: "carried" },
      { name: "Lockpick Set", state: "carried" },
      { name: "Short Blade", state: "carried" },
      { name: "Field Kit", state: "carried" },
    ],
  },
});

const sceneStartedEvent = (
  idempotencyKey: string,
  sequence = 2,
): CanonicalEvent => ({
  id: `scene-${idempotencyKey}`,
  streamId: "adventure",
  sequence,
  type: "SceneStarted",
  schemaVersion: 1,
  timestamp: "2026-07-19T00:00:01.000Z",
  origin: "structured-play",
  correlationId: idempotencyKey,
  causationId: idempotencyKey,
  payload: { scene: "arrival" },
});

const applicationOptions = {
  checkActions: [],
  oracleActions: [],
  adventureEndings: [],
  freeActions: [
    {
      id: "find-passage",
      label: "Find the passage",
      kind: "Free Action" as const,
      establishedFact: { id: "passage-found", text: "The passage is open." },
      availableInScenes: ["arrival" as const],
      requiredFactIds: [],
    },
  ],
  sceneTransitions: [
    {
      from: "arrival" as const,
      to: "discovery" as const,
      requiredFactIds: ["passage-found"],
      automatic: true,
    },
  ],
};

for (const factory of repositories) {
  test(`${factory.name} repository rejects stale writes and safely identifies retries`, () => {
    const repository = factory.create();
    const created = repository.create("Safe Manor");
    const firstWriter = repository.open(created.id);
    const staleWriter = repository.open(created.id);
    created.close();
    const event = configuredEvent("configure-mara");

    const accepted = firstWriter.eventStore.appendBatch({
      expectedPosition: 0,
      idempotencyKey: "configure-mara",
      events: [event],
    });
    assert.equal(accepted.status, "accepted");
    const expectedProjection = JSON.stringify(
      createStructuredPlayApplication({
        eventStore: firstWriter.eventStore,
      }).view().state,
    );

    const retried = staleWriter.eventStore.appendBatch({
      expectedPosition: 0,
      idempotencyKey: "configure-mara",
      events: [event],
    });
    assert.equal(retried.status, "replayed");
    assert.deepEqual(retried.events, [event]);
    assert.equal(
      JSON.stringify(
        createStructuredPlayApplication({
          eventStore: staleWriter.eventStore,
        }).view().state,
      ),
      expectedProjection,
    );

    const reused = staleWriter.eventStore.appendBatch({
      expectedPosition: 0,
      idempotencyKey: "configure-mara",
      events: [configuredEvent("configure-mara", "Someone Else")],
    });
    assert.equal(reused.status, "rejected");
    assert.equal(reused.code, "idempotency-conflict");
    assert.equal(reused.actualPosition, 1);
    assert.equal(
      JSON.stringify(
        createStructuredPlayApplication({
          eventStore: staleWriter.eventStore,
        }).view().state,
      ),
      expectedProjection,
    );

    const stale = staleWriter.eventStore.appendBatch({
      expectedPosition: 0,
      idempotencyKey: "another-command",
      events: [configuredEvent("another-command")],
    });
    assert.equal(stale.status, "rejected");
    assert.equal(stale.code, "stale-position");
    assert.equal(stale.expectedPosition, 0);
    assert.equal(stale.actualPosition, 1);
    assert.equal(
      JSON.stringify(
        createStructuredPlayApplication({
          eventStore: staleWriter.eventStore,
        }).view().state,
      ),
      expectedProjection,
    );

    firstWriter.close();
    staleWriter.close();
    const reopened = repository.open(created.id);
    assert.deepEqual(reopened.eventStore.readAll(), [event]);
    assert.equal(
      JSON.stringify(
        createStructuredPlayApplication({
          eventStore: reopened.eventStore,
        }).view().state,
      ),
      expectedProjection,
    );
    reopened.close();
  });

  test(`${factory.name} repository accepts a complete batch or none of it`, () => {
    const repository = factory.create();
    const adventure = repository.create("Atomic Manor");
    const invalid = adventure.eventStore.appendBatch({
      expectedPosition: 0,
      idempotencyKey: "begin",
      events: [configuredEvent("begin"), sceneStartedEvent("begin", 3)],
    });
    assert.equal(invalid.status, "rejected");
    assert.equal(invalid.code, "invalid-batch");
    assert.deepEqual(adventure.eventStore.readAll(), []);

    const accepted = adventure.eventStore.appendBatch({
      expectedPosition: 0,
      idempotencyKey: "begin",
      events: [configuredEvent("begin"), sceneStartedEvent("begin")],
    });
    assert.equal(accepted.status, "accepted");
    assert.deepEqual(adventure.eventStore.readAll(), [
      configuredEvent("begin"),
      sceneStartedEvent("begin"),
    ]);
    adventure.close();
  });
}

test("a local persistence failure leaves a multi-event command entirely uncommitted", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-safe-writes-"));
  const repository = createLocalAdventureRepository(directory);
  const adventure = repository.create("Read-only Manor");
  const adventureDirectory = join(directory, adventure.id);
  chmodSync(adventureDirectory, 0o500);
  let result;
  try {
    result = adventure.eventStore.appendBatch({
      expectedPosition: 0,
      idempotencyKey: "begin",
      events: [configuredEvent("begin"), sceneStartedEvent("begin")],
    });
  } finally {
    chmodSync(adventureDirectory, 0o700);
  }

  assert.equal(result.status, "rejected");
  assert.equal(result.code, "persistence-failed");
  assert.deepEqual(adventure.eventStore.readAll(), []);
  adventure.close();
  const reopened = repository.open(adventure.id);
  assert.deepEqual(reopened.eventStore.readAll(), []);
  reopened.close();
});

test("a failed multi-event application command reopens to the last valid projection", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-safe-writes-"));
  const repository = createLocalAdventureRepository(directory);
  const adventure = repository.create("Atomic Application Manor");
  const app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: adventure.timelineStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const expectedProjection = JSON.stringify(app.view().state);
  const expectedHistory = JSON.stringify(adventure.eventStore.readAll());
  const adventureDirectory = join(directory, adventure.id);

  chmodSync(adventureDirectory, 0o500);
  let result;
  try {
    result = app.submit({ type: "choose-action", actionId: "find-passage" });
  } finally {
    chmodSync(adventureDirectory, 0o700);
  }

  assert.equal(result.status, "rejected");
  assert.equal(result.code, "persistence-failed");
  assert.deepEqual(result.appendedEvents, []);
  assert.equal(JSON.stringify(adventure.eventStore.readAll()), expectedHistory);
  adventure.close();

  const reopened = repository.open(adventure.id);
  const resumed = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: reopened.timelineStore,
  });
  assert.equal(JSON.stringify(resumed.view().state), expectedProjection);
  assert.equal(JSON.stringify(reopened.eventStore.readAll()), expectedHistory);
  reopened.close();
});
