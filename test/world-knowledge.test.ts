import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleInterpretationEvidence,
  assembleNarrationEvidence,
  assembleRulesExplanationEvidence,
  type NarrationEvidenceInput,
} from "../src/evidence-bundle.js";
import {
  createInMemoryEventStore,
  createInMemoryTimelineStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type EventStore,
  type FreeActionDefinition,
} from "../src/structured-play.js";
import { projectWorldKnowledge } from "../src/world-knowledge.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import { reachLockedManorDiscovery } from "./support/world-knowledge-fixture.js";

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
  const establishedEvent = eventStore
    .readAll()
    .find((event) => event.type === "FreeActionCompleted");
  assert.ok(establishedEvent);

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
          establishedByEventId: establishedEvent.id,
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
  assert.deepEqual(
    gameMasterKnowledge.entries.filter(
      (entry) => entry.visibility === "Player-visible",
    ),
    knowledge.entries,
  );
});

test("authored locked-manor knowledge is visible only to the Game Master", () => {
  const { eventStore } = beginAdventureFixture();

  const playerKnowledge = projectWorldKnowledge({
    actorScope: "Player",
    events: eventStore.readAll(),
  });
  const gameMasterKnowledge = projectWorldKnowledge({
    actorScope: "Game Master",
    events: eventStore.readAll(),
  });
  const authoredEvent = eventStore
    .readAll()
    .find((event) => event.type === "WorldKnowledgeEstablished");
  assert.ok(authoredEvent);

  assert.deepEqual(playerKnowledge.entries, []);
  assert.deepEqual(gameMasterKnowledge.entries, [
    {
      id: "cellar-guardian-identity",
      kind: "Established Fact",
      text: "The manor's housekeeper is the cellar guardian in disguise.",
      provenance: {
        originKind: "authored-content",
        sourceReference: "locked-manor:cellar-guardian",
        establishedByEventId: authoredEvent.id,
      },
      visibility: "Game Master-only",
      knowledgeScope: ["Game Master"],
    },
  ]);
  assert.equal(Object.isFrozen(playerKnowledge), true);
  assert.equal(Object.isFrozen(playerKnowledge.entries), true);
  assert.equal(Object.isFrozen(gameMasterKnowledge), true);
  assert.equal(Object.isFrozen(gameMasterKnowledge.entries), true);
  assert.equal(Object.isFrozen(gameMasterKnowledge.entries[0]), true);
  assert.equal(
    Object.isFrozen(gameMasterKnowledge.entries[0]!.provenance),
    true,
  );
  assert.equal(
    Object.isFrozen(gameMasterKnowledge.entries[0]!.knowledgeScope),
    true,
  );
});

test("Structured Play canonically reveals authored knowledge after its discovery preconditions", () => {
  const { app, eventStore } = reachLockedManorDiscovery();

  const beforeEvents = structuredClone(eventStore.readAll());
  const beforePlayer = projectWorldKnowledge({
    actorScope: "Player",
    events: beforeEvents,
  });
  const beforeGameMaster = projectWorldKnowledge({
    actorScope: "Game Master",
    events: beforeEvents,
  });
  assert.equal(
    beforePlayer.entries.some(
      (entry) => entry.id === "cellar-guardian-identity",
    ),
    false,
  );
  const hiddenEntry = beforeGameMaster.entries.find(
    (entry) => entry.id === "cellar-guardian-identity",
  );
  assert.ok(hiddenEntry);
  assert.ok(
    app.view().availableActions.some(
      (action) => action.id === "examine-housekeeper-insignia",
    ),
  );

  const revealed = app.submit({
    type: "choose-action",
    actionId: "examine-housekeeper-insignia",
  });

  assert.equal(revealed.status, "accepted");
  assert.deepEqual(revealed.appendedEvents.map((event) => event.type), [
    "WorldKnowledgeRevealed",
  ]);
  const revealEvent = eventStore.readAll().at(-1);
  assert.equal(revealEvent?.type, "WorldKnowledgeRevealed");
  if (revealEvent?.type !== "WorldKnowledgeRevealed") return;
  assert.deepEqual(revealEvent.payload, {
    worldKnowledgeId: "cellar-guardian-identity",
    knowledgeScope: ["Game Master", "Player Character"],
  });
  const afterPlayer = projectWorldKnowledge({
    actorScope: "Player",
    events: eventStore.readAll(),
  });
  assert.deepEqual(
    afterPlayer.entries.find(
      (entry) => entry.id === "cellar-guardian-identity",
    ),
    {
      ...hiddenEntry,
      visibility: "Player-visible",
      knowledgeScope: ["Game Master", "Player Character"],
    },
  );
  assert.deepEqual(
    afterPlayer.entries.find(
      (entry) => entry.id === "cellar-guardian-identity",
    )?.provenance,
    hiddenEntry.provenance,
  );
});

