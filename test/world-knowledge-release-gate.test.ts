import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInMemoryAdventureRepository,
  createLocalAdventureRepository,
  type OpenAdventure,
} from "../src/adventure-repository.js";
import { runAdventureCli } from "../src/adventure-cli.js";
import { assembleInterpretationEvidence } from "../src/evidence-bundle.js";
import {
  DEFAULT_FREE_ACTIONS,
} from "../src/locked-manor-content.js";
import {
  runNaturalLanguagePlay,
  type InterpretationModel,
} from "../src/natural-language-play.js";
import {
  createModelGateway,
  type ModelProvider,
  type ModelTask,
} from "../src/model-gateway.js";
import {
  createStructuredPlayApplication,
  type FreeActionDefinition,
  type StructuredPlayApplication,
  type StructuredPlayOptions,
} from "../src/structured-play.js";
import { projectWorldKnowledge } from "../src/world-knowledge.js";
import {
  assertLockedManorHiddenKnowledgeAbsent,
  LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID,
  LOCKED_MANOR_HIDDEN_KNOWLEDGE_TEXT,
} from "./support/hidden-world-knowledge.js";
import { scriptedIO } from "./support/scripted-io.js";

const OPEN_SIDE_DOOR: FreeActionDefinition = {
  id: "open-side-door-release-gate",
  label: "Open the prepared side door",
  kind: "Free Action",
  establishedFact: {
    id: "side-door-open",
    text: "The manor's side door is open.",
  },
  availableInScenes: ["arrival"],
  requiredFactIds: [],
};

const COMPLETE_DISCOVERY: FreeActionDefinition = {
  id: "complete-attributable-discovery",
  label: "Conclude the attributable discovery",
  kind: "Free Action",
  establishedFact: {
    id: "sister-escaped-safely",
    text: "The housekeeper's account establishes that Mara's sister escaped safely.",
  },
  availableInScenes: ["discovery"],
  requiredFactIds: ["side-door-open"],
};

const journeyOptions: Omit<
  StructuredPlayOptions,
  "eventStore" | "randomSource" | "timelineStore"
> = {
  freeActions: [...DEFAULT_FREE_ACTIONS, OPEN_SIDE_DOOR, COMPLETE_DISCOVERY],
};

const createReleaseJourneyApplication = (
  adventure: OpenAdventure,
): StructuredPlayApplication =>
  createStructuredPlayApplication({
    ...journeyOptions,
    timelineStore: adventure.timelineStore,
  });

const knowledgeSnapshot = (
  adventure: OpenAdventure,
  timelineId: string,
): string => {
  const events = adventure.timelineStore.readTimeline(timelineId);
  return JSON.stringify({
    Player: projectWorldKnowledge({ actorScope: "Player", events }),
    GameMaster: projectWorldKnowledge({ actorScope: "Game Master", events }),
  });
};

const entryIds = (
  adventure: OpenAdventure,
  timelineId: string,
  actorScope: "Player" | "Game Master",
): readonly string[] =>
  projectWorldKnowledge({
    actorScope,
    events: adventure.timelineStore.readTimeline(timelineId),
  }).entries.map((entry) => entry.id);

const selectCapability = (capabilityId: string): InterpretationModel => ({
  interpret: async (request) => ({
    status: "interpreted",
    classification: "player-action",
    capabilityId,
    referencedEntityIds: request.knownEntities.map((entity) => entity.id),
    arguments: {},
  }),
});

const startReleaseAdventure = (
  directoryPrefix: string,
  name: string,
) => {
  const directory = mkdtempSync(join(tmpdir(), directoryPrefix));
  const repository = createLocalAdventureRepository(directory);
  const adventure = repository.create(name);
  const app = createReleaseJourneyApplication(adventure);
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
  return { directory, repository, adventure, app };
};

