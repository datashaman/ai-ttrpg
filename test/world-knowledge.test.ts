import assert from "node:assert/strict";
import test from "node:test";

import { assembleInterpretationEvidence } from "../src/evidence-bundle.js";
import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type FreeActionDefinition,
} from "../src/structured-play.js";
import { projectWorldKnowledge } from "../src/world-knowledge.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";

const beginWithFreeActions = (
  actions: readonly FreeActionDefinition[],
) => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({ eventStore, freeActions: actions });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  return { app, eventStore };
};

test("Player projects attributable World Knowledge from canonical history", () => {
  const { app, eventStore } = beginAdventureFixture();
  app.submit({ type: "choose-action", actionId: "survey-manor" });

  const knowledge = projectWorldKnowledge({
    actorScope: "Player",
    events: eventStore.readAll(),
  });
  const gameMasterKnowledge = projectWorldKnowledge({
    actorScope: "Game Master",
    events: eventStore.readAll(),
  });

  assert.deepEqual(knowledge, {
    actorScope: "Player",
    entries: [
      {
        id: "fresh-footprints",
        kind: "Established Fact",
        text:
          "Fresh footprints lead from the manor gate toward a dark side entrance.",
        provenance: {
          originKind: "authored-content",
          sourceReference: "free-action:survey-manor",
          establishedByEventId: eventStore.readAll()[2]!.id,
        },
        visibility: "Player-visible",
        knowledgeScope: ["Player Character"],
      },
    ],
  });
  assert.equal(Object.isFrozen(knowledge), true);
  assert.equal(Object.isFrozen(knowledge.entries), true);
  assert.equal(Object.isFrozen(knowledge.entries[0]), true);
  assert.equal(Object.isFrozen(knowledge.entries[0]!.provenance), true);
  assert.equal(Object.isFrozen(knowledge.entries[0]!.knowledgeScope), true);
  assert.deepEqual(gameMasterKnowledge, {
    ...knowledge,
    actorScope: "Game Master",
  });
});

test("World Knowledge rejects a missing or unknown actor scope", () => {
  assert.throws(
    () =>
      projectWorldKnowledge({
        actorScope: undefined as never,
        events: [],
      }),
    {
      name: "WorldKnowledgeError",
      message: "World Knowledge requires an explicit Player or Game Master actor scope. [INVALID_ACTOR_SCOPE]",
    },
  );
});

test("World Knowledge rejects a duplicate ID already present in canonical history", () => {
  const { app, eventStore } = beginAdventureFixture();
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const events = eventStore.readAll();
  const established = events.find(
    (event) => event.type === "FreeActionCompleted",
  );
  assert.ok(established);
  const duplicate = {
    ...established,
    id: "duplicate-fresh-footprints-event",
    sequence: events.length + 1,
  };

  assert.throws(
    () =>
      projectWorldKnowledge({
        actorScope: "Player",
        events: [...events, duplicate],
      }),
    {
      name: "WorldKnowledgeError",
      code: "DUPLICATE_KNOWLEDGE_ID",
    },
  );
});

test("a duplicate World Knowledge ID is rejected before an event commits", () => {
  const actions: readonly FreeActionDefinition[] = [
    {
      id: "observe-first-trace",
      label: "Observe the first trace",
      kind: "Free Action",
      establishedFact: { id: "shared-trace", text: "The trace is visible." },
      availableInScenes: ["arrival"],
      requiredFactIds: [],
    },
    {
      id: "observe-second-trace",
      label: "Observe the second trace",
      kind: "Free Action",
      establishedFact: { id: "shared-trace", text: "The trace is visible." },
      availableInScenes: ["arrival"],
      requiredFactIds: [],
    },
  ];
  const { app, eventStore } = beginWithFreeActions(actions);
  const first = app.submit({ type: "choose-action", actionId: actions[0]!.id });
  assert.equal(first.status, "accepted");
  const beforeEvents = structuredClone(eventStore.readAll());
  const beforeKnowledge = projectWorldKnowledge({
    actorScope: "Player",
    events: eventStore.readAll(),
  });

  const duplicate = app.submit({
    type: "choose-action",
    actionId: actions[1]!.id,
  });

  assert.equal(duplicate.status, "rejected");
  assert.equal(duplicate.code, "invalid-world-knowledge");
  assert.deepEqual(duplicate.appendedEvents, []);
  assert.deepEqual(eventStore.readAll(), beforeEvents);
  assert.deepEqual(
    projectWorldKnowledge({
      actorScope: "Player",
      events: eventStore.readAll(),
    }),
    beforeKnowledge,
  );
});

test("contradictory World Knowledge text is rejected before an event commits", () => {
  const actions: readonly FreeActionDefinition[] = [
    {
      id: "observe-open-gate",
      label: "Observe the open gate",
      kind: "Free Action",
      establishedFact: { id: "gate-state", text: "The gate is open." },
      availableInScenes: ["arrival"],
      requiredFactIds: [],
    },
    {
      id: "observe-closed-gate",
      label: "Observe the closed gate",
      kind: "Free Action",
      establishedFact: { id: "gate-state", text: "The gate is closed." },
      availableInScenes: ["arrival"],
      requiredFactIds: [],
    },
  ];
  const { app, eventStore } = beginWithFreeActions(actions);
  const first = app.submit({ type: "choose-action", actionId: actions[0]!.id });
  assert.equal(first.status, "accepted");
  const beforeEvents = structuredClone(eventStore.readAll());
  const beforeKnowledge = projectWorldKnowledge({
    actorScope: "Game Master",
    events: eventStore.readAll(),
  });

  const contradiction = app.submit({
    type: "choose-action",
    actionId: actions[1]!.id,
  });

  assert.equal(contradiction.status, "rejected");
  assert.equal(contradiction.code, "invalid-world-knowledge");
  assert.match(contradiction.message, /contradictory Established Fact text/);
  assert.deepEqual(contradiction.appendedEvents, []);
  assert.deepEqual(eventStore.readAll(), beforeEvents);
  assert.deepEqual(
    projectWorldKnowledge({
      actorScope: "Game Master",
      events: eventStore.readAll(),
    }),
    beforeKnowledge,
  );
});

test("Player-visible World Knowledge enters attributable interpretation evidence", () => {
  const { app, eventStore } = beginAdventureFixture();
  app.submit({ type: "choose-action", actionId: "survey-manor" });

  const evidence = assembleInterpretationEvidence({
    utterance: "I follow the fresh footprints.",
    view: app.view(),
    acceptedEvents: eventStore.readAll(),
  });

  assert.deepEqual(
    evidence.items.find((item) => item.id === "fact:fresh-footprints"),
    {
      id: "fact:fresh-footprints",
      sourceKind: "established-fact",
      sourceReference: "world-knowledge:fresh-footprints",
      content:
        "Fresh footprints lead from the manor gate toward a dark side entrance.",
      inclusionReason:
        "This Player-visible World Knowledge Entry describes the current situation.",
    },
  );
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.items), true);
  assert.equal(Object.isFrozen(evidence.items[0]), true);
});