test("a committed Reveal enters attributable evidence and survives reopening", () => {
  const { app, eventStore } = reachLockedManorDiscovery();
  app.submit({
    type: "choose-action",
    actionId: "examine-housekeeper-insignia",
  });

  const evidence = assembleInterpretationEvidence({
    utterance: "I confront the cellar guardian.",
    view: app.view(),
    acceptedEvents: eventStore.readAll(),
  });
  assert.deepEqual(
    evidence.items.find(
      (item) => item.id === "fact:cellar-guardian-identity",
    ),
    {
      id: "fact:cellar-guardian-identity",
      sourceKind: "established-fact",
      sourceReference: "world-knowledge:cellar-guardian-identity",
      content: "The manor's housekeeper is the cellar guardian in disguise.",
      inclusionReason:
        "This Player-visible World Knowledge Entry describes the current situation.",
    },
  );

  const reopened = createStructuredPlayApplication({ eventStore });
  const reopenedKnowledge = projectWorldKnowledge({
    actorScope: "Player",
    events: eventStore.readAll(),
  });
  assert.equal(
    reopenedKnowledge.entries.some(
      (entry) => entry.id === "cellar-guardian-identity",
    ),
    true,
  );
  assert.equal(
    reopened.view().availableActions.some(
      (action) => action.id === "examine-housekeeper-insignia",
    ),
    false,
  );
});

test("a rejected Reveal commit leaves hidden knowledge unprojected and undisclosed", () => {
  const { eventStore } = reachLockedManorDiscovery();
  const rejectingStore: EventStore = {
    readAll: () => eventStore.readAll(),
    append: () => assert.fail("Reveal should use the batch boundary"),
    appendBatch: (request) => ({
      status: "rejected",
      code: "persistence-failed",
      message: "The canonical event batch could not be persisted.",
      expectedPosition: request.expectedPosition,
      actualPosition: eventStore.readAll().length,
    }),
  };
  const app = createStructuredPlayApplication({ eventStore: rejectingStore });
  const before = structuredClone(eventStore.readAll());

  const rejected = app.submit({
    type: "choose-action",
    actionId: "examine-housekeeper-insignia",
  });

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.code, "persistence-failed");
  assert.deepEqual(rejected.appendedEvents, []);
  assert.deepEqual(eventStore.readAll(), before);
  assert.equal(
    projectWorldKnowledge({
      actorScope: "Player",
      events: eventStore.readAll(),
    }).entries.some((entry) => entry.id === "cellar-guardian-identity"),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(rejected),
    /cellar-guardian-identity|housekeeper is the cellar guardian/i,
  );
});