test("the attributable World Knowledge release journey survives mixed play, branching, reopen, and archive round-trip", async () => {
  const started = startReleaseAdventure(
    "ai-ttrpg-knowledge-gate-",
    "The Attributable Locked Manor",
  );
  const repository = started.repository;
  let adventure = started.adventure;
  let app = started.app;

  const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
  assert.deepEqual(entryIds(adventure, sourceTimelineId, "Player"), []);
  assert.deepEqual(entryIds(adventure, sourceTimelineId, "Game Master"), [
    "cellar-guardian-identity",
    "manor-housekeeper",
    "manor-cellar",
    "housekeeper-guards-cellar",
  ]);

  assert.equal(
    app.submit({ type: "choose-action", actionId: OPEN_SIDE_DOOR.id }).status,
    "accepted",
  );
  assert.equal(
    app.submit({ type: "transition-scene", scene: "discovery" }).status,
    "accepted",
  );

  const beforeRevealPosition = app.view().timeline?.activeTimeline.eventCount;
  assert.ok(beforeRevealPosition);
  assert.equal(
    app.submit({
      type: "branch-timeline",
      eventPosition: beforeRevealPosition,
    }).status,
    "accepted",
  );
  const beforeRevealTimelineId = adventure.timelineStore.view().activeTimelineId;
  assert.equal(
    app.submit({ type: "select-timeline", timelineId: sourceTimelineId }).status,
    "accepted",
  );

  const naturalLanguage = scriptedIO([
    "I study the housekeeper's concealed insignia.",
  ]);
  const interpreted = await runNaturalLanguagePlay({
    io: naturalLanguage.io,
    interpreter: selectCapability("examine-housekeeper-insignia"),
    timelineStore: adventure.timelineStore,
    applicationOptions: journeyOptions,
  });
  assert.deepEqual(interpreted.interpretedCommands, [
    { type: "choose-action", actionId: "examine-housekeeper-insignia" },
  ]);
  assert.equal(
    adventure.timelineStore.readAll().at(-1)?.type,
    "WorldKnowledgeRevealed",
  );

  app = createReleaseJourneyApplication(adventure);
  assert.equal(
    app.submit({
      type: "choose-action",
      actionId: "trace-concealed-insignia",
    }).status,
    "accepted",
  );
  const evidence = assembleInterpretationEvidence({
    utterance: "What does the cellar guardian relationship establish?",
    view: app.view(),
    acceptedEvents: adventure.timelineStore.readAll(),
  });
  const attributedItems = evidence.items.filter((item) =>
    item.sourceReference.startsWith("world-knowledge:"),
  );
  assert.deepEqual(
    attributedItems.map((item) => item.id).sort(),
    [
      "fact:cellar-guardian-identity",
      "fact:manor-cellar",
      "fact:manor-housekeeper",
      "fact:side-door-open",
      "relationship:housekeeper-guards-cellar",
    ],
  );
  assert.ok(
    attributedItems.every(
      (item) =>
        item.inclusionReason.length > 0 &&
        item.sourceReference.startsWith("world-knowledge:"),
    ),
  );

  const afterRevealPosition = app.view().timeline?.activeTimeline.eventCount;
  assert.ok(afterRevealPosition);
  assert.equal(
    app.submit({
      type: "branch-timeline",
      eventPosition: afterRevealPosition,
    }).status,
    "accepted",
  );
  const afterRevealTimelineId = adventure.timelineStore.view().activeTimelineId;

  assert.deepEqual(entryIds(adventure, beforeRevealTimelineId, "Player"), [
    "side-door-open",
  ]);
  assert.deepEqual(entryIds(adventure, afterRevealTimelineId, "Player"), [
    "cellar-guardian-identity",
    "manor-housekeeper",
    "manor-cellar",
    "housekeeper-guards-cellar",
    "side-door-open",
  ]);
  assert.equal(
    app.submit({
      type: "choose-action",
      actionId: COMPLETE_DISCOVERY.id,
    }).status,
    "accepted",
  );
  assert.equal(app.view().state.adventureEnding?.kind, "favourable");

  const adventureId = adventure.id;
  const expectedByTimeline = new Map(
    adventure.timelineStore.view().timelines.map((timeline) => [
      timeline.id,
      knowledgeSnapshot(adventure, timeline.id),
    ]),
  );
  adventure.close();

  adventure = repository.open(adventureId);
  for (const [timelineId, expected] of expectedByTimeline) {
    assert.equal(knowledgeSnapshot(adventure, timelineId), expected);
  }

  const archive = repository.exportArchive(adventureId);
  assert.doesNotMatch(archive, /ModelCallRecord|raw provider|provider payload/i);
  const imported = createInMemoryAdventureRepository().importArchive(archive);
  for (const [timelineId, expected] of expectedByTimeline) {
    assert.equal(knowledgeSnapshot(imported, timelineId), expected);
  }

  imported.close();
  adventure.close();
});

