import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleActorScopedModelTaskEvidence,
  type ActorScopedEvidenceBundle,
} from "../src/actor-scoped-retrieval.js";
import {
  assembleStateProposalEvidence,
  runExpandedModelTaskSet,
} from "../src/expanded-model-tasks.js";
import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  createScriptedModelProvider,
} from "../src/model-gateway.js";
import {
  createInMemorySceneOrchestrationRecordStore,
  createSceneOrchestrator,
  type SceneNarrationOutput,
} from "../src/scene-orchestration.js";
import {
  createInMemoryEventStore,
  createInMemoryTimelineStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type CanonicalEvent,
  type CheckActionDefinition,
} from "../src/structured-play.js";
import { publishedCheckPackage } from "./support/published-check-package.js";

const OPEN_ARCHIVE: CheckActionDefinition = {
  id: "open-archive",
  label: "Open the sealed archive",
  kind: "Check",
  goal: "Open the sealed archive",
  trait: "Wits",
  availableInScenes: ["arrival"],
  stakes: {
    Setback: { summary: "The archive remains sealed.", consequences: [] },
    "Success with Cost": {
      summary: "The archive opens noisily.",
      consequences: [
        {
          type: "establish-fact",
          fact: { id: "archive-open", text: "The sealed archive is open." },
        },
      ],
    },
    "Clean Success": {
      summary: "The archive opens quietly.",
      consequences: [
        {
          type: "establish-fact",
          fact: { id: "archive-open", text: "The sealed archive is open." },
        },
      ],
    },
  },
};

const PLAYER_ACTOR = DEFAULT_PLAYER_ACTOR_SCOPE;

const retrievedEvidenceFor = (
  utterance: string,
  approvedRules = [publishedCheckPackage()],
): ActorScopedEvidenceBundle => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    checkActions: [OPEN_ARCHIVE],
    oracleActions: [],
    freeActions: [],
    adventureEndings: [],
    sceneTransitions: [],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  return assembleActorScopedModelTaskEvidence({
    scope: {
      actorScope: PLAYER_ACTOR,
      playerCharacterId: PLAYER_ACTOR.playerCharacterId,
      campaignId: "campaign:locked-manor",
      taskType: "classify-discourse",
      rulesetVersion: "1.0.0",
    },
    corpus: {
      campaignId: "campaign:locked-manor",
      entities: [],
      acceptedEvents: eventStore.readAll(),
      approvedRules,
    },
    utterance,
    view: app.view(),
  });
};

const evidenceBundle = retrievedEvidenceFor("I open the sealed archive.");

const validatedModelInput = async () => {
  const utterance = "I open the sealed archive.";
  const intent = {
    capabilityId: "open-archive",
    referencedEntityIds: ["scene:arrival"],
    evidenceItemIds: ["entity:scene:arrival", "capability:open-archive"],
  } as const;
  const intentEvidenceItemId = assembleStateProposalEvidence(
    evidenceBundle,
    intent,
  ).items.at(-1)!.id;
  const gateway = createModelGateway({
    provider: createScriptedModelProvider({
      model: "scene-orchestration-v1",
      responses: {
        [`classify-discourse:${utterance}`]: {
          classification: "player-action",
        },
        [`extract-intent:${utterance}`]: intent,
        [`propose-state-change:${utterance}`]: {
          status: "proposed",
          capabilityId: "open-archive",
          referencedEntityIds: ["scene:arrival"],
          evidenceItemIds: [
            "entity:scene:arrival",
            "capability:open-archive",
            "rule:micro-ruleset.check@1.0.0",
            intentEvidenceItemId,
          ],
          intentEvidenceItemId,
          ruleEvidenceItemIds: ["rule:micro-ruleset.check@1.0.0"],
          stateEvidenceItemIds: ["entity:scene:arrival"],
          rulesetVersion: "1.0.0",
          command: { type: "choose-action", actionId: "open-archive" },
        },
      },
    }),
  });
  const modelResult = await runExpandedModelTaskSet({
    utterance,
    gateway,
    modelCallStore: createInMemoryModelCallRecordStore(),
    context: {
      evidenceBundle,
      knownEntityIds: ["scene:arrival"],
      availableCapabilityIds: ["open-archive"],
      authorizedCapabilityIds: ["open-archive"],
      rulesetVersion: "1.0.0",
      commandSatisfiesInvariants: (command) =>
        command.type === "choose-action" && command.actionId === "open-archive",
    },
  });
  return { utterance, modelResult, evidenceBundle };
};

