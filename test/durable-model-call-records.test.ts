import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAdventureCli } from "../src/adventure-cli.js";
import { createLocalAdventureRepository } from "../src/adventure-repository.js";
import {
  createModelGateway,
  type ModelCallRecord,
  type ModelProvider,
} from "../src/model-gateway.js";
import { createStructuredPlayApplication } from "../src/structured-play.js";
import { scriptedIO } from "./support/scripted-io.js";

const retainedNarrationRecord = (
  acceptedEventId: string,
): ModelCallRecord => ({
  id: "call-narration-1",
  taskType: "narrate-committed-outcome",
  provider: "scripted",
  model: "narrator-v1",
  promptVersion: "narrate-committed-outcome-v1",
  evidenceBundleId: `evidence:${"a".repeat(64)}`,
  evidenceBundleHash: "a".repeat(64),
  evidenceReferences: [
    {
      itemId: "event:committed:0",
      sourceKind: "accepted-event",
      sourceReference: acceptedEventId,
      contentHash: "b".repeat(64),
    },
  ],
  startedAt: "2026-07-19T10:00:00.000Z",
  completedAt: "2026-07-19T10:00:00.025Z",
  durationMs: 25,
  usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52 },
  retryCount: 0,
  fallbackOutcome: "none",
  validation: { status: "accepted" },
  validatedOutput: {
    segments: [
      {
        text: "Mara leaves the manor behind as dawn breaks.",
        evidenceItemIds: ["event:committed:0"],
      },
    ],
  },
  command: null,
  acceptedEventIds: [acceptedEventId],
  correlationIds: ["command-withdraw"],
});

test("Model Call Records survive a durable Adventure reopen outside canonical history", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-model-calls-"));
  const firstProcess = createLocalAdventureRepository(directory);
  const created = firstProcess.create("The Remembered Manor");
  const app = createStructuredPlayApplication({
    timelineStore: created.timelineStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const completed = app.submit({
    type: "choose-action",
    actionId: "withdraw-from-manor",
  });
  const acceptedEvent = completed.appendedEvents.at(-1);
  assert.ok(acceptedEvent);
  const canonicalHistory = created.eventStore.readAll();
  const projectedState = app.view().state;

  created.modelCallStore.append(retainedNarrationRecord(acceptedEvent.id));
  created.close();

  const reopened = createLocalAdventureRepository(directory).open(created.id);
  assert.deepEqual(reopened.modelCallStore.readAll(), [
    retainedNarrationRecord(acceptedEvent.id),
  ]);
  assert.deepEqual(reopened.eventStore.readAll(), canonicalHistory);
  assert.deepEqual(
    createStructuredPlayApplication({ timelineStore: reopened.timelineStore })
      .view().state,
    projectedState,
  );
  reopened.close();
});

test("reopening displays retained validated Narration without calling the current provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-model-calls-"));
  const repository = createLocalAdventureRepository(directory);
  const created = repository.create("The Remembered Manor");
  const app = createStructuredPlayApplication({
    timelineStore: created.timelineStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const completed = app.submit({
    type: "choose-action",
    actionId: "withdraw-from-manor",
  });
  const acceptedEvent = completed.appendedEvents.at(-1);
  assert.ok(acceptedEvent);
  created.modelCallStore.append(retainedNarrationRecord(acceptedEvent.id));
  const adventureId = created.id;
  created.close();

  let providerCalls = 0;
  const provider: ModelProvider = {
    provider: "replacement-provider",
    model: "replacement-model",
    invoke: async () => {
      providerCalls += 1;
      throw new Error("Historical Narration must not be regenerated.");
    },
  };
  const script = scriptedIO(["1", "5"]);

  await runAdventureCli(
    ["open", adventureId],
    script.io,
    createLocalAdventureRepository(directory),
    { modelGateway: createModelGateway({ provider }) },
  );

  assert.match(
    script.output.join(""),
    /Historical Narration\nMara leaves the manor behind as dawn breaks\./,
  );
  assert.equal(providerCalls, 0);
});

test("unreadable Model Call Records cannot change replay or prevent reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-model-calls-"));
  const repository = createLocalAdventureRepository(directory);
  const created = repository.create("The Provider-independent Manor");
  const app = createStructuredPlayApplication({
    timelineStore: created.timelineStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const beforeClose = app.view().state;
  const adventureId = created.id;
  created.close();
  writeFileSync(
    join(directory, adventureId, "model-calls.jsonl"),
    "not valid JSON\n",
    "utf8",
  );

  const reopened = createLocalAdventureRepository(directory).open(adventureId);
  assert.deepEqual(reopened.modelCallStore.readAll(), []);
  assert.deepEqual(
    createStructuredPlayApplication({ timelineStore: reopened.timelineStore })
      .view().state,
    beforeClose,
  );
  reopened.close();

  const modelCallsPath = join(directory, adventureId, "model-calls.jsonl");
  rmSync(modelCallsPath);
  mkdirSync(modelCallsPath);
  const reopenedWithIoFailure = createLocalAdventureRepository(directory).open(
    adventureId,
  );
  assert.deepEqual(reopenedWithIoFailure.modelCallStore.readAll(), []);
  assert.deepEqual(
    createStructuredPlayApplication({
      timelineStore: reopenedWithIoFailure.timelineStore,
    }).view().state,
    beforeClose,
  );
  reopenedWithIoFailure.close();
});

test("branching and portable export leave Model Call Records outside canonical history", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-model-calls-"));
  const repository = createLocalAdventureRepository(directory);
  const created = repository.create("The Portable Manor");
  const app = createStructuredPlayApplication({
    timelineStore: created.timelineStore,
  });
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
  const acceptedEvent = completed.appendedEvents.at(0);
  assert.ok(acceptedEvent);
  const record = retainedNarrationRecord(acceptedEvent.id);
  created.modelCallStore.append(record);

  const branched = app.submit({ type: "branch-timeline", eventPosition: 2 });
  assert.equal(branched.status, "accepted");
  assert.deepEqual(created.modelCallStore.readAll(), [record]);
  assert.equal(
    created.timelineStore
      .view().timelines
      .flatMap((timeline) => created.timelineStore.readTimeline(timeline.id))
      .some((event) => event.id === record.id),
    false,
  );

  const archive = repository.exportArchive(created.id);
  assert.doesNotMatch(archive, /model-calls|call-narration-1|dawn breaks/);
  assert.doesNotMatch(
    readFileSync(join(directory, created.id, "events.jsonl"), "utf8"),
    /call-narration-1|dawn breaks/,
  );
  created.close();
});
