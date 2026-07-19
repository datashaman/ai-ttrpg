import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLocalAdventureRepository,
  type OpenAdventure,
} from "../src/adventure-repository.js";
import { createStructuredPlayApplication } from "../src/structured-play.js";

const temporaryRepository = () =>
  createLocalAdventureRepository(
    mkdtempSync(join(tmpdir(), "ai-ttrpg-archive-")),
  );

const normalizedAdventure = (adventure: OpenAdventure): string =>
  JSON.stringify({
    id: adventure.id,
    name: adventure.name,
    timeline: adventure.timelineStore.view(),
    histories: adventure.timelineStore.view().timelines.map((timeline) => ({
      id: timeline.id,
      events: adventure.timelineStore.readTimeline(timeline.id),
    })),
    projection: createStructuredPlayApplication({
      timelineStore: adventure.timelineStore,
    }).view().state,
  });

interface MutableArchiveDocument {
  formatVersion: number;
  integrity: { algorithm: string; digest: string };
  adventure: {
    id: string;
    name: string;
    timelines: Array<{
      events: Array<{
        type: string;
        sequence: number;
        payload: {
          inventory?: unknown[];
          trace?: {
            random: { seed: number; inputs: number[] };
            result: { roll: number };
          };
        };
      }>;
    }>;
  };
}

const archiveDocument = (archive: string): MutableArchiveDocument =>
  JSON.parse(archive) as MutableArchiveDocument;

const reseal = (document: MutableArchiveDocument): string => {
  document.integrity.digest = createHash("sha256")
    .update(JSON.stringify(document.adventure))
    .digest("hex");
  return JSON.stringify(document);
};

test("export followed by import reproduces the complete durable Adventure", () => {
  const sourceRepository = temporaryRepository();
  const source = sourceRepository.create("The Portable Manor");
  const app = createStructuredPlayApplication({
    timelineStore: source.timelineStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const sourceTimelineId = source.timelineStore.view().activeTimelineId;
  app.submit({ type: "branch-timeline", eventPosition: 2 });
  const beforeExport = normalizedAdventure(source);

  const archive = sourceRepository.exportArchive(source.id);

  assert.equal(normalizedAdventure(source), beforeExport);
  const document = JSON.parse(archive) as Record<string, unknown>;
  assert.equal(document.formatVersion, 1);
  assert.ok(document.integrity);
  source.close();

  const importedRepository = temporaryRepository();
  const imported = importedRepository.importArchive(archive);
  assert.equal(normalizedAdventure(imported), beforeExport);
  assert.deepEqual(
    imported.timelineStore.readTimeline(sourceTimelineId),
    JSON.parse(beforeExport).histories[0].events,
  );
  imported.close();
});

test("import validates integrity and canonical history before visibility", () => {
  const sourceRepository = temporaryRepository();
  const source = sourceRepository.create("The Valid Manor");
  const app = createStructuredPlayApplication({
    timelineStore: source.timelineStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const recommended = app.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  });
  const recommendation = recommended.state.pendingNarratorRecommendation;
  assert.ok(recommendation);
  app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood: recommendation.likelihood,
  });
  const archive = sourceRepository.exportArchive(source.id);
  source.close();

  const tampered = archiveDocument(archive);
  tampered.adventure.name = "The Tampered Manor";
  const integrityTarget = temporaryRepository();
  assert.throws(
    () => integrityTarget.importArchive(JSON.stringify(tampered)),
    /integrity check failed/i,
  );
  assert.deepEqual(integrityTarget.list(), []);

  const invalidHistory = archiveDocument(archive);
  invalidHistory.adventure.timelines[0]!.events[0]!.sequence = 99;
  const historyTarget = temporaryRepository();
  assert.throws(
    () => historyTarget.importArchive(reseal(invalidHistory)),
    /event sequence contains a gap/i,
  );
  assert.deepEqual(historyTarget.list(), []);

  const invalidPayload = archiveDocument(archive);
  invalidPayload.adventure.timelines[0]!.events[0]!.payload.inventory = [42];
  const payloadTarget = temporaryRepository();
  assert.throws(
    () => payloadTarget.importArchive(reseal(invalidPayload)),
    /event envelope or payload is malformed/i,
  );
  assert.deepEqual(payloadTarget.list(), []);

  const contradictoryTrace = archiveDocument(archive);
  const oracleEvent = contradictoryTrace.adventure.timelines[0]!.events.find(
    (event) => event.type === "OracleAnswered",
  );
  assert.ok(oracleEvent?.payload.trace);
  oracleEvent.payload.trace.result.roll =
    oracleEvent.payload.trace.result.roll === 100
      ? 99
      : oracleEvent.payload.trace.result.roll + 1;
  const traceTarget = temporaryRepository();
  assert.throws(
    () => traceTarget.importArchive(reseal(contradictoryTrace)),
    /event envelope or payload is malformed/i,
  );
  assert.deepEqual(traceTarget.list(), []);

  const wrongSeed = archiveDocument(archive);
  const seededEvent = wrongSeed.adventure.timelines[0]!.events.find(
    (event) => event.type === "OracleAnswered",
  );
  assert.ok(seededEvent?.payload.trace);
  seededEvent.payload.trace.random.seed =
    seededEvent.payload.trace.random.seed === 0
      ? 1
      : seededEvent.payload.trace.random.seed - 1;
  const seedTarget = temporaryRepository();
  assert.throws(
    () => seedTarget.importArchive(reseal(wrongSeed)),
    /wrong seed/i,
  );
  assert.deepEqual(seedTarget.list(), []);
});