const checkpointModelInput = async (
  kind: "ambiguous-input" | "invalid-proposal" | "rule-conflict",
) => {
  const utterance =
    kind === "rule-conflict"
      ? "How do Check and Free Action rules conflict?"
      : `checkpoint:${kind}`;
  const responses: Record<string, unknown> =
    kind === "ambiguous-input"
      ? {
          [`classify-discourse:${utterance}`]: {
            classification: "invented-class",
          },
        }
      : kind === "invalid-proposal"
        ? {
            [`classify-discourse:${utterance}`]: {
              classification: "player-action",
            },
            [`extract-intent:${utterance}`]: {
              capabilityId: "invented-capability",
              referencedEntityIds: ["scene:hidden"],
              evidenceItemIds: ["capability:invented-capability"],
            },
          }
        : {
            [`classify-discourse:${utterance}`]: {
              classification: "rules-query",
            },
            [`suggest-rule-match:${utterance}`]: {
              status: "needs-adjudication",
              candidateRuleIds: [
                "rule:checks@1.0.0",
                "rule:free-actions@1.0.0",
              ],
            },
          };
  const scopedBundle = retrievedEvidenceFor(utterance);
  const modelResult = await runExpandedModelTaskSet({
    utterance,
    gateway: createModelGateway({
      provider: createScriptedModelProvider({
        model: `checkpoint-${kind}`,
        responses,
      }),
    }),
    modelCallStore: createInMemoryModelCallRecordStore(),
    context: {
      evidenceBundle: scopedBundle,
      knownEntityIds: ["scene:arrival"],
      availableCapabilityIds: ["open-archive"],
      authorizedCapabilityIds: ["open-archive"],
      rulesetVersion: "1.0.0",
      commandSatisfiesInvariants: () => true,
    },
  });
  return { utterance, modelResult, evidenceBundle: scopedBundle };
};

test("classified input drives a canonical Scene through every replayable lifecycle state before Narration", async () => {
  const modelInput = await validatedModelInput();
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(690),
    checkActions: [OPEN_ARCHIVE],
    oracleActions: [],
    freeActions: [],
    adventureEndings: [],
    sceneTransitions: [
      {
        from: "arrival",
        to: "discovery",
        requiredFactIds: ["archive-open"],
        automatic: true,
      },
    ],
  });
  const narrationCalls: number[] = [];
  const orchestrator = createSceneOrchestrator({
    scene: "arrival",
    application: app,
    eventStore,
    narrate: async (request): Promise<SceneNarrationOutput> => {
      narrationCalls.push(request.committedEvents.length);
      return {
        text: request.deterministicSummary,
        entityIds: [PLAYER_ACTOR.playerCharacterId],
        locationIds: ["scene:arrival"],
        resourceClaims: [{ resource: "Health", value: 3 }],
        ruleIds: ["rule:micro-ruleset.check@1.0.0"],
        outcomeEventIds: [request.committedEvents[0]!.id],
      };
    },
  });

  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  assert.equal(orchestrator.view().lifecycle.status, "proposed");

  await orchestrator.submit({
    idempotencyKey: "activate-arrival",
    actor: PLAYER_ACTOR,
    command: { type: "begin-adventure" },
  });
  assert.equal(orchestrator.view().lifecycle.status, "active");

  const proposed = await orchestrator.submitClassifiedInput({
    idempotencyKey: "open-archive",
    actor: PLAYER_ACTOR,
    modelInput,
  });
  assert.equal(proposed.status, "accepted");
  assert.equal(proposed.lifecycle.status, "resolving");
  assert.equal(narrationCalls.length, 0);

  const proposalId = app.view().state.pendingCheckProposal!.id;
  await orchestrator.submit({
    idempotencyKey: "confirm-open-archive",
    actor: PLAYER_ACTOR,
    command: { type: "confirm-check-proposal", proposalId },
  });
  assert.equal(orchestrator.view().lifecycle.status, "paused");
  assert.equal(narrationCalls.length, 0);

  const pendingChoiceId = app.view().state.pendingChoice!.id;
  const resolved = await orchestrator.submit({
    idempotencyKey: "resolve-open-archive",
    actor: PLAYER_ACTOR,
    command: {
      type: "resolve-pending-check",
      pendingChoiceId,
      choice: "decline",
    },
    presentation: modelInput,
  });

  assert.equal(resolved.status, "accepted");
  assert.equal(resolved.lifecycle.status, "ended");
  assert.deepEqual(resolved.lifecycle.exit, {
    kind: "Scene",
    destination: "discovery",
    eventId: resolved.committedEvents[1]!.id,
  });
  assert.equal(resolved.presentation?.source, "model");
  assert.equal(narrationCalls.length, 1);

  const replayed = createSceneOrchestrator({
    scene: "arrival",
    application: createStructuredPlayApplication({ eventStore }),
    eventStore,
    narrate: async () => {
      throw new Error("Replay must not regenerate Narration.");
    },
  });
  assert.deepEqual(replayed.view().lifecycle, resolved.lifecycle);
});

