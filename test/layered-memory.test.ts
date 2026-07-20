import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryConversationStore,
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type BatchEventStore,
} from "../src/structured-play.js";
import { createInMemoryAdventureRepository } from "../src/adventure-repository.js";
import { assembleInterpretationEvidence } from "../src/evidence-bundle.js";
import { runNaturalLanguagePlay } from "../src/natural-language-play.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import {
  enterConfrontation,
  resolveAction,
  scriptedRandomSource,
} from "./support/confrontation-fixture.js";
import { scriptedIO } from "./support/scripted-io.js";

test("ending a Confrontation preserves Adventure consequences and tears down shorter-lived memory", () => {
  const conversationStore = createInMemoryConversationStore();
  const app = createStructuredPlayApplication({
    conversationStore,
    randomSource: scriptedRandomSource([6, 6, 1, 1, 1, 1]),
  });
  enterConfrontation(app);
  conversationStore.append({
    id: "conversation-1",
    classification: "table-chat",
    content: "Maybe the guardian is only pretending.",
  });

  resolveAction(app, "drive-back-cult-guardian");
  const defeat = resolveAction(app, "drive-back-cult-guardian");

  assert.equal(defeat.state.activeScene, "consequence");
  assert.equal(defeat.memory.confrontation.state, null);
  assert.deepEqual(defeat.memory.conversation.records, []);
  assert.equal(defeat.state.playerCharacter?.health, 1);
  assert.deepEqual(defeat.state.conditions, ["Restrained"]);
  assert.equal(
    defeat.memory.adventure.establishedFacts.some(
      (fact) => fact.id === "mara-captured-by-guardian",
    ),
    true,
  );
  assert.equal(
    app.worldKnowledge("Player").entries.some(
      (entry) => entry.id === "mara-captured-by-guardian",
    ),
    true,
  );
  assert.deepEqual(defeat.memory.ownership, {
    canonicalEvents: "event-store",
    adventure: "event-derived-projection",
    confrontation: "event-derived-projection",
    worldKnowledge: "canonical-event-projection",
    conversation: "conversation-store",
    integrations: "adapters",
  });
});

for (const failure of [
  {
    name: "an interrupted teardown",
    code: "persistence-failed" as const,
    message: "The teardown write was interrupted.",
  },
  {
    name: "an invalid teardown batch",
    code: "invalid-batch" as const,
    message: "The teardown batch was invalid.",
  },
]) {
  test(`${failure.name} commits neither Adventure effects nor memory cleanup`, () => {
    const persisted = createInMemoryEventStore() as BatchEventStore;
    const interruptedStore: BatchEventStore = {
      readAll: () => persisted.readAll(),
      append: (event) => persisted.append(event),
      appendBatch: (request) =>
        request.events.some((event) => event.type === "ConfrontationEnded")
          ? {
              status: "rejected",
              code: failure.code,
              message: failure.message,
              expectedPosition: request.expectedPosition,
              actualPosition: persisted.readAll().length,
            }
          : persisted.appendBatch(request),
    };
    const conversationStore = createInMemoryConversationStore();
    const app = createStructuredPlayApplication({
      eventStore: interruptedStore,
      conversationStore,
      randomSource: scriptedRandomSource([6, 6, 1, 1, 1, 1]),
    });
    enterConfrontation(app);
    conversationStore.append({
      id: "conversation-before-interruption",
      classification: "in-character-speech",
      content: "You will not take me alive.",
    });
    resolveAction(app, "drive-back-cult-guardian");
    const chosen = app.submit({
      type: "choose-action",
      actionId: "drive-back-cult-guardian",
    });
    assert.equal(chosen.status, "accepted");
    assert.ok(chosen.state.pendingCheckProposal);
    const revealed = app.submit({
      type: "confirm-check-proposal",
      proposalId: chosen.state.pendingCheckProposal.id,
    });
    assert.equal(revealed.status, "accepted");
    assert.ok(revealed.state.pendingChoice);
    const before = app.view();

    const interrupted = app.submit({
      type: "resolve-pending-check",
      pendingChoiceId: revealed.state.pendingChoice.id,
      choice: "decline",
    });

    assert.equal(interrupted.status, "rejected");
    assert.equal(
      interrupted.code,
      failure.code === "invalid-batch" ? "invalid-write-batch" : failure.code,
    );
    assert.deepEqual(interrupted.state, before.state);
    assert.equal(interrupted.state.confrontation?.dangerClock.current, 1);
    assert.equal(interrupted.state.playerCharacter?.health, 2);
    assert.deepEqual(
      interrupted.memory.conversation.records,
      before.memory.conversation.records,
    );
    assert.equal(
      persisted.readAll().some((event) => event.type === "ConfrontationEnded"),
      false,
    );
  });
}