test("unavailable, stale, duplicate, and unmatched Reveal attempts append no event", () => {
  const { app, eventStore } = beginAdventureFixture();
  for (const actionId of [
    "examine-housekeeper-insignia",
    "cellar-guardian-identity",
    "reveal-unknown-knowledge",
  ]) {
    const before = structuredClone(eventStore.readAll());
    const rejected = app.submit({ type: "choose-action", actionId });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.code, "action-unavailable");
    assert.deepEqual(rejected.appendedEvents, []);
    assert.deepEqual(eventStore.readAll(), before);
  }

  const unavailableTargets = reachLockedManorDiscovery({
    reveals: [
      {
        id: "reveal-missing-entry",
        label: "Inspect an empty clue",
        kind: "Reveal",
        worldKnowledgeId: "missing-entry",
        availableInScenes: ["discovery"],
        requiredFactIds: ["side-door-open"],
        knowledgeScope: ["Game Master", "Player Character"],
      },
      {
        id: "reveal-already-visible-entry",
        label: "Inspect a known clue",
        kind: "Reveal",
        worldKnowledgeId: "side-door-open",
        availableInScenes: ["discovery"],
        requiredFactIds: ["side-door-open"],
        knowledgeScope: ["Game Master", "Player Character"],
      },
    ],
  });
  for (const actionId of [
    "reveal-missing-entry",
    "reveal-already-visible-entry",
  ]) {
    const before = structuredClone(unavailableTargets.eventStore.readAll());
    const rejected = unavailableTargets.app.submit({
      type: "choose-action",
      actionId,
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.code, "action-unavailable");
    assert.deepEqual(rejected.appendedEvents, []);
    assert.deepEqual(unavailableTargets.eventStore.readAll(), before);
  }

  const ready = reachLockedManorDiscovery();
  const accepted = ready.app.submit({
    type: "choose-action",
    actionId: "examine-housekeeper-insignia",
  });
  assert.equal(accepted.status, "accepted");
  const afterReveal = structuredClone(ready.eventStore.readAll());

  const duplicate = ready.app.submit({
    type: "choose-action",
    actionId: "examine-housekeeper-insignia",
  });
  assert.equal(duplicate.status, "rejected");
  assert.equal(duplicate.code, "action-unavailable");
  assert.deepEqual(duplicate.appendedEvents, []);
  assert.deepEqual(ready.eventStore.readAll(), afterReveal);
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
  assert.equal(
    contradiction.message,
    "World Knowledge could not be established.",
  );
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

test("hidden knowledge is filtered before direct references and evidence budgets", () => {
  const similarVisibleFact: FreeActionDefinition = {
    id: "record-cellar-guardian-rumor",
    label: "Record a cellar guardian rumor",
    kind: "Free Action",
    establishedFact: {
      id: "cellar-guardian-identity-rumor",
      text: "A cellar guardian rumor is written in the visitor book.",
    },
    availableInScenes: ["arrival"],
    requiredFactIds: [],
  };
  const { app, eventStore } = beginWithFreeActions([similarVisibleFact]);
  app.submit({ type: "choose-action", actionId: similarVisibleFact.id });
  const events = eventStore.readAll();
  const playerEvents = events.filter(
    (event) => event.type !== "WorldKnowledgeEstablished",
  );

  for (const maxItems of [1, 2, 64]) {
    const input = {
      utterance: "world-knowledge:cellar-guardian-identity",
      view: app.view(),
      maxItems,
    };
    const withHiddenHistory = assembleInterpretationEvidence({
      ...input,
      acceptedEvents: events,
    });
    const withoutHiddenHistory = assembleInterpretationEvidence({
      ...input,
      acceptedEvents: playerEvents,
    });

    assert.deepEqual(withHiddenHistory, withoutHiddenHistory);
    assert.equal(
      withHiddenHistory.items.some(
        (item) =>
          item.id === "fact:cellar-guardian-identity" ||
          item.sourceReference ===
            "world-knowledge:cellar-guardian-identity" ||
          item.content.includes(
            "The manor's housekeeper is the cellar guardian in disguise.",
          ),
      ),
      false,
    );
  }

  const tightEvidence = assembleInterpretationEvidence({
    utterance: "world-knowledge:cellar-guardian-identity",
    view: app.view(),
    acceptedEvents: events,
    maxItems: 2,
  });
  assert.equal(
    tightEvidence.items.some(
      (item) => item.id === "fact:cellar-guardian-identity-rumor",
    ),
    false,
  );
});

test("Player application surfaces and safe failures exclude authored hidden knowledge", () => {
  const eventStore = createInMemoryTimelineStore({ seed: 56 });
  const app = createStructuredPlayApplication({ timelineStore: eventStore });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  const begun = app.submit({ type: "begin-adventure" });
  assert.equal(begun.status, "accepted");
  assert.deepEqual(
    begun.appendedEvents.map((event) => event.type),
    ["SceneStarted"],
  );
  assert.deepEqual(app.view().timeline?.acceptedEvents, [
    { position: 1, type: "PlayerCharacterConfigured" },
    { position: 2, type: "SceneStarted" },
  ]);
  assert.equal(app.view().timeline?.activeTimeline.eventCount, 2);

  const before = structuredClone(eventStore.readAll());
  const unavailable = app.submit({
    type: "choose-action",
    actionId: "cellar-guardian-identity",
  });
  const playerSurface = JSON.stringify({
    view: app.view(),
    begun,
    unavailable,
  });

  assert.equal(unavailable.status, "rejected");
  assert.equal(unavailable.code, "action-unavailable");
  assert.equal(
    unavailable.message,
    "That action is not available in the current Scene.",
  );
  assert.deepEqual(unavailable.appendedEvents, []);
  assert.deepEqual(eventStore.readAll(), before);
  assert.doesNotMatch(
    playerSurface,
    /cellar-guardian-identity|housekeeper is the cellar guardian|locked-manor:cellar-guardian/i,
  );
});

test("knowledge collisions with a hidden ID fail without disclosing or appending it", () => {
  for (const establishedFact of [
    {
      id: "cellar-guardian-identity",
      text: "The manor's housekeeper is the cellar guardian in disguise.",
    },
    {
      id: "cellar-guardian-identity",
      text: "The cellar guardian is someone else.",
    },
  ]) {
    const action: FreeActionDefinition = {
      id: "record-guardian-identity",
      label: "Record the guardian's identity",
      kind: "Free Action",
      establishedFact,
      availableInScenes: ["arrival"],
      requiredFactIds: [],
    };
    const { app, eventStore } = beginWithFreeActions([action]);
    const before = structuredClone(eventStore.readAll());

    const rejected = app.submit({ type: "choose-action", actionId: action.id });

    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.code, "invalid-world-knowledge");
    assert.equal(rejected.message, "World Knowledge could not be established.");
    assert.deepEqual(rejected.appendedEvents, []);
    assert.deepEqual(eventStore.readAll(), before);
    assert.doesNotMatch(
      JSON.stringify(rejected),
      /cellar-guardian-identity|housekeeper is the cellar guardian|someone else/i,
    );
  }
});

test("invalid authored knowledge metadata appends no event", () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    authoredWorldKnowledge: [
      {
        fact: { id: "invalid-secret", text: "Invalid secret text." },
        provenance: {
          originKind: "authored-content",
          sourceReference: "",
        },
        visibility: "private" as never,
        knowledgeScope: [],
      },
    ],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  const before = structuredClone(eventStore.readAll());

  const rejected = app.submit({ type: "begin-adventure" });

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.code, "invalid-world-knowledge");
  assert.equal(rejected.message, "World Knowledge could not be established.");
  assert.deepEqual(rejected.appendedEvents, []);
  assert.deepEqual(eventStore.readAll(), before);
  assert.doesNotMatch(JSON.stringify(rejected), /invalid-secret|Invalid secret/);
});