test("Game Master approval, edit, rejection, and override are authorized commands with audit records", async (t) => {
  const prepare = () => {
    const eventStore = createInMemoryEventStore();
    const app = createStructuredPlayApplication({
      eventStore,
      checkActions: [OPEN_ARCHIVE],
      oracleActions: [],
      freeActions: [
        {
          id: "wait-at-door",
          label: "Wait at the archive door",
          kind: "Free Action",
          establishedFact: {
            id: "waited-at-door",
            text: "Mara waits at the archive door.",
          },
          availableInScenes: ["arrival"],
          requiredFactIds: [],
        },
      ],
      adventureEndings: [],
      sceneTransitions: [],
    });
    app.submit({
      type: "configure-player-character",
      name: "Mara Vey",
      pronouns: "she/her",
      motivation: "Find her missing sister",
      traits: { Might: 0, Wits: 2, Presence: 1 },
    });
    app.submit({ type: "begin-adventure" });
    const recordStore = createInMemorySceneOrchestrationRecordStore();
    const orchestrator = createSceneOrchestrator({
      scene: "arrival",
      application: app,
      eventStore,
      recordStore,
      narrate: async () => null,
    });
    return { app, eventStore, orchestrator, recordStore };
  };

  await t.test("approval executes the exact candidate once", async () => {
    const { app, eventStore, orchestrator, recordStore } = prepare();
    const modelInput = await validatedModelInput();
    const pending = await orchestrator.submitClassifiedInput({
      idempotencyKey: "proposal-approve",
      actor: PLAYER_ACTOR,
      modelInput,
      requireGameMasterApproval: true,
    });
    assert.equal(pending.status, "approval-required");

    const unauthorized = await orchestrator.review({
      idempotencyKey: "review-unauthorized",
      actor: PLAYER_ACTOR,
      proposalId: pending.proposal.id,
      decision: "approve",
    });
    assert.equal(unauthorized.status, "rejected");
    assert.equal(unauthorized.code, "ACTOR_NOT_AUTHORIZED");
    assert.equal(eventStore.readAll().some((event) => event.type === "CheckProposalCreated"), false);

    const approved = await orchestrator.review({
      idempotencyKey: "review-approve",
      actor: { kind: "Game Master" },
      proposalId: pending.proposal.id,
      decision: "approve",
    });
    assert.equal(approved.status, "accepted");
    assert.equal(app.view().state.pendingCheckProposal?.actionId, "open-archive");
    assert.deepEqual(recordStore.decisions(), [
      {
        idempotencyKey: "review-approve",
        actor: { kind: "Game Master" },
        proposalId: pending.proposal.id,
        decision: "approve",
        candidateCommand: modelInput.modelResult.candidateCommand,
        submittedCommand: modelInput.modelResult.candidateCommand,
        outcome: "accepted",
        eventIds: [approved.committedEvents[0]!.id],
      },
    ]);

    const replay = await orchestrator.review({
      idempotencyKey: "review-approve",
      actor: { kind: "Game Master" },
      proposalId: pending.proposal.id,
      decision: "approve",
    });
    assert.deepEqual(replay, approved);
    assert.equal(eventStore.readAll().filter((event) => event.type === "CheckProposalCreated").length, 1);
  });

  await t.test("edit, rejection, and override are distinct validated decisions", async () => {
    for (const decision of ["edit", "reject", "override"] as const) {
      const { app, eventStore, orchestrator, recordStore } = prepare();
      const modelInput = await validatedModelInput();
      const pending = await orchestrator.submitClassifiedInput({
        idempotencyKey: `proposal-${decision}`,
        actor: PLAYER_ACTOR,
        modelInput,
        requireGameMasterApproval: true,
      });
      assert.equal(pending.status, "approval-required");
      const before = eventStore.readAll().length;
      const reviewed = await orchestrator.review({
        idempotencyKey: `review-${decision}`,
        actor: { kind: "Game Master" },
        proposalId: pending.proposal.id,
        decision,
        ...(decision === "reject"
          ? {}
          : {
              command: {
                type: "choose-action" as const,
                actionId: "wait-at-door",
              },
            }),
      });
      if (decision === "reject") {
        assert.equal(reviewed.status, "rejected");
        assert.equal(reviewed.code, "GAME_MASTER_REJECTED");
        assert.equal(eventStore.readAll().length, before);
      } else {
        assert.equal(reviewed.status, "accepted");
        assert.ok(app.view().state.resolvedFreeActionIds.includes("wait-at-door"));
      }
      assert.equal(recordStore.decisions()[0]?.decision, decision);
      assert.equal(recordStore.decisions()[0]?.outcome, reviewed.status);
    }
  });
});