test("import reports an existing identity without overwriting its Adventure", () => {
  const sourceRepository = temporaryRepository();
  const source = sourceRepository.create("The Incoming Manor");
  const sourceApp = createStructuredPlayApplication({
    timelineStore: source.timelineStore,
  });
  sourceApp.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  const incoming = archiveDocument(sourceRepository.exportArchive(source.id));
  source.close();

  const destination = temporaryRepository();
  const existing = destination.create("The Existing Manor");
  const beforeImport = normalizedAdventure(existing);
  incoming.adventure.id = existing.id;

  assert.throws(
    () => destination.importArchive(reseal(incoming)),
    /already exists; import did not overwrite it/i,
  );
  assert.equal(normalizedAdventure(existing), beforeImport);
  existing.close();
});

test("source and imported Adventures continue independently with inherited randomness", () => {
  const sourceRepository = temporaryRepository();
  const source = sourceRepository.create("The Repeating Portable Manor");
  const sourceApp = createStructuredPlayApplication({
    timelineStore: source.timelineStore,
  });
  sourceApp.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  sourceApp.submit({ type: "begin-adventure" });
  sourceApp.submit({ type: "choose-action", actionId: "force-side-door" });
  sourceApp.submit({ type: "branch-timeline", eventPosition: 3 });

  const importedRepository = temporaryRepository();
  const imported = importedRepository.importArchive(
    sourceRepository.exportArchive(source.id),
  );
  const importedApp = createStructuredPlayApplication({
    timelineStore: imported.timelineStore,
  });
  const sourceProposal = sourceApp.view().state.pendingCheckProposal;
  const importedProposal = importedApp.view().state.pendingCheckProposal;
  assert.ok(sourceProposal);
  assert.ok(importedProposal);

  const sourceReveal = sourceApp.submit({
    type: "confirm-check-proposal",
    proposalId: sourceProposal.id,
  });
  const importedReveal = importedApp.submit({
    type: "confirm-check-proposal",
    proposalId: importedProposal.id,
  });
  assert.ok(sourceReveal.state.pendingChoice);
  assert.ok(importedReveal.state.pendingChoice);
  assert.deepEqual(
    importedReveal.state.pendingChoice.roll.random.inputs,
    sourceReveal.state.pendingChoice.roll.random.inputs,
  );

  sourceApp.submit({
    type: "resolve-pending-check",
    pendingChoiceId: sourceReveal.state.pendingChoice.id,
    choice: "decline",
  });
  assert.ok(importedApp.view().state.pendingChoice);
  assert.equal(sourceApp.view().state.pendingChoice, null);
  assert.notEqual(
    source.timelineStore.view().activeTimeline.eventCount,
    imported.timelineStore.view().activeTimeline.eventCount,
  );
  source.close();
  imported.close();
});

test("incomplete import staging is outside the visible Adventure namespace", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-archive-"));
  const repository = createLocalAdventureRepository(directory);
  const visible = repository.create("The Visible Manor");
  visible.close();
  mkdirSync(join(directory, ".interrupted-adventure.import"));

  assert.deepEqual(repository.list(), [
    { id: visible.id, name: visible.name, eventCount: 0 },
  ]);
});
