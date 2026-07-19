import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AdventureArchiveError } from "../src/adventure-archive.js";
import {
  createLocalAdventureRepository,
  type OpenAdventure,
} from "../src/adventure-repository.js";
import { createStructuredPlayApplication } from "../src/structured-play.js";

const repository = () =>
  createLocalAdventureRepository(
    mkdtempSync(join(tmpdir(), "ai-ttrpg-invalid-archive-")),
  );

const snapshot = (adventure: OpenAdventure): string =>
  JSON.stringify({
    identity: { id: adventure.id, name: adventure.name },
    view: adventure.timelineStore.view(),
    histories: adventure.timelineStore.view().timelines.map(({ id }) => ({
      id,
      events: adventure.timelineStore.readTimeline(id),
    })),
  });

interface MutableEvent {
  id: string;
  sequence: number;
  schemaVersion: number;
  type: string;
  payload: Record<string, unknown>;
}

interface MutableTimeline {
  id: string;
  parentTimelineId: string | null;
  branchEventPosition: number | null;
  randomPosition: number;
  events: MutableEvent[];
}

interface MutableArchive {
  formatVersion: number;
  integrity: { algorithm: string; digest: string };
  adventure: {
    id: string;
    name: string;
    randomSeed: number;
    activeTimelineId: string;
    timelines: MutableTimeline[];
  };
}

const document = (serialized: string): MutableArchive =>
  JSON.parse(serialized) as MutableArchive;

const reseal = (archive: MutableArchive): string => {
  archive.integrity.digest = createHash("sha256")
    .update(JSON.stringify(archive.adventure))
    .digest("hex");
  return JSON.stringify(archive);
};

const archiveFixture = () => {
  const sourceRepository = repository();
  const source = sourceRepository.create("The Guarded Manor");
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
  const recommendation = app.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  }).state.pendingNarratorRecommendation;
  assert.ok(recommendation);
  app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood: recommendation.likelihood,
  });
  app.submit({ type: "branch-timeline", eventPosition: 3 });
  const serialized = sourceRepository.exportArchive(source.id);
  return { source, serialized, before: snapshot(source) };
};

const expectArchiveError = (
  operation: () => unknown,
  expected: {
    code: string;
    adventureId?: string | undefined;
    timelineId?: string | undefined;
    eventPosition?: number | undefined;
  },
): void => {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof AdventureArchiveError);
    assert.equal(error.code, expected.code);
    assert.equal(error.adventureId, expected.adventureId);
    assert.equal(error.timelineId, expected.timelineId);
    assert.equal(error.eventPosition, expected.eventPosition);
    assert.match(error.message, /Adventure archive/);
    if (expected.adventureId !== undefined) {
      assert.match(error.message, new RegExp(expected.adventureId));
    }
    if (expected.timelineId !== undefined) {
      assert.match(error.message, new RegExp(expected.timelineId));
    }
    if (expected.eventPosition !== undefined) {
      assert.match(error.message, new RegExp(`event ${expected.eventPosition}`));
    }
    return true;
  });
};

test("import reports document compatibility and integrity failures without mutation", () => {
  const { source, serialized, before } = archiveFixture();
  const destination = repository();
  const existing = destination.create("The Existing Manor");
  const existingBefore = snapshot(existing);
  const adventureId = source.id;

  expectArchiveError(() => destination.importArchive(serialized.slice(0, -20)), {
    code: "ARCHIVE_INVALID_DOCUMENT",
  });

  const incompatible = document(serialized);
  incompatible.formatVersion = 2;
  expectArchiveError(() => destination.importArchive(JSON.stringify(incompatible)), {
    code: "ARCHIVE_UNSUPPORTED_VERSION",
    adventureId,
  });

  const tampered = document(serialized);
  tampered.adventure.name = "The Tampered Manor";
  expectArchiveError(() => destination.importArchive(JSON.stringify(tampered)), {
    code: "ARCHIVE_INTEGRITY_MISMATCH",
    adventureId,
  });

  assert.equal(snapshot(source), before);
  assert.equal(snapshot(existing), existingBefore);
  assert.deepEqual(destination.list(), [
    { id: existing.id, name: existing.name, eventCount: 0 },
  ]);

  const imported = destination.importArchive(serialized);
  assert.equal(snapshot(imported), before);
  imported.close();
  existing.close();
  source.close();
});