test("ambiguous input, invalid proposals, and rule conflicts automatically create Game Master checkpoints", async () => {
  const { app, eventStore } = (() => {
    const eventStore = createInMemoryEventStore();
    const app = createStructuredPlayApplication({
      eventStore,
      checkActions: [OPEN_ARCHIVE],
      oracleActions: [],
      freeActions: [],
      adventureEndings: [],
      sceneTransitions: [],
    });
    app.submit({
      type: "configure-player-character",
      name: "Mara Vey",
      pronouns: "she/her",
      motivation: "Find her missing sister",
      traits: { Might: 0, Wits: 2, Presence: 1 },
    });
    app.submit({ type: "begin-adventure" });
    return { app, eventStore };
  })();
  const orchestrator = createSceneOrchestrator({
    scene: "arrival",
    application: app,
    eventStore,
    narrate: async () => null,
  });
  const eventCount = eventStore.readAll().length;

  for (const reason of [
    "ambiguous-input",
    "invalid-proposal",
    "rule-conflict",
  ] as const) {
    const result = await orchestrator.submitClassifiedInput({
      idempotencyKey: `checkpoint-${reason}`,
      actor: PLAYER_ACTOR,
      modelInput: await checkpointModelInput(reason),
    });
    assert.equal(result.status, "approval-required");
    assert.equal(result.proposal.checkpointReason, reason);
    assert.equal(eventStore.readAll().length, eventCount);
  }
});