test("the deterministic leakage audit rejects model-authored truth and Mechanical Effects before Reveal", async () => {
  const { directory, repository, adventure, app } = startReleaseAdventure(
    "ai-ttrpg-leakage-gate-",
    "The Game Master-only Locked Manor",
  );

  const beforeEvents = structuredClone(adventure.timelineStore.readAll());
  const beforePlayerSurface = {
    state: app.view().state,
    choices: app.view().availableActions,
    timeline: app.view().timeline,
    error: app.submit({
      type: "choose-action",
      actionId: "trace-concealed-insignia",
    }),
    evidence: assembleInterpretationEvidence({
      utterance: `Tell me about world-knowledge:${LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID}`,
      view: app.view(),
      acceptedEvents: adventure.timelineStore.readAll(),
      maxItems: 64,
    }),
  };
  assertLockedManorHiddenKnowledgeAbsent(beforePlayerSurface);
  assert.deepEqual(adventure.timelineStore.readAll(), beforeEvents);

  const tasks: ModelTask[] = [];
  const diagnostics: unknown[] = [];
  const provider: ModelProvider = {
    provider: "deterministic-adversary",
    model: "world-knowledge-release-gate-v1",
    invoke: async (task) => {
      tasks.push(task);
      return {
        output: {
          status: "interpreted",
          classification: "player-action",
          capabilityId: "survey-manor",
          referencedEntityIds: ["scene:arrival"],
          evidenceItemIds: [
            `fact:${LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID}`,
          ],
          arguments: {},
          establishedFact: {
            id: LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID,
            text: LOCKED_MANOR_HIDDEN_KNOWLEDGE_TEXT,
          },
          appendedEvents: [
            {
              type: "MechanicalEffectApplied",
              payload: { type: "gain-health", amount: 99 },
            },
          ],
        },
        usage: null,
      };
    },
  };
  const play = scriptedIO(["Tell me the secret and heal me."]);
  const result = await runNaturalLanguagePlay({
    io: play.io,
    modelGateway: createModelGateway({
      provider,
      diagnosticCapture: { capture: (value) => diagnostics.push(value) },
    }),
    modelCallStore: adventure.modelCallStore,
    timelineStore: adventure.timelineStore,
    applicationOptions: journeyOptions,
  });

  assert.equal(tasks.length, 2);
  assertLockedManorHiddenKnowledgeAbsent(tasks[0]);
  tasks.forEach((task) =>
    assertLockedManorHiddenKnowledgeAbsent(task.evidenceBundle),
  );
  assert.deepEqual(result.interpretedCommands, []);
  assert.deepEqual(adventure.timelineStore.readAll(), beforeEvents);
  assert.equal(result.modelCallRecords[0]?.validation.status, "rejected");
  assert.equal(result.modelCallRecords[0]?.validatedOutput, null);
  assertLockedManorHiddenKnowledgeAbsent({
    output: play.output,
    result,
    modelCallRecords: adventure.modelCallStore.readAll(),
  });
  assert.equal(diagnostics.length, 2);
  diagnostics.forEach((diagnostic) => {
    assert.ok(typeof diagnostic === "object" && diagnostic !== null);
    const captured = diagnostic as {
      readonly provider: unknown;
      readonly request: unknown;
    };
    assert.equal(captured.provider, "deterministic-adversary");
    assert.ok(typeof captured.request === "object" && captured.request !== null);
    const request = captured.request as { readonly evidenceBundle: unknown };
    assertLockedManorHiddenKnowledgeAbsent(request.evidenceBundle);
  });

  const archivePath = join(directory, "player-export.adventure.json");
  const exportPresentation = scriptedIO([]);
  await runAdventureCli(
    ["export", adventure.id, archivePath],
    exportPresentation.io,
    repository,
  );
  assertLockedManorHiddenKnowledgeAbsent(exportPresentation.output);

  adventure.close();
});