test("import distinguishes every invalid canonical event rejection class", () => {
  const { source, serialized, before } = archiveFixture();
  const destination = repository();
  const adventureId = source.id;
  const timelineId = document(serialized).adventure.timelines[0]!.id;

  const cases: ReadonlyArray<{
    code: string;
    eventPosition: number;
    mutate(events: MutableEvent[]): void;
  }> = [
    {
      code: "ARCHIVE_UNSUPPORTED_EVENT_SCHEMA",
      eventPosition: 1,
      mutate: (events) => {
        events[0]!.schemaVersion = 2;
      },
    },
    {
      code: "ARCHIVE_MALFORMED_EVENT",
      eventPosition: 1,
      mutate: (events) => {
        events[0]!.type = "NotACanonicalEvent";
      },
    },
    {
      code: "ARCHIVE_DUPLICATE_EVENT",
      eventPosition: 2,
      mutate: (events) => {
        events[1]!.id = events[0]!.id;
      },
    },
    {
      code: "ARCHIVE_EVENT_SEQUENCE_GAP",
      eventPosition: 2,
      mutate: (events) => {
        events.splice(1, 1);
      },
    },
    {
      code: "ARCHIVE_EVENTS_OUT_OF_ORDER",
      eventPosition: 1,
      mutate: (events) => {
        [events[0], events[1]] = [events[1]!, events[0]!];
      },
    },
  ];

  for (const rejection of cases) {
    const archive = document(serialized);
    rejection.mutate(archive.adventure.timelines[0]!.events);
    expectArchiveError(() => destination.importArchive(reseal(archive)), {
      code: rejection.code,
      adventureId,
      timelineId,
      eventPosition: rejection.eventPosition,
    });
    assert.deepEqual(destination.list(), []);
    assert.equal(snapshot(source), before);
  }

  const imported = destination.importArchive(serialized);
  assert.equal(snapshot(imported), before);
  imported.close();
  source.close();
});

test("import diagnoses inconsistent Timeline graphs and random positions", () => {
  const { source, serialized, before } = archiveFixture();
  const destination = repository();
  const baseline = document(serialized);
  const adventureId = source.id;
  const root = baseline.adventure.timelines.find(
    (timeline) => timeline.id === "timeline-main",
  );
  const child = baseline.adventure.timelines.find(
    (timeline) => timeline.id !== "timeline-main",
  );
  assert.ok(root);
  assert.ok(child);

  const cases: ReadonlyArray<{
    code: string;
    timelineId?: string;
    eventPosition?: number;
    mutate(archive: MutableArchive): void;
  }> = [
    {
      code: "ARCHIVE_ACTIVE_TIMELINE_MISSING",
      timelineId: "timeline-missing",
      mutate: (archive) => {
        archive.adventure.activeTimelineId = "timeline-missing";
      },
    },
    {
      code: "ARCHIVE_TIMELINE_PARENT_MISSING",
      timelineId: child.id,
      mutate: (archive) => {
        archive.adventure.timelines[1]!.parentTimelineId = "timeline-missing";
      },
    },
    {
      code: "ARCHIVE_TIMELINE_CYCLE",
      timelineId: child.id,
      mutate: (archive) => {
        archive.adventure.timelines[1]!.parentTimelineId = child.id;
      },
    },
    {
      code: "ARCHIVE_INVALID_BRANCH_POSITION",
      timelineId: child.id,
      eventPosition: root.events.length + 1,
      mutate: (archive) => {
        archive.adventure.timelines[1]!.branchEventPosition =
          root.events.length + 1;
      },
    },
    {
      code: "ARCHIVE_TIMELINE_HISTORY_MISMATCH",
      timelineId: child.id,
      eventPosition: child.branchEventPosition!,
      mutate: (archive) => {
        archive.adventure.timelines[1]!.events[0]!.id =
          "event-with-divergent-history";
      },
    },
    {
      code: "ARCHIVE_RANDOM_POSITION_MISMATCH",
      timelineId: child.id,
      mutate: (archive) => {
        archive.adventure.timelines[1]!.randomPosition += 1;
      },
    },
  ];

  for (const rejection of cases) {
    const archive = document(serialized);
    rejection.mutate(archive);
    expectArchiveError(() => destination.importArchive(reseal(archive)), {
      code: rejection.code,
      adventureId,
      timelineId: rejection.timelineId,
      eventPosition: rejection.eventPosition,
    });
    assert.deepEqual(destination.list(), []);
    assert.equal(snapshot(source), before);
  }

  const wrongSeed = document(serialized);
  const seededEventIndex = wrongSeed.adventure.timelines[0]!.events.findIndex(
    (event) => event.type === "OracleAnswered",
  );
  assert.notEqual(seededEventIndex, -1);
  const trace = wrongSeed.adventure.timelines[0]!.events[seededEventIndex]!
    .payload.trace as { random: { seed: number } };
  trace.random.seed = trace.random.seed === 0 ? 1 : trace.random.seed - 1;
  expectArchiveError(() => destination.importArchive(reseal(wrongSeed)), {
    code: "ARCHIVE_RANDOM_SEED_MISMATCH",
    adventureId,
    timelineId: root.id,
    eventPosition: seededEventIndex + 1,
  });

  const imported = destination.importArchive(serialized);
  assert.equal(snapshot(imported), before);
  imported.close();
  source.close();
});