test("branching, reopening, and portable archives reproduce teardown consequences", () => {
  const repository = createInMemoryAdventureRepository();
  const adventure = repository.create("Layered Memory Manor");
  const app = createStructuredPlayApplication({
    timelineStore: adventure.timelineStore,
    conversationStore: adventure.conversationStore,
    freeActions: [
      {
        id: "finish-arrival",
        label: "Finish arrival",
        kind: "Free Action",
        establishedFact: {
          id: "arrival-finished",
          text: "Mara finishes surveying the manor entrance.",
        },
        availableInScenes: ["arrival"],
        requiredFactIds: [],
      },
      {
        id: "finish-discovery",
        label: "Finish discovery",
        kind: "Free Action",
        establishedFact: {
          id: "discovery-finished",
          text: "Mara finds the route to the cellar.",
        },
        availableInScenes: ["discovery"],
        requiredFactIds: [],
      },
    ],
    sceneTransitions: [
      {
        from: "arrival",
        to: "discovery",
        requiredFactIds: ["arrival-finished"],
        automatic: false,
      },
      {
        from: "discovery",
        to: "confrontation",
        requiredFactIds: ["discovery-finished"],
        automatic: false,
      },
    ],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "finish-arrival" });
  app.submit({ type: "transition-scene", scene: "discovery" });
  app.submit({ type: "choose-action", actionId: "finish-discovery" });
  const entered = app.submit({
    type: "transition-scene",
    scene: "confrontation",
  });
  assert.equal(entered.status, "accepted");
  adventure.conversationStore.append({
    id: "portable-conversation",
    classification: "table-chat",
    content: "This must not enter the archive.",
  });
  const activeConfrontation = app.view();
  const activeBranch = app.submit({
    type: "branch-timeline",
    eventPosition: activeConfrontation.timeline!.activeTimeline.eventCount,
  });
  assert.equal(activeBranch.status, "accepted");
  assert.deepEqual(activeBranch.memory.conversation.records, []);
  while (app.view().state.confrontation !== null) {
    resolveAction(app, "drive-back-cult-guardian");
  }
  const source = app.view();
  assert.equal(source.state.confrontation, null);
  const branch = app.submit({
    type: "branch-timeline",
    eventPosition: source.timeline!.activeTimeline.eventCount,
  });
  assert.equal(branch.status, "accepted");
  assert.deepEqual(branch.state, source.state);
  adventure.close();

  const reopened = repository.open(adventure.id);
  const reopenedApp = createStructuredPlayApplication({
    timelineStore: reopened.timelineStore,
  });
  const reopenedView = reopenedApp.view();
  assert.deepEqual(reopenedView.state, source.state);
  assert.deepEqual(reopenedView.memory.conversation.records, []);
  const sourceKnowledge = reopenedApp.worldKnowledge("Player");
  reopened.close();

  const importedRepository = createInMemoryAdventureRepository();
  const imported = importedRepository.importArchive(
    repository.exportArchive(adventure.id),
  );
  const importedApp = createStructuredPlayApplication({
    timelineStore: imported.timelineStore,
  });
  const importedView = importedApp.view();
  assert.deepEqual(importedView.state, source.state);
  assert.deepEqual(importedView.memory.conversation.records, []);
  assert.deepEqual(
    importedApp.worldKnowledge("Player"),
    sourceKnowledge,
  );
  imported.close();
});

test("validated conversation stays non-canonical and outside later Evidence Bundles", async () => {
  const eventStore = beginAdventureFixture().eventStore;
  const before = eventStore.readAll();
  const script = scriptedIO(["Maybe the guardian is only pretending."]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    eventStore,
    interpreter: {
      interpret: async () => ({
        status: "interpreted",
        classification: "table-chat",
        referencedEntityIds: [],
      }),
    },
  });

  assert.deepEqual(eventStore.readAll(), before);
  assert.deepEqual(result.memory.conversation.records, [
    {
      id: result.memory.conversation.records[0]?.id,
      classification: "table-chat",
      content: "Maybe the guardian is only pretending.",
    },
  ]);

  const evidence = assembleInterpretationEvidence({
    utterance: "What is happening?",
    view: result,
    acceptedEvents: eventStore.readAll(),
  });
  assert.equal(
    JSON.stringify(evidence).includes("only pretending"),
    false,
  );
});