test("rules and Narration evidence exclude hidden history before budgeting", () => {
  const { app, eventStore } = beginAdventureFixture({
    traits: { Might: 2, Wits: 1, Presence: 0 },
    randomSource: createSeededRandomSource(690),
  });
  const proposed = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  const rolled = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  assert.ok(rolled.state.pendingChoice);
  const resolved = app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: rolled.state.pendingChoice.id,
    choice: "decline",
  });
  assert.equal(resolved.status, "accepted");
  assert.ok(resolved.state.lastCheckResolution);

  const events = eventStore.readAll();
  const hiddenEvent = events.find(
    (event) => event.type === "WorldKnowledgeEstablished",
  );
  assert.ok(hiddenEvent);
  const playerEvents = events.filter((event) => event !== hiddenEvent);
  for (const maxItems of [1, 2, 64]) {
    const rulesInput = {
      utterance: "Explain world-knowledge:cellar-guardian-identity",
      view: app.view(),
      maxItems,
    };
    assert.deepEqual(
      assembleRulesExplanationEvidence({
        ...rulesInput,
        acceptedEvents: events,
      }),
      assembleRulesExplanationEvidence({
        ...rulesInput,
        acceptedEvents: playerEvents,
      }),
    );

    const narrationInput: Omit<NarrationEvidenceInput, "committedEvents"> = {
      acceptedEvents: events,
      resolutionTrace: resolved.state.lastCheckResolution.trace,
      playerCharacter: resolved.state.playerCharacter,
      activeScene: resolved.state.activeScene,
      maxItems,
    };
    assert.deepEqual(
      assembleNarrationEvidence({
        ...narrationInput,
        committedEvents: [hiddenEvent, ...resolved.appendedEvents],
      }),
      assembleNarrationEvidence({
        ...narrationInput,
        committedEvents: resolved.appendedEvents,
      }),
    );
  }
});