test("classified input binds evidence and idempotency to the scoped Player", async () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    checkActions: [OPEN_ARCHIVE],
    oracleActions: [],
    freeActions: [],
    adventureEndings: [],
    sceneTransitions: [],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const orchestrator = createSceneOrchestrator({
    scene: "arrival",
    application: app,
    eventStore,
    narrate: async () => null,
  });
  const modelInput = await validatedModelInput();
  const fabricatedInput = {
    ...modelInput,
    modelResult: structuredClone(modelInput.modelResult),
  };
  const fabricated = await orchestrator.submitClassifiedInput({
    idempotencyKey: "bound-input",
    actor: PLAYER_ACTOR,
    modelInput: fabricatedInput,
  });
  assert.equal(fabricated.status, "rejected");
  assert.equal(fabricated.code, "INVALID_CLASSIFIED_INPUT");

  const conflict = await orchestrator.submitClassifiedInput({
    idempotencyKey: "bound-input",
    actor: PLAYER_ACTOR,
    modelInput: { ...modelInput, utterance: "Different input." },
  });
  assert.equal(conflict.status, "rejected");
  assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");

  const wrongPlayer = await orchestrator.submitClassifiedInput({
    idempotencyKey: "wrong-player",
    actor: { kind: "Player", playerCharacterId: "player-character:other" },
    modelInput,
  });
  assert.equal(wrongPlayer.status, "rejected");
  assert.equal(wrongPlayer.code, "ACTOR_NOT_AUTHORIZED");
  assert.equal(eventStore.readAll().some((event) => event.type === "CheckProposalCreated"), false);
});

test("invalid Narration falls back and regeneration never changes canonical events or projections", async () => {
  const modelInput = await validatedModelInput();
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(690),
    checkActions: [OPEN_ARCHIVE],
    oracleActions: [],
    freeActions: [],
    adventureEndings: [],
    sceneTransitions: [],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  let wrongOutput = true;
  const orchestrator = createSceneOrchestrator({
    scene: "arrival",
    application: app,
    eventStore,
    narrate: async (request): Promise<SceneNarrationOutput> =>
      wrongOutput
        ? {
            text: "A stranger spends Mara's Resolve in the cellar.",
            entityIds: ["non-player-character:stranger"],
            locationIds: ["scene:confrontation"],
            resourceClaims: [{ resource: "Resolve", value: 0 }],
            ruleIds: ["rule:invented@9"],
            outcomeEventIds: ["event:uncommitted"],
          }
        : {
            text: request.deterministicSummary,
            entityIds: [PLAYER_ACTOR.playerCharacterId],
            locationIds: ["scene:arrival"],
            resourceClaims: [{ resource: "Resolve", value: 3 }],
            ruleIds: ["rule:micro-ruleset.check@1.0.0"],
            outcomeEventIds: [request.committedEvents[0]!.id],
          },
  });
  await orchestrator.submitClassifiedInput({
    idempotencyKey: "action",
    actor: PLAYER_ACTOR,
    modelInput,
  });
  await orchestrator.submit({
    idempotencyKey: "confirm",
    actor: PLAYER_ACTOR,
    command: {
      type: "confirm-check-proposal",
      proposalId: app.view().state.pendingCheckProposal!.id,
    },
  });
  const resolved = await orchestrator.submit({
    idempotencyKey: "resolve",
    actor: PLAYER_ACTOR,
    command: {
      type: "resolve-pending-check",
      pendingChoiceId: app.view().state.pendingChoice!.id,
      choice: "decline",
    },
    presentation: modelInput,
  });
  assert.equal(resolved.status, "accepted");
  assert.equal(resolved.presentation?.source, "deterministic-fallback");
  const outcomeEventId = resolved.committedEvents[0]!.id;
  const canonicalBefore = JSON.stringify(eventStore.readAll());
  const projectionBefore = JSON.stringify(app.view());

  wrongOutput = false;
  const regenerated = await orchestrator.regeneratePresentation({
    idempotencyKey: "regenerate-1",
    actor: PLAYER_ACTOR,
    outcomeEventId,
  });
  assert.equal(regenerated.status, "accepted");
  assert.equal(regenerated.presentation?.source, "model");
  assert.equal(JSON.stringify(eventStore.readAll()), canonicalBefore);
  assert.equal(JSON.stringify(app.view()), projectionBefore);

  const regeneratedAgain = await orchestrator.regeneratePresentation({
    idempotencyKey: "regenerate-2",
    actor: PLAYER_ACTOR,
    outcomeEventId,
  });
  assert.equal(regeneratedAgain.status, "accepted");
  assert.equal(JSON.stringify(eventStore.readAll()), canonicalBefore);
  assert.equal(JSON.stringify(app.view()), projectionBefore);

  const conflict = await orchestrator.submit({
    idempotencyKey: "confirm",
    actor: PLAYER_ACTOR,
    command: { type: "begin-adventure" },
  });
  assert.equal(conflict.status, "rejected");
  assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");
});

