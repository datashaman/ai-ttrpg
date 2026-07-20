import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleInterpretationEvidence,
} from "../src/evidence-bundle.js";
import {
  createInMemoryAdventureRepository,
} from "../src/adventure-repository.js";
import {
  createModelGateway,
  type ModelProvider,
} from "../src/model-gateway.js";
import { runNaturalLanguagePlay } from "../src/natural-language-play.js";
import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
} from "../src/structured-play.js";
import {
  filterCanonicalEventsVisibleTo,
  GAME_MASTER_ACTOR_SCOPE,
  playerWorldKnowledgeActorScope,
  projectWorldKnowledge,
  UNAUTHENTICATED_ACTOR_SCOPE,
} from "../src/world-knowledge.js";
import {
  IONA_PLAYER_CHARACTER_ID,
  MARA_PLAYER_CHARACTER_ID,
  TWO_CHARACTER_WORLD_KNOWLEDGE,
} from "./support/character-scoped-world-knowledge.js";
import { scriptedIO } from "./support/scripted-io.js";

const maraActor = playerWorldKnowledgeActorScope(MARA_PLAYER_CHARACTER_ID);
const ionaActor = playerWorldKnowledgeActorScope(IONA_PLAYER_CHARACTER_ID);

const configureAndBegin = (
  app: ReturnType<typeof createStructuredPlayApplication>,
): void => {
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
};

test("World Knowledge is visible only to its intended Player Character", () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    actorScope: maraActor,
    eventStore,
    authoredWorldKnowledge: TWO_CHARACTER_WORLD_KNOWLEDGE,
  });
  configureAndBegin(app);
  const events = eventStore.readAll();

  const mara = projectWorldKnowledge({
    actorScope: maraActor,
    events,
  });
  const iona = projectWorldKnowledge({
    actorScope: ionaActor,
    events,
  });
  const unauthenticated = projectWorldKnowledge({
    actorScope: UNAUTHENTICATED_ACTOR_SCOPE,
    events,
  });
  const gameMaster = projectWorldKnowledge({
    actorScope: GAME_MASTER_ACTOR_SCOPE,
    events,
  });

  assert.deepEqual(mara.entries.map(({ id }) => id), [
    "mara-remembers-insignia",
  ]);
  assert.deepEqual(iona.entries.map(({ id }) => id), ["iona-knows-tunnel"]);
  assert.deepEqual(unauthenticated.entries, []);
  assert.deepEqual(gameMaster.entries.map(({ id }) => id), [
    "mara-remembers-insignia",
    "iona-knows-tunnel",
  ]);
  assert.deepEqual(app.worldKnowledge(maraActor), mara);
  assert.deepEqual(app.worldKnowledge(ionaActor), iona);
});

test("character scope filters canonical history before Evidence Bundle selection", () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    actorScope: maraActor,
    eventStore,
    authoredWorldKnowledge: TWO_CHARACTER_WORLD_KNOWLEDGE,
  });
  configureAndBegin(app);
  const events = eventStore.readAll();

  const maraEvidence = assembleInterpretationEvidence({
    actorScope: maraActor,
    utterance: "What does Iona know about world-knowledge:iona-knows-tunnel?",
    view: app.view(),
    acceptedEvents: events,
    maxItems: 64,
  });
  const ionaEvidence = assembleInterpretationEvidence({
    actorScope: ionaActor,
    utterance: "What do I know about the tunnel?",
    view: app.view(),
    acceptedEvents: events,
    maxItems: 64,
  });
  const maraSurface = JSON.stringify({
    events: filterCanonicalEventsVisibleTo({
      actorScope: maraActor,
      events,
    }),
    evidence: maraEvidence,
  });
  const unauthenticatedSurface = JSON.stringify(
    filterCanonicalEventsVisibleTo({
      actorScope: UNAUTHENTICATED_ACTOR_SCOPE,
      events,
    }),
  );

  assert.doesNotMatch(maraSurface, /iona-knows-tunnel|abandoned well/i);
  assert.doesNotMatch(
    maraSurface,
    /PlayerCharacterConfigured|FreeActionCompleted|CheckResolved|OracleAnswered/,
  );
  assert.doesNotMatch(
    unauthenticatedSurface,
    /mara-remembers-insignia|iona-knows-tunnel|silver insignia|abandoned well/i,
  );
  assert.match(JSON.stringify(ionaEvidence), /iona-knows-tunnel/);
});

test("the model boundary receives only the intended Player Character's evidence", async () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    actorScope: maraActor,
    eventStore,
    authoredWorldKnowledge: TWO_CHARACTER_WORLD_KNOWLEDGE,
  });
  configureAndBegin(app);
  let observedTask = "";
  const provider: ModelProvider = {
    provider: "character-scope-inspector",
    model: "character-scope-v1",
    invoke: async (task) => {
      observedTask = JSON.stringify(task);
      return {
        output: {
          status: "interpreted",
          classification: "table-chat",
          referencedEntityIds: [],
        },
        usage: null,
      };
    },
  };

  const result = await runNaturalLanguagePlay({
    actorScope: maraActor,
    io: scriptedIO(["What do I remember about the insignia?"]).io,
    eventStore,
    applicationOptions: {
      authoredWorldKnowledge: TWO_CHARACTER_WORLD_KNOWLEDGE,
    },
    modelGateway: createModelGateway({ provider }),
  });

  assert.match(observedTask, /mara-remembers-insignia|silver insignia/i);
  assert.doesNotMatch(observedTask, /iona-knows-tunnel|abandoned well/i);
  assert.doesNotMatch(observedTask, /PlayerCharacterConfigured/);
  assert.doesNotMatch(
    JSON.stringify(result.modelCallRecords),
    /iona-knows-tunnel|abandoned well/i,
  );
});

