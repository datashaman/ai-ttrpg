import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AdventureArchiveError,
} from "../src/adventure-archive.js";
import {
  createInMemoryAdventureRepository,
  createLocalAdventureRepository,
  type AdventureRepository,
  type OpenAdventure,
} from "../src/adventure-repository.js";
import type { ModelCallRecord } from "../src/model-gateway.js";
import {
  createStructuredPlayApplication,
  type FreeActionDefinition,
  type StructuredPlayApplication,
} from "../src/structured-play.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  GAME_MASTER_ACTOR_SCOPE,
  projectWorldKnowledge,
} from "../src/world-knowledge.js";

interface MutableArchiveDocument {
  formatVersion: number;
  integrity: {
    algorithm: string;
    digest: string;
  };
  adventure: {
    timelines: Array<{
      events: Array<{
        type: string;
        payload: Record<string, unknown>;
      }>;
    }>;
  };
}

const reseal = (document: MutableArchiveDocument): string => {
  document.integrity.digest = createHash("sha256")
    .update(JSON.stringify(document.adventure))
    .digest("hex");
  return JSON.stringify(document);
};

const authoredKnowledgeArchive = (): string => {
  const repository = createInMemoryAdventureRepository();
  const adventure = repository.create("The Attributable Manor");
  const app = createStructuredPlayApplication({
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
  return repository.exportArchive(adventure.id);
};

const worldKnowledgeEvent = (document: MutableArchiveDocument) => {
  const event = document.adventure.timelines[0]!.events.find(
    (candidate) => candidate.type === "WorldKnowledgeEstablished",
  );
  assert.ok(event);
  return event;
};

const OPEN_SIDE_DOOR: FreeActionDefinition = {
  id: "open-side-door-for-archive-contract",
  label: "Open the side door",
  kind: "Free Action",
  establishedFact: {
    id: "side-door-open",
    text: "The manor's side door is open.",
  },
  availableInScenes: ["arrival"],
  requiredFactIds: [],
};

const knowledgeApplication = (
  adventure: OpenAdventure,
): StructuredPlayApplication =>
  createStructuredPlayApplication({
    timelineStore: adventure.timelineStore,
    freeActions: [OPEN_SIDE_DOOR],
  });

const createKnowledgeTimelineGraph = (repository: AdventureRepository) => {
  const adventure = repository.create("The Portable Knowledge Manor");
  const app = knowledgeApplication(adventure);
  assert.equal(
    app.submit({
      type: "configure-player-character",
      name: "Mara Vey",
      pronouns: "she/her",
      motivation: "Find her missing sister",
      traits: { Might: 0, Wits: 2, Presence: 1 },
    }).status,
    "accepted",
  );
  assert.equal(app.submit({ type: "begin-adventure" }).status, "accepted");
  assert.equal(
    app.submit({ type: "choose-action", actionId: OPEN_SIDE_DOOR.id }).status,
    "accepted",
  );
  assert.equal(
    app.submit({ type: "transition-scene", scene: "discovery" }).status,
    "accepted",
  );

  const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
  const beforePosition = app.view().timeline?.activeTimeline.eventCount;
  assert.ok(beforePosition);
  assert.equal(
    app.submit({ type: "branch-timeline", eventPosition: beforePosition }).status,
    "accepted",
  );
  const beforeRevealTimelineId = adventure.timelineStore.view().activeTimelineId;

  assert.equal(
    app.submit({ type: "select-timeline", timelineId: sourceTimelineId }).status,
    "accepted",
  );
  assert.equal(
    app.submit({
      type: "choose-action",
      actionId: "examine-housekeeper-insignia",
    }).status,
    "accepted",
  );
  assert.equal(
    app.submit({
      type: "choose-action",
      actionId: "trace-concealed-insignia",
    }).status,
    "accepted",
  );
  const afterPosition = app.view().timeline?.activeTimeline.eventCount;
  assert.ok(afterPosition);
  assert.equal(
    app.submit({ type: "branch-timeline", eventPosition: afterPosition }).status,
    "accepted",
  );
  const afterRevealTimelineId = adventure.timelineStore.view().activeTimelineId;

  return {
    adventure,
    app,
    sourceTimelineId,
    beforeRevealTimelineId,
    afterRevealTimelineId,
  };
};

const portableKnowledgeSnapshot = (adventure: OpenAdventure): string => {
  const timelineView = adventure.timelineStore.view();
  return JSON.stringify({
    activeTimelineId: timelineView.activeTimelineId,
    timelines: timelineView.timelines.map((timeline) => {
      const events = adventure.timelineStore.readTimeline(timeline.id);
      return {
        ...timeline,
        events,
        playerKnowledge: projectWorldKnowledge({
          actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
          events,
        }),
        gameMasterKnowledge: projectWorldKnowledge({
          actorScope: GAME_MASTER_ACTOR_SCOPE,
          events,
        }),
      };
    }),
  });
};

const playerKnowledgeIds = (
  adventure: OpenAdventure,
  timelineId: string,
): readonly string[] =>
  projectWorldKnowledge({
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
    events: adventure.timelineStore.readTimeline(timelineId),
  }).entries.map((entry) => entry.id);

const excludedModelCallRecord = (acceptedEventId: string): ModelCallRecord => ({
  id: "archive-excluded-model-call",
  taskType: "narrate-committed-outcome",
  provider: "provider-secret-marker",
  model: "model-secret-marker",
  promptVersion: "archive-contract-v1",
  evidenceBundleId: `evidence:${"a".repeat(64)}`,
  evidenceBundleHash: "a".repeat(64),
  evidenceReferences: [],
  startedAt: "2026-07-20T10:00:00.000Z",
  completedAt: "2026-07-20T10:00:00.001Z",
  durationMs: 1,
  usage: null,
  retryCount: 0,
  fallbackOutcome: "none",
  validation: { status: "accepted" },
  validatedOutput: { rawProviderContent: "raw-provider-secret-marker" },
  command: null,
  acceptedEventIds: [acceptedEventId],
  correlationIds: [],
});

test("import rejects contradictory Visibility and Knowledge Scope before publication", async (t) => {
  const cases = [
    {
      name: "Player-visible knowledge unknown to the Player Character",
      visibility: "Player-visible",
      knowledgeScope: ["Game Master"],
    },
    {
      name: "Game Master-only knowledge known to the Player Character",
      visibility: "Game Master-only",
      knowledgeScope: ["Game Master", "Player Character"],
    },
  ] as const;

  for (const invalid of cases) {
    await t.test(invalid.name, () => {
      const document = JSON.parse(
        authoredKnowledgeArchive(),
      ) as MutableArchiveDocument;
      const event = worldKnowledgeEvent(document);
      event.payload.visibility = invalid.visibility;
      event.payload.knowledgeScope = [...invalid.knowledgeScope];
      const destination: AdventureRepository =
        createInMemoryAdventureRepository();

      assert.throws(
        () => destination.importArchive(reseal(document)),
        /World Knowledge|canonical event|archive/i,
      );
      assert.deepEqual(destination.list(), []);
    });
  }
});

test("format v1 archives from before World Knowledge remain readable without inferred metadata", () => {
  const sourceRepository = createInMemoryAdventureRepository();
  const source = sourceRepository.create("The Earlier Manor");
  const app = createStructuredPlayApplication({
    timelineStore: source.timelineStore,
    authoredWorldKnowledge: [],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const archive = sourceRepository.exportArchive(source.id);
  assert.doesNotMatch(archive, /WorldKnowledgeEstablished/);

  const imported = createInMemoryAdventureRepository().importArchive(archive);
  assert.deepEqual(
    projectWorldKnowledge({
      actorScope: GAME_MASTER_ACTOR_SCOPE,
      events: imported.eventStore.readAll(),
    }).entries,
    [],
  );
  imported.close();
  source.close();
});

test("import rejects malformed World Knowledge references before publishing any Adventure", async (t) => {
  const sourceRepository = createInMemoryAdventureRepository();
  const graph = createKnowledgeTimelineGraph(sourceRepository);
  const serialized = sourceRepository.exportArchive(graph.adventure.id);
  graph.adventure.close();
  const cases: ReadonlyArray<{
    name: string;
    mutate(document: MutableArchiveDocument): void;
  }> = [
    {
      name: "missing visibility",
      mutate: (document) => {
        delete worldKnowledgeEvent(document).payload.visibility;
      },
    },
    {
      name: "missing provenance",
      mutate: (document) => {
        delete worldKnowledgeEvent(document).payload.provenance;
      },
    },
    {
      name: "dangling relationship endpoint",
      mutate: (document) => {
        const relationships = worldKnowledgeEvent(document).payload
          .relationships as Array<{
          relationship: { sourceId: string };
        }>;
        relationships[0]!.relationship.sourceId = "missing-endpoint";
      },
    },
    {
      name: "dangling Reveal reference",
      mutate: (document) => {
        const reveal = document.adventure.timelines
          .flatMap((timeline) => timeline.events)
          .find((event) => event.type === "WorldKnowledgeRevealed");
        assert.ok(reveal);
        reveal.payload.worldKnowledgeId = "missing-knowledge";
      },
    },
  ];

  for (const invalid of cases) {
    await t.test(invalid.name, () => {
      const document = JSON.parse(serialized) as MutableArchiveDocument;
      invalid.mutate(document);
      const destination = createInMemoryAdventureRepository();
      const existing = destination.create("The Existing Manor");
      const existingBefore = JSON.stringify(destination.list());

      assert.throws(
        () => destination.importArchive(reseal(document)),
        (error: unknown) => {
          assert.ok(error instanceof AdventureArchiveError);
          assert.match(error.message, /Adventure archive/);
          return true;
        },
      );
      assert.equal(JSON.stringify(destination.list()), existingBefore);
      existing.close();
    });
  }
});

test("Timeline branches inherit World Knowledge only at their branch position", () => {
  const repository = createInMemoryAdventureRepository();
  const graph = createKnowledgeTimelineGraph(repository);
  const hiddenIds = playerKnowledgeIds(
    graph.adventure,
    graph.beforeRevealTimelineId,
  );
  const revealedIds = playerKnowledgeIds(
    graph.adventure,
    graph.afterRevealTimelineId,
  );

  assert.equal(hiddenIds.includes("cellar-guardian-identity"), false);
  assert.equal(hiddenIds.includes("housekeeper-guards-cellar"), false);
  assert.equal(revealedIds.includes("cellar-guardian-identity"), true);
  assert.equal(revealedIds.includes("housekeeper-guards-cellar"), true);

  const sourceBeforeContinuation = JSON.stringify(
    graph.adventure.timelineStore.readTimeline(graph.sourceTimelineId),
  );
  const afterBeforeContinuation = JSON.stringify(
    graph.adventure.timelineStore.readTimeline(graph.afterRevealTimelineId),
  );
  assert.equal(
    graph.app.submit({
      type: "select-timeline",
      timelineId: graph.beforeRevealTimelineId,
    }).status,
    "accepted",
  );
  assert.equal(
    graph.app.submit({
      type: "choose-action",
      actionId: "examine-housekeeper-insignia",
    }).status,
    "accepted",
  );

  assert.equal(
    JSON.stringify(
      graph.adventure.timelineStore.readTimeline(graph.sourceTimelineId),
    ),
    sourceBeforeContinuation,
  );
  assert.equal(
    JSON.stringify(
      graph.adventure.timelineStore.readTimeline(graph.afterRevealTimelineId),
    ),
    afterBeforeContinuation,
  );
  assert.equal(
    playerKnowledgeIds(
      graph.adventure,
      graph.beforeRevealTimelineId,
    ).includes("housekeeper-guards-cellar"),
    false,
  );
});

test("local reopen restores byte-equivalent World Knowledge on every Timeline", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-knowledge-reopen-"));
  const graph = createKnowledgeTimelineGraph(
    createLocalAdventureRepository(directory),
  );
  const expected = portableKnowledgeSnapshot(graph.adventure);
  const adventureId = graph.adventure.id;
  graph.adventure.close();

  const reopened = createLocalAdventureRepository(directory).open(adventureId);
  assert.equal(portableKnowledgeSnapshot(reopened), expected);
  reopened.close();
});

test("every repository adapter pair preserves portable World Knowledge and excludes model data", async (t) => {
  const factories = [
    {
      name: "in-memory",
      create: (): AdventureRepository => createInMemoryAdventureRepository(),
    },
    {
      name: "local durable",
      create: (): AdventureRepository =>
        createLocalAdventureRepository(
          mkdtempSync(join(tmpdir(), "ai-ttrpg-knowledge-adapter-")),
        ),
    },
  ] as const;

  for (const sourceFactory of factories) {
    for (const destinationFactory of factories) {
      await t.test(
        `${sourceFactory.name} to ${destinationFactory.name}`,
        () => {
          const sourceRepository = sourceFactory.create();
          const graph = createKnowledgeTimelineGraph(sourceRepository);
          const acceptedEventId = graph.adventure.eventStore.readAll().at(-1)?.id;
          assert.ok(acceptedEventId);
          graph.adventure.modelCallStore.append(
            excludedModelCallRecord(acceptedEventId),
          );
          const expected = portableKnowledgeSnapshot(graph.adventure);
          const archive = sourceRepository.exportArchive(graph.adventure.id);
          assert.doesNotMatch(
            archive,
            /archive-excluded-model-call|provider-secret-marker|model-secret-marker|raw-provider-secret-marker/,
          );

          const imported = destinationFactory.create().importArchive(archive);
          assert.equal(portableKnowledgeSnapshot(imported), expected);
          assert.deepEqual(imported.modelCallStore.readAll(), []);
          imported.close();
          graph.adventure.close();
        },
      );
    }
  }
});