test("Timeline branching replays the same paused lifecycle and preserves the committed exit on the original branch", async () => {
  const modelInput = await validatedModelInput();
  const timelineStore = createInMemoryTimelineStore({ seed: 690 });
  const app = createStructuredPlayApplication({
    timelineStore,
    checkActions: [OPEN_ARCHIVE],
    oracleActions: [],
    freeActions: [],
    adventureEndings: [],
    sceneTransitions: [
      {
        from: "arrival",
        to: "discovery",
        requiredFactIds: ["archive-open"],
        automatic: true,
      },
    ],
  });
  const orchestrator = createSceneOrchestrator({
    scene: "arrival",
    application: app,
    eventStore: timelineStore,
    narrate: async () => null,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  await orchestrator.submitClassifiedInput({
    idempotencyKey: "branch-action",
    actor: PLAYER_ACTOR,
    modelInput,
  });
  await orchestrator.submit({
    idempotencyKey: "branch-confirm",
    actor: PLAYER_ACTOR,
    command: {
      type: "confirm-check-proposal",
      proposalId: app.view().state.pendingCheckProposal!.id,
    },
  });
  const branchPosition =
    app.view().timeline!.acceptedEvents.findIndex(
      (event) => event.type === "CheckRollRevealed",
    ) + 1;
  await orchestrator.submit({
    idempotencyKey: "branch-resolve",
    actor: PLAYER_ACTOR,
    command: {
      type: "resolve-pending-check",
      pendingChoiceId: app.view().state.pendingChoice!.id,
      choice: "decline",
    },
  });
  const endedLifecycle = orchestrator.view().lifecycle;
  const endedProjection = JSON.stringify(app.view().state);
  const originalTimelineId = app.view().timeline!.activeTimelineId;
  assert.equal(endedLifecycle.status, "ended");

  await orchestrator.submit({
    idempotencyKey: "branch-before-resolution",
    actor: PLAYER_ACTOR,
    command: { type: "branch-timeline", eventPosition: branchPosition },
  });
  assert.equal(orchestrator.view().lifecycle.status, "paused");
  assert.equal(orchestrator.view().lifecycle.exit, null);

  await orchestrator.submit({
    idempotencyKey: "select-ended-timeline",
    actor: PLAYER_ACTOR,
    command: { type: "select-timeline", timelineId: originalTimelineId },
  });
  assert.deepEqual(orchestrator.view().lifecycle, endedLifecycle);
  assert.equal(JSON.stringify(app.view().state), endedProjection);
});

test("revisiting a Scene projects lifecycle from its latest canonical entry", () => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    checkActions: [],
    oracleActions: [],
    freeActions: [
      {
        id: "enter-discovery",
        label: "Enter discovery",
        kind: "Free Action",
        establishedFact: { id: "entered", text: "Mara enters the manor." },
        availableInScenes: ["arrival"],
        requiredFactIds: [],
      },
    ],
    adventureEndings: [],
    sceneTransitions: [
      {
        from: "arrival",
        to: "discovery",
        requiredFactIds: ["entered"],
        automatic: true,
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
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "enter-discovery" });
  const template = eventStore
    .readAll()
    .find((event) => event.type === "SceneTransitioned")!;
  eventStore.append({
    ...template,
    id: "event:leave-discovery",
    sequence: eventStore.readAll().length + 1,
    payload: { from: "discovery", to: "confrontation" },
  } as CanonicalEvent);
  eventStore.append({
    ...template,
    id: "event:return-discovery",
    sequence: eventStore.readAll().length + 1,
    payload: { from: "confrontation", to: "discovery" },
  } as CanonicalEvent);

  const orchestrator = createSceneOrchestrator({
    scene: "discovery",
    application: createStructuredPlayApplication({ eventStore }),
    eventStore,
    narrate: async () => null,
  });
  assert.equal(orchestrator.view().lifecycle.status, "active");
  assert.equal(orchestrator.view().lifecycle.exit, null);
});