test("unauthorized knowledge is filtered before projection validation and diagnostics", () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    actorScope: maraActor,
    eventStore,
    authoredWorldKnowledge: TWO_CHARACTER_WORLD_KNOWLEDGE,
  });
  configureAndBegin(app);
  const events = eventStore.readAll();
  const ionaEvent = events.find(
    (event) =>
      event.type === "WorldKnowledgeEstablished" &&
      event.payload.fact.id === "iona-knows-tunnel",
  );
  assert.ok(ionaEvent);
  const duplicateIonaEvent = {
    ...ionaEvent,
    id: "duplicate-iona-private-knowledge",
    sequence: events.length + 1,
  };

  assert.deepEqual(
    projectWorldKnowledge({
      actorScope: maraActor,
      events: [...events, duplicateIonaEvent],
    }),
    projectWorldKnowledge({ actorScope: maraActor, events }),
  );
  assert.throws(
    () =>
      projectWorldKnowledge({
        actorScope: GAME_MASTER_ACTOR_SCOPE,
        events: [...events, duplicateIonaEvent],
      }),
    {
      name: "WorldKnowledgeError",
      code: "DUPLICATE_KNOWLEDGE_ID",
    },
  );
});

test("a Reveal expands one Player Character's Knowledge Scope without changing truth or Provenance", () => {
  const hiddenKnowledge = {
    fact: {
      id: "guardian-wears-silver",
      text: "The cellar guardian wears a silver insignia.",
    },
    provenance: {
      originKind: "authored-content" as const,
      sourceReference: "fixture:character-reveal:guardian",
    },
    visibility: "Game Master-only" as const,
    knowledgeScope: ["Game Master" as const],
  };
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    actorScope: maraActor,
    eventStore,
    authoredWorldKnowledge: [hiddenKnowledge],
    reveals: [
      {
        id: "show-mara-insignia",
        label: "Show Mara the guardian's insignia",
        kind: "Reveal",
        worldKnowledgeId: hiddenKnowledge.fact.id,
        availableInScenes: ["arrival"],
        requiredFactIds: [],
        knowledgeScope: [
          "Game Master",
          {
            kind: "Player Character",
            playerCharacterId: MARA_PLAYER_CHARACTER_ID,
          },
        ],
      },
    ],
  });
  configureAndBegin(app);
  const before = app.worldKnowledge(GAME_MASTER_ACTOR_SCOPE).entries[0];
  assert.ok(before);

  const reveal = app.submit({
    type: "choose-action",
    actionId: "show-mara-insignia",
  });
  assert.equal(reveal.status, "accepted");
  assert.deepEqual(reveal.appendedEvents.map(({ type }) => type), [
    "WorldKnowledgeRevealed",
  ]);

  const revealed = app.worldKnowledge(maraActor).entries[0];
  assert.ok(revealed);
  assert.equal(revealed.id, before.id);
  assert.equal(revealed.kind, before.kind);
  assert.equal(
    revealed.kind === "Established Fact" ? revealed.text : revealed.content,
    before.kind === "Established Fact" ? before.text : before.content,
  );
  assert.deepEqual(revealed.provenance, before.provenance);
  assert.deepEqual(app.worldKnowledge(ionaActor).entries, []);
  assert.doesNotMatch(
    JSON.stringify(
      filterCanonicalEventsVisibleTo({
        actorScope: ionaActor,
        events: eventStore.readAll(),
      }),
    ),
    /guardian-wears-silver|silver insignia/i,
  );
});

test("replay, branching, reopening, and archive import preserve character-scoped knowledge", () => {
  const repository = createInMemoryAdventureRepository();
  let adventure = repository.create("Two-character knowledge fixture");
  const app = createStructuredPlayApplication({
    actorScope: maraActor,
    timelineStore: adventure.timelineStore,
    authoredWorldKnowledge: TWO_CHARACTER_WORLD_KNOWLEDGE,
  });
  configureAndBegin(app);
  const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
  const sourceEvents = adventure.timelineStore.readTimeline(sourceTimelineId);
  const expected = JSON.stringify({
    mara: projectWorldKnowledge({ actorScope: maraActor, events: sourceEvents }),
    iona: projectWorldKnowledge({ actorScope: ionaActor, events: sourceEvents }),
  });

  adventure.timelineStore.branchTimeline(sourceEvents.length);
  const branchEvents = adventure.timelineStore.readAll();
  assert.equal(
    JSON.stringify({
      mara: projectWorldKnowledge({ actorScope: maraActor, events: branchEvents }),
      iona: projectWorldKnowledge({ actorScope: ionaActor, events: branchEvents }),
    }),
    expected,
  );

  const adventureId = adventure.id;
  adventure.close();
  adventure = repository.open(adventureId);
  const reopenedEvents = adventure.timelineStore.readAll();
  assert.equal(
    JSON.stringify({
      mara: projectWorldKnowledge({ actorScope: maraActor, events: reopenedEvents }),
      iona: projectWorldKnowledge({ actorScope: ionaActor, events: reopenedEvents }),
    }),
    expected,
  );

  const archive = repository.exportArchive(adventureId);
  assert.match(archive, /mara-remembers-insignia/);
  assert.match(archive, /iona-knows-tunnel/);
  const imported = createInMemoryAdventureRepository().importArchive(archive);
  const importedEvents = imported.timelineStore.readAll();
  assert.equal(
    JSON.stringify({
      mara: projectWorldKnowledge({ actorScope: maraActor, events: importedEvents }),
      iona: projectWorldKnowledge({ actorScope: ionaActor, events: importedEvents }),
    }),
    expected,
  );
});
