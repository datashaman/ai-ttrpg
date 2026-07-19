import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInMemoryAdventureRepository,
  createLocalAdventureRepository,
  type AdventureRepository,
} from "../src/adventure-repository.js";
import {
  createSeededRandomSource,
  createStructuredPlayApplication,
} from "../src/structured-play.js";

const repositoryFactories = [
  {
    name: "in-memory",
    create: (): AdventureRepository => createInMemoryAdventureRepository(),
  },
  {
    name: "local durable",
    create: (): AdventureRepository =>
      createLocalAdventureRepository(
        mkdtempSync(join(tmpdir(), "ai-ttrpg-adventures-")),
      ),
  },
] as const;

for (const factory of repositoryFactories) {
  test(`${factory.name} repository satisfies create, list, open, append, replay, and close`, () => {
    const repository = factory.create();
    const created = repository.create("The Locked Manor");
    const app = createStructuredPlayApplication({ eventStore: created.eventStore });

    app.submit({
      type: "configure-player-character",
      name: "Mara Vey",
      pronouns: "she/her",
      motivation: "Find her missing sister",
      traits: { Might: 0, Wits: 2, Presence: 1 },
    });
    app.submit({ type: "begin-adventure" });
    app.submit({ type: "choose-action", actionId: "survey-manor" });
    const beforeClose = JSON.stringify(app.view().state);

    assert.deepEqual(repository.list(), [
      {
        id: created.id,
        name: "The Locked Manor",
        eventCount: 3,
      },
    ]);

    created.close();
    assert.throws(() => created.eventStore.readAll(), /closed/i);

    const reopened = repository.open(created.id);
    const resumed = createStructuredPlayApplication({
      eventStore: reopened.eventStore,
    });
    assert.equal(JSON.stringify(resumed.view().state), beforeClose);

    const rejected = resumed.submit({
      type: "choose-action",
      actionId: "not-an-authored-action",
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(reopened.eventStore.readAll().length, 3);

    resumed.submit({ type: "choose-action", actionId: "withdraw-from-manor" });
    assert.equal(reopened.eventStore.readAll().length, 5);
    reopened.close();
  });

  test(`${factory.name} repository restores the committed random-stream position`, () => {
    const repository = factory.create();
    const created = repository.create("The Random Manor");
    const app = createStructuredPlayApplication({
      eventStore: created.eventStore,
      randomSource: created.randomSource,
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

    const seed = created.randomSource.metadata().seed;
    assert.notEqual(seed, null);
    const expected = createSeededRandomSource(seed!);
    expected.rollDie(6);
    expected.rollDie(6);
    created.close();

    const reopened = repository.open(created.id);
    assert.equal(reopened.randomSource.position(), 2);
    assert.equal(reopened.randomSource.rollDie(100), expected.rollDie(100));
    reopened.close();
  });
}

test("a new local repository instance reopens the same Adventure", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-adventures-"));
  const firstProcess = createLocalAdventureRepository(directory);
  const created = firstProcess.create("A Durable Mystery");
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
      {
        id: "enter-passage",
        label: "Enter the passage",
        kind: "Free Action" as const,
        establishedFact: { id: "passage-entered", text: "Mara enters the passage." },
        availableInScenes: ["discovery" as const],
        requiredFactIds: ["passage-found"],
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
  const app = createStructuredPlayApplication({
    ...applicationOptions,
    eventStore: created.eventStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "find-passage" });
  const beforeRestart = JSON.stringify(app.view().state);
  created.close();

  const secondProcess = createLocalAdventureRepository(directory);
  const reopened = secondProcess.open(created.id);
  const resumed = createStructuredPlayApplication({
    ...applicationOptions,
    eventStore: reopened.eventStore,
  });
  assert.equal(JSON.stringify(resumed.view().state), beforeRestart);
  assert.equal(resumed.view().state.activeScene, "discovery");
  assert.deepEqual(
    reopened.eventStore.readAll().map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "SceneStarted",
      "FreeActionCompleted",
      "SceneTransitioned",
    ],
  );

  const continued = resumed.submit({
    type: "choose-action",
    actionId: "enter-passage",
  });
  assert.equal(continued.status, "accepted");
  assert.equal(reopened.eventStore.readAll().length, 5);
});

test("opening an unavailable or unreadable local Adventure reports a concise diagnostic", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-adventures-"));
  const repository = createLocalAdventureRepository(directory);

  assert.throws(
    () => repository.open("missing-adventure"),
    /Adventure "missing-adventure" is unavailable\./,
  );

  const created = repository.create("Unreadable Mystery");
  created.close();
  writeFileSync(join(directory, created.id, "events.jsonl"), "not json\n");
  assert.throws(
    () => repository.open(created.id),
    new RegExp(`Adventure "${created.id}" could not be read\\.`),
  );

  writeFileSync(join(directory, created.id, "events.jsonl"), "{}\n");
  assert.throws(
    () => repository.open(created.id),
    new RegExp(`Adventure "${created.id}" could not be read\\.`),
  );

  const envelope = (sequence: number, type: string, payload: unknown) => ({
    id: `event-${sequence}`,
    streamId: "adventure",
    sequence,
    type,
    schemaVersion: 1,
    timestamp: "2026-07-19T00:00:00.000Z",
    origin: "structured-play",
    correlationId: "corrupt-command",
    causationId: "corrupt-command",
    payload,
  });
  writeFileSync(
    join(directory, created.id, "events.jsonl"),
    `${JSON.stringify(envelope(1, "PlayerCharacterConfigured", {}))}\n${JSON.stringify(envelope(2, "SceneStarted", { scene: "arrival" }))}\n`,
  );
  assert.throws(
    () => repository.open(created.id),
    new RegExp(`Adventure "${created.id}" could not be read\\.`),
  );

  writeFileSync(
    join(directory, created.id, "events.jsonl"),
    `${JSON.stringify(envelope(1, "SceneStarted", { scene: "not-a-scene" }))}\n`,
  );
  assert.throws(
    () => repository.open(created.id),
    new RegExp(`Adventure "${created.id}" could not be read\\.`),
  );
});
