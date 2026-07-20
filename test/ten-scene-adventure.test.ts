import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  renderAdventureMarkdown,
  reviewAdventureMarkdownEdit,
} from "../src/adventure-markdown.js";
import { createLocalAdventureRepository } from "../src/adventure-repository.js";
import { assembleActorScopedModelTaskEvidence } from "../src/actor-scoped-retrieval.js";
import {
  assembleStateProposalEvidence,
  runExpandedModelTaskSet,
} from "../src/expanded-model-tasks.js";
import {
  TEN_SCENE_ADVENTURE,
  TEN_SCENE_STRUCTURED_CHOICES,
} from "../src/ten-scene-adventure.js";
import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  createScriptedModelProvider,
} from "../src/model-gateway.js";
import { runNaturalLanguagePlay } from "../src/natural-language-play.js";
import {
  createInMemorySceneOrchestrationRecordStore,
  createSceneOrchestrator,
} from "../src/scene-orchestration.js";
import { projectSceneLifecycle } from "../src/scene-lifecycle.js";
import {
  createInMemoryEventStore,
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  type AcceptedResult,
  type CanonicalEvent,
  type StructuredPlayApplication,
  type StructuredPlayInput,
} from "../src/structured-play.js";
import { publishedCheckPackage } from "./support/published-check-package.js";
import { scriptedIO } from "./support/scripted-io.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  GAME_MASTER_ACTOR_SCOPE,
  playerWorldKnowledgeActorScope,
  projectWorldKnowledge,
} from "../src/world-knowledge.js";

const accept = (
  app: StructuredPlayApplication,
  input: Parameters<StructuredPlayApplication["submit"]>[0],
): AcceptedResult => {
  const result = app.submit(input);
  assert.equal(
    result.status,
    "accepted",
    result.status === "rejected" ? result.message : undefined,
  );
  return result as AcceptedResult;
};

const configuredJourney = () => {
  const timelineStore = createInMemoryTimelineStore({ seed: 690 });
  const app = createStructuredPlayApplication({
    ...TEN_SCENE_ADVENTURE.structuredPlayOptions,
    timelineStore,
  });
  accept(app, {
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  accept(app, { type: "begin-adventure" });
  return { app, timelineStore };
};

test("Structured Play completes the bounded ten-Scene Adventure without a model", () => {
  const { app, timelineStore } = configuredJourney();
  const visitedScenes = [app.view().state.activeScene];

  for (const choice of TEN_SCENE_STRUCTURED_CHOICES) {
    const selected = accept(app, {
      type: "choose-action",
      actionId: choice.actionId,
    });
    if (selected.state.pendingCheckProposal !== null) {
      const revealed = accept(app, {
        type: "confirm-check-proposal",
        proposalId: selected.state.pendingCheckProposal.id,
      });
      assert.ok(revealed.state.pendingChoice);
      accept(app, {
        type: "resolve-pending-check",
        pendingChoiceId: revealed.state.pendingChoice.id,
        choice: "decline",
      });
    } else if (selected.state.pendingNarratorRecommendation !== null) {
      accept(app, {
        type: "confirm-oracle-likelihood",
        recommendationId: selected.state.pendingNarratorRecommendation.id,
        likelihood: selected.state.pendingNarratorRecommendation.likelihood,
      });
    }
    const scene = app.view().state.activeScene;
    if (scene !== null && scene !== visitedScenes.at(-1)) visitedScenes.push(scene);
  }

  assert.deepEqual(visitedScenes, TEN_SCENE_ADVENTURE.scenes);
  assert.equal(app.view().state.adventureEnding?.id, "manor-truth-recovered");
  assert.equal(app.view().state.confrontation, null);
  assert.deepEqual(app.view().state.conditions, []);
  assert.deepEqual(
    timelineStore
      .readAll()
      .filter(
        (event) =>
          event.type === "SceneStarted" || event.type === "SceneTransitioned",
      )
      .map((event) =>
        event.type === "SceneStarted" ? event.payload.scene : event.payload.to,
      ),
    TEN_SCENE_ADVENTURE.scenes,
  );
});

const modelUtterance = (actionId: string): string => `journey:${actionId}`;
const AMBIGUOUS_UTTERANCE = "I deal with the entrance somehow.";
const RULES_UTTERANCE = "Which approved Check rule governed that roll?";

const modelResponses = Object.fromEntries([
  [
    `interpret-player-input:${AMBIGUOUS_UTTERANCE}`,
    {
      status: "ambiguous",
      candidateCapabilityIds: ["read-arrival-marker", "survey-manor"],
    },
  ],
  [
    `interpret-player-input:${RULES_UTTERANCE}`,
    {
      status: "interpreted",
      classification: "rules-query",
      referencedEntityIds: ["scene:gallery"],
    },
  ],
  [
    `explain-rules:${RULES_UTTERANCE}`,
    {
      segments: [
        {
          text: "An invented rule governs the roll.",
          evidenceItemIds: ["rule:invented@1.0.0"],
        },
      ],
    },
  ],
  ...TEN_SCENE_STRUCTURED_CHOICES.map(({ scene, actionId }) => [
    `interpret-player-input:${modelUtterance(actionId)}`,
    {
      status: "interpreted",
      classification: "player-action",
      capabilityId: actionId,
      referencedEntityIds: [`scene:${scene}`],
      evidenceItemIds: [`entity:scene:${scene}`, `capability:${actionId}`],
      arguments: {},
    },
  ]),
  ...["Setback", "Success with Cost", "Clean Success"].map((outcome) => [
    `narrate-committed-outcome:micro-ruleset.check@1.0.0:${outcome}`,
    {
      segments: [
        {
          text: "The model invents an uncommitted treasure reward.",
          evidenceItemIds: ["event:committed:0"],
        },
      ],
    },
  ]),
  ...["Yes", "No"].map((answer) => [
    `narrate-committed-outcome:micro-ruleset.oracle@1.0.0:${answer}`,
    {
      segments: [
        {
          text: "The model invents an uncommitted passage outcome.",
          evidenceItemIds: ["event:committed:0"],
        },
      ],
    },
  ]),
]);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const stable = (value: unknown): unknown => {
  if (typeof value === "string") return uuid.test(value) ? "<generated-id>" : value;
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, stable(item)]),
  );
};

const replayedLifecycleTrace = (
  events: readonly CanonicalEvent[],
  applicationOptions: typeof TEN_SCENE_ADVENTURE.structuredPlayOptions & {
    readonly checkRulesetPackage: ReturnType<typeof publishedCheckPackage>;
  },
): unknown => {
  const prefixes = events.map((_, index) => events.slice(0, index + 1));
  return stable(
    prefixes.map((prefix, eventIndex) => {
      const eventStore = createInMemoryEventStore();
      prefix.forEach((event) => eventStore.append(event));
      const application = createStructuredPlayApplication({
        ...applicationOptions,
        eventStore,
      });
      return {
        eventIndex,
        eventType: prefix.at(-1)!.type,
        scenes: TEN_SCENE_ADVENTURE.scenes.map((scene) =>
          projectSceneLifecycle({
            scene,
            events: prefix,
            application: application.view(),
          }),
        ),
      };
    }),
  );
};

const resolutionCommandsFrom = (
  events: readonly CanonicalEvent[],
): readonly StructuredPlayInput[] =>
  events.flatMap((event): readonly StructuredPlayInput[] => {
    if (event.type === "CheckRollRevealed") {
      return [
        {
          type: "confirm-check-proposal",
          proposalId: event.payload.pendingChoice.proposal.id,
        },
      ];
    }
    if (event.type === "CheckResolved") {
      return [
        {
          type: "resolve-pending-check",
          pendingChoiceId: event.payload.pendingChoiceId,
          choice:
            event.payload.resolveSpent === 1 ? "spend-resolve" : "decline",
        },
      ];
    }
    if (event.type === "OracleAnswered") {
      return [
        {
          type: "confirm-oracle-likelihood",
          recommendationId: event.payload.recommendationId,
          likelihood: event.payload.trace.confirmedLikelihood,
        },
      ];
    }
    return [];
  });

const completeJourney = async (mode: "structured" | "model-assisted") => {
  const timelineStore = createInMemoryTimelineStore({ seed: 690 });
  const checkRulesetPackage = publishedCheckPackage();
  const applicationOptions = {
    ...TEN_SCENE_ADVENTURE.structuredPlayOptions,
    checkRulesetPackage,
  };
  let app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore,
  });
  const commands: StructuredPlayInput[] = [];
  const submit = (input: StructuredPlayInput): AcceptedResult => {
    commands.push(input);
    return accept(app, input);
  };
  submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  submit({ type: "begin-adventure" });

  const modelCallStore = createInMemoryModelCallRecordStore();
  const modelGateway = createModelGateway({
    provider: createScriptedModelProvider({
      model: "ten-scene-journey-v1",
      responses: modelResponses,
    }),
  });

  if (mode === "model-assisted") {
    const before = timelineStore.readAll();
    const ambiguous = scriptedIO([AMBIGUOUS_UTTERANCE]);
    const result = await runNaturalLanguagePlay({
      io: ambiguous.io,
      modelGateway,
      modelCallStore,
      timelineStore,
      applicationOptions,
    });
    assert.deepEqual(result.interpretedCommands, []);
    assert.match(ambiguous.output.join(""), /Clarification needed/);
    assert.deepEqual(timelineStore.readAll(), before);
  }

  for (const choice of TEN_SCENE_STRUCTURED_CHOICES) {
    if (mode === "structured") {
      submit({ type: "choose-action", actionId: choice.actionId });
    } else {
      const scripted = [modelUtterance(choice.actionId)];
      if (
        choice.actionId === "open-vestibule-door" ||
        choice.actionId === "overcome-manor-guardian"
      ) {
        scripted.push("c", "d");
      } else if (choice.actionId === "ask-passage-behind-shelves") {
        scripted.push("l");
      }
      const eventPosition = timelineStore.readAll().length;
      const interpreted = await runNaturalLanguagePlay({
        io: scriptedIO(scripted).io,
        modelGateway,
        modelCallStore,
        timelineStore,
        applicationOptions,
      });
      assert.deepEqual(interpreted.interpretedCommands, [
        { type: "choose-action", actionId: choice.actionId },
      ]);
      commands.push(...interpreted.interpretedCommands);
      commands.push(
        ...resolutionCommandsFrom(
          timelineStore.readAll().slice(eventPosition),
        ),
      );
      app = createStructuredPlayApplication({
        ...applicationOptions,
        timelineStore,
      });
      if (choice.actionId === "open-vestibule-door") {
        const before = timelineStore.readAll();
        const query = scriptedIO([RULES_UTTERANCE]);
        const rules = await runNaturalLanguagePlay({
          io: query.io,
          modelGateway,
          modelCallStore,
          timelineStore,
          applicationOptions,
        });
        assert.deepEqual(rules.interpretedCommands, []);
        assert.match(query.output.join(""), /deterministic fallback/);
        assert.deepEqual(timelineStore.readAll(), before);
      }
      continue;
    }

    const view = app.view().state;
    if (view.pendingCheckProposal !== null) {
      const revealed = submit({
        type: "confirm-check-proposal",
        proposalId: view.pendingCheckProposal.id,
      });
      assert.ok(revealed.state.pendingChoice);
      submit({
        type: "resolve-pending-check",
        pendingChoiceId: revealed.state.pendingChoice.id,
        choice: "decline",
      });
    } else if (view.pendingNarratorRecommendation !== null) {
      submit({
        type: "confirm-oracle-likelihood",
        recommendationId: view.pendingNarratorRecommendation.id,
        likelihood: view.pendingNarratorRecommendation.likelihood,
      });
    }
  }

  const acceptedEvents = timelineStore.readAll();
  return {
    commands: stable(commands),
    events: stable(
      acceptedEvents.map((event) => ({
        type: event.type,
        payload: event.payload,
      })),
    ) as readonly unknown[],
    state: stable(app.view().state),
    lifecycle: replayedLifecycleTrace(acceptedEvents, applicationOptions),
    modelCallRecords: modelCallStore.readAll(),
  };
};

test("model-assisted and Structured Play choices produce equivalent canonical journeys", async () => {
  const structured = await completeJourney("structured");
  const assisted = await completeJourney("model-assisted");

  assert.deepEqual(assisted.commands, structured.commands);
  assert.deepEqual(assisted.events, structured.events);
  assert.deepEqual(assisted.state, structured.state);
  assert.deepEqual(assisted.lifecycle, structured.lifecycle);
  assert.match(JSON.stringify(assisted.lifecycle), /"status":"resolving"/);
  assert.match(JSON.stringify(assisted.lifecycle), /"status":"paused"/);
  assert.match(JSON.stringify(assisted.lifecycle), /"status":"ended"/);
  assert.ok(
    assisted.modelCallRecords.some(
      (record) => record.fallbackOutcome === "deterministic-narration",
    ),
  );
  assert.ok(
    assisted.modelCallRecords.some(
      (record) => record.fallbackOutcome === "deterministic-rules",
    ),
  );
  assert.ok(
    assisted.modelCallRecords
      .filter((record) => record.taskType === "narrate-committed-outcome")
      .every((record) => record.validation.status === "rejected"),
  );
  assert.match(JSON.stringify(assisted.events), /packageChecksum/);
  assert.match(JSON.stringify(assisted.events), /checks\.procedure/);
});

test("classified Model Tasks cross a Game Master checkpoint before the journey Check commits", async () => {
  const timelineStore = createInMemoryTimelineStore({ seed: 690 });
  const checkRulesetPackage = publishedCheckPackage();
  const rulesetVersion = checkRulesetPackage.manifest.version;
  const applicationOptions = {
    ...TEN_SCENE_ADVENTURE.structuredPlayOptions,
    checkRulesetPackage,
  };
  const app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore,
  });
  accept(app, {
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  accept(app, { type: "begin-adventure" });
  for (const actionId of [
    "read-arrival-marker",
    "raise-gatehouse-latch",
    "cross-courtyard",
  ]) {
    submitJourneyAction(app, actionId);
  }

  const utterance = "I use Wits to open the sealed vestibule door with a Check.";
  const evidenceBundle = assembleActorScopedModelTaskEvidence({
    scope: {
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
      campaignId: TEN_SCENE_ADVENTURE.id,
      taskType: "classify-discourse",
      rulesetVersion,
    },
    corpus: {
      campaignId: TEN_SCENE_ADVENTURE.id,
      entities: [],
      acceptedEvents: timelineStore.readAll(),
      approvedRules: [checkRulesetPackage],
    },
    utterance,
    view: app.view(),
  });
  const intent = {
    capabilityId: "open-vestibule-door",
    referencedEntityIds: ["scene:vestibule"],
    evidenceItemIds: [
      "entity:scene:vestibule",
      "capability:open-vestibule-door",
    ],
  } as const;
  const intentEvidenceItemId = assembleStateProposalEvidence(
    evidenceBundle,
    intent,
  ).items.at(-1)!.id;
  const modelCallStore = createInMemoryModelCallRecordStore();
  const modelResult = await runExpandedModelTaskSet({
    utterance,
    gateway: createModelGateway({
      provider: createScriptedModelProvider({
        model: "ten-scene-expanded-v1",
        responses: {
          [`classify-discourse:${utterance}`]: {
            classification: "player-action",
          },
          [`extract-intent:${utterance}`]: intent,
          [`propose-state-change:${utterance}`]: {
            status: "proposed",
            capabilityId: "open-vestibule-door",
            referencedEntityIds: ["scene:vestibule"],
            evidenceItemIds: [
              "entity:scene:vestibule",
              "capability:open-vestibule-door",
              `rule:micro-ruleset.check@${rulesetVersion}`,
              intentEvidenceItemId,
            ],
            intentEvidenceItemId,
            ruleEvidenceItemIds: [
              `rule:micro-ruleset.check@${rulesetVersion}`,
            ],
            stateEvidenceItemIds: ["entity:scene:vestibule"],
            rulesetVersion,
            command: {
              type: "choose-action",
              actionId: "open-vestibule-door",
            },
          },
        },
      }),
    }),
    modelCallStore,
    context: {
      evidenceBundle,
      knownEntityIds: ["scene:vestibule"],
      availableCapabilityIds: ["open-vestibule-door"],
      authorizedCapabilityIds: ["open-vestibule-door"],
      rulesetVersion,
      commandSatisfiesInvariants: (command) =>
        command.type === "choose-action" &&
        command.actionId === "open-vestibule-door",
    },
  });
  const recordStore = createInMemorySceneOrchestrationRecordStore();
  const orchestrator = createSceneOrchestrator({
    scene: "vestibule",
    application: app,
    eventStore: timelineStore,
    recordStore,
    narrate: async () => ({ text: "An uncommitted reward appears." }),
  });
  const modelInput = { utterance, modelResult, evidenceBundle };
  const checkpoint = await orchestrator.submitClassifiedInput({
    idempotencyKey: "ten-scene-checkpoint",
    actor: {
      kind: "Player",
      playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
    },
    modelInput,
    requireGameMasterApproval: true,
  });
  assert.equal(checkpoint.status, "approval-required");
  if (checkpoint.status !== "approval-required") return;
  assert.equal(timelineStore.readAll().at(-1)?.type, "SceneTransitioned");

  const approved = await orchestrator.review({
    idempotencyKey: "ten-scene-checkpoint-approval",
    actor: { kind: "Game Master" },
    proposalId: checkpoint.proposal.id,
    decision: "approve",
  });
  assert.equal(approved.status, "accepted");
  assert.equal(approved.lifecycle.status, "resolving");
  assert.equal(recordStore.decisions()[0]?.decision, "approve");
  const proposal = app.view().state.pendingCheckProposal;
  assert.ok(proposal);
  const revealed = await orchestrator.submit({
    idempotencyKey: "ten-scene-check-confirm",
    actor: {
      kind: "Player",
      playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
    },
    command: { type: "confirm-check-proposal", proposalId: proposal.id },
  });
  assert.equal(revealed.status, "accepted");
  assert.equal(revealed.lifecycle.status, "paused");
  const pendingChoice = app.view().state.pendingChoice;
  assert.ok(pendingChoice);
  const resolved = await orchestrator.submit({
    idempotencyKey: "ten-scene-check-resolve",
    actor: {
      kind: "Player",
      playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
    },
    command: {
      type: "resolve-pending-check",
      pendingChoiceId: pendingChoice.id,
      choice: "decline",
    },
    presentation: modelInput,
  });
  assert.equal(resolved.status, "accepted");
  assert.equal(resolved.lifecycle.status, "ended");
  assert.equal(resolved.presentation?.source, "deterministic-fallback");
  assert.equal(app.view().state.activeScene, "gallery");
  assert.deepEqual(
    modelCallStore.readAll().map((record) => record.taskType),
    ["classify-discourse", "extract-intent", "propose-state-change"],
  );
});

const editFrontmatter = (
  markdown: string,
  edit: (document: Record<string, unknown>) => void,
): string => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(match);
  const document = JSON.parse(match[1]!) as Record<string, unknown>;
  edit(document);
  return markdown.replace(match[1]!, JSON.stringify(document, null, 2));
};

const revealStewardLedger = (markdown: string): string =>
  editFrontmatter(markdown, (document) => {
    const entities = document.entities as Array<Record<string, unknown>>;
    const target = entities.find((entry) => entry.id === "steward-ledger-keeper");
    assert.ok(target);
    target.visibility = "Player-visible";
    target.knowledgeScope = [
      "Game Master",
      {
        kind: "Player Character",
        playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
      },
    ];
  });

const submitJourneyAction = (
  app: StructuredPlayApplication,
  actionId: string,
): void => {
  const selected = accept(app, { type: "choose-action", actionId });
  if (selected.state.pendingCheckProposal !== null) {
    const revealed = accept(app, {
      type: "confirm-check-proposal",
      proposalId: selected.state.pendingCheckProposal.id,
    });
    assert.ok(revealed.state.pendingChoice);
    accept(app, {
      type: "resolve-pending-check",
      pendingChoiceId: revealed.state.pendingChoice.id,
      choice: "decline",
    });
  } else if (selected.state.pendingNarratorRecommendation !== null) {
    accept(app, {
      type: "confirm-oracle-likelihood",
      recommendationId: selected.state.pendingNarratorRecommendation.id,
      likelihood: selected.state.pendingNarratorRecommendation.likelihood,
    });
  }
};

test("a Pending Choice and a completed Scene boundary reopen without rerolling", () => {
  const repository = createLocalAdventureRepository(
    mkdtempSync(join(tmpdir(), "ai-ttrpg-ten-scene-resume-")),
  );
  let adventure = repository.create(TEN_SCENE_ADVENTURE.name);
  const applicationOptions = {
    ...TEN_SCENE_ADVENTURE.structuredPlayOptions,
    checkRulesetPackage: publishedCheckPackage(),
  };
  let app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: adventure.timelineStore,
  });
  accept(app, {
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  accept(app, { type: "begin-adventure" });
  for (const actionId of [
    "read-arrival-marker",
    "raise-gatehouse-latch",
    "cross-courtyard",
  ]) {
    submitJourneyAction(app, actionId);
  }

  const proposed = accept(app, {
    type: "choose-action",
    actionId: "open-vestibule-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  const revealed = accept(app, {
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  assert.ok(revealed.state.pendingChoice);
  const retainedChoice = structuredClone(revealed.state.pendingChoice);
  const retainedRandomPosition = adventure.timelineStore.position();
  const adventureId = adventure.id;
  adventure.close();

  adventure = repository.open(adventureId);
  app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: adventure.timelineStore,
  });
  assert.deepEqual(app.view().state.pendingChoice, retainedChoice);
  assert.equal(adventure.timelineStore.position(), retainedRandomPosition);
  accept(app, {
    type: "resolve-pending-check",
    pendingChoiceId: retainedChoice.id,
    choice: "decline",
  });
  assert.equal(app.view().state.activeScene, "gallery");
  const boundary = structuredClone(app.view().state);
  const retainedRoll = structuredClone(app.view().state.lastCheckResolution?.trace.random);
  adventure.close();

  adventure = repository.open(adventureId);
  app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: adventure.timelineStore,
  });
  assert.deepEqual(app.view().state, boundary);
  assert.deepEqual(app.view().state.lastCheckResolution?.trace.random, retainedRoll);
  assert.equal(app.view().state.pendingChoice, null);
  adventure.close();
});

test("reviewed discovery branches and portable import preserve only canonical Adventure data", async () => {
  const sourceRepository = createLocalAdventureRepository(
    mkdtempSync(join(tmpdir(), "ai-ttrpg-ten-scene-source-")),
  );
  const targetRepository = createLocalAdventureRepository(
    mkdtempSync(join(tmpdir(), "ai-ttrpg-ten-scene-target-")),
  );
  const adventure = sourceRepository.create(TEN_SCENE_ADVENTURE.name);
  const applicationOptions = {
    ...TEN_SCENE_ADVENTURE.structuredPlayOptions,
    checkRulesetPackage: publishedCheckPackage(),
  };
  let app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: adventure.timelineStore,
    conversationStore: adventure.conversationStore,
  });
  accept(app, {
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  accept(app, { type: "begin-adventure" });

  const firstUtterance = modelUtterance("read-arrival-marker");
  const firstPlay = await runNaturalLanguagePlay({
    io: scriptedIO([firstUtterance]).io,
    modelGateway: createModelGateway({
      provider: createScriptedModelProvider({
        model: "ten-scene-portability-v1",
        responses: modelResponses,
      }),
    }),
    modelCallStore: adventure.modelCallStore,
    conversationStore: adventure.conversationStore,
    timelineStore: adventure.timelineStore,
    applicationOptions,
  });
  assert.deepEqual(firstPlay.interpretedCommands, [
    { type: "choose-action", actionId: "read-arrival-marker" },
  ]);
  app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: adventure.timelineStore,
    conversationStore: adventure.conversationStore,
  });
  for (const actionId of [
    "raise-gatehouse-latch",
    "cross-courtyard",
    "open-vestibule-door",
    "study-family-portrait",
  ]) {
    submitJourneyAction(app, actionId);
  }
  assert.equal(app.view().state.activeScene, "library");

  const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
  const beforePlayerPosition = app.view().timeline?.activeTimeline.eventCount;
  assert.ok(beforePlayerPosition);
  accept(app, { type: "branch-timeline", eventPosition: beforePlayerPosition });
  const beforeTimelineId = adventure.timelineStore.view().activeTimelineId;
  const beforeEvents = adventure.timelineStore.readTimeline(beforeTimelineId);
  const beforeRandomPosition = adventure.timelineStore.view().activeTimeline.randomPosition;
  accept(app, { type: "select-timeline", timelineId: sourceTimelineId });

  const renderInput = {
    adventureId: adventure.id,
    adventureName: adventure.name,
    timelineId: sourceTimelineId,
    actorScope: GAME_MASTER_ACTOR_SCOPE,
    events: adventure.timelineStore.readAll(),
  };
  const rendered = renderAdventureMarkdown(renderInput);
  const edited = revealStewardLedger(rendered.markdown);
  const eventCountBeforeReview = adventure.timelineStore.readAll().length;
  const review = reviewAdventureMarkdownEdit({
    base: rendered.document,
    editedMarkdown: edited,
    current: renderInput,
    reviewerScope: GAME_MASTER_ACTOR_SCOPE,
  });
  assert.equal(review.status, "command");
  assert.equal(adventure.timelineStore.readAll().length, eventCountBeforeReview);
  if (review.status !== "command") return;
  accept(app, review.command);
  assert.ok(
    app
      .worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE)
      .entries.some((entry) => entry.id === "steward-ledger-keeper"),
  );

  const afterPlayerPosition = app.view().timeline?.activeTimeline.eventCount;
  assert.ok(afterPlayerPosition);
  accept(app, { type: "branch-timeline", eventPosition: afterPlayerPosition });
  const afterTimelineId = adventure.timelineStore.view().activeTimelineId;
  const afterEvents = adventure.timelineStore.readTimeline(afterTimelineId);
  const afterRandomPosition = adventure.timelineStore.view().activeTimeline.randomPosition;
  assert.deepEqual(
    beforeEvents,
    adventure.timelineStore
      .readTimeline(sourceTimelineId)
      .slice(0, beforeEvents.length),
  );
  assert.deepEqual(
    afterEvents,
    adventure.timelineStore
      .readTimeline(sourceTimelineId)
      .slice(0, afterEvents.length),
  );
  assert.equal(
    beforeEvents.some((event) => event.type === "WorldKnowledgeRevealed"),
    false,
  );
  assert.equal(
    afterEvents.some((event) => event.type === "WorldKnowledgeRevealed"),
    true,
  );
  assert.equal(beforeRandomPosition, afterRandomPosition);
  const beforePlayerKnowledge = projectWorldKnowledge({
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
    events: beforeEvents,
  }).entries.map((entry) => entry.id);
  const afterPlayerKnowledge = projectWorldKnowledge({
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
    events: afterEvents,
  }).entries.map((entry) => entry.id);
  assert.equal(beforePlayerKnowledge.includes("steward-ledger-keeper"), false);
  assert.equal(afterPlayerKnowledge.includes("steward-ledger-keeper"), true);
  assert.deepEqual(
    afterPlayerKnowledge.filter((id) => id !== "steward-ledger-keeper"),
    beforePlayerKnowledge,
  );
  assert.deepEqual(
    projectWorldKnowledge({
      actorScope: playerWorldKnowledgeActorScope("player-character:other"),
      events: afterEvents,
    }).entries,
    [],
  );
  const beforeGameMasterKnowledge = projectWorldKnowledge({
    actorScope: GAME_MASTER_ACTOR_SCOPE,
    events: beforeEvents,
  }).entries.map((entry) => entry.id);
  const afterGameMasterKnowledge = projectWorldKnowledge({
    actorScope: GAME_MASTER_ACTOR_SCOPE,
    events: afterEvents,
  }).entries.map((entry) => entry.id);
  assert.deepEqual(afterGameMasterKnowledge, beforeGameMasterKnowledge);
  assert.equal(beforeGameMasterKnowledge.includes("steward-ledger-keeper"), true);

  app = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: adventure.timelineStore,
    conversationStore: adventure.conversationStore,
  });
  for (const actionId of [
    "catalogue-library-ledger",
    "ask-passage-behind-shelves",
    "follow-cellar-route",
    "prepare-for-guardian",
    "overcome-manor-guardian",
  ]) {
    submitJourneyAction(app, actionId);
  }
  assert.equal(app.view().state.adventureEnding?.id, "manor-truth-recovered");
  assert.ok(adventure.modelCallStore.readAll().length > 0);
  adventure.conversationStore.append({
    id: "conversation:export-exclusion",
    classification: "table-chat",
    content: "short-lived table chat with OPENAI_API_KEY=not-a-real-key",
  });
  assert.ok(adventure.conversationStore.readAll().length > 0);

  const archive = sourceRepository.exportArchive(adventure.id);
  assert.doesNotMatch(
    archive,
    /ten-scene-portability-v1|journey:read-arrival-marker|modelCalls|rawProvider|short-lived table chat|OPENAI_API_KEY/,
  );
  const sourceTimelines = adventure.timelineStore.view().timelines.map((timeline) => ({
    ...timeline,
    events: adventure.timelineStore.readTimeline(timeline.id),
  }));
  const sourceState = structuredClone(app.view().state);
  const imported = targetRepository.importArchive(archive);
  const importedTimelines = imported.timelineStore.view().timelines.map((timeline) => ({
    ...timeline,
    events: imported.timelineStore.readTimeline(timeline.id),
  }));
  assert.deepEqual(importedTimelines, sourceTimelines);
  assert.deepEqual(imported.modelCallStore.readAll(), []);
  assert.deepEqual(imported.conversationStore.readAll(), []);
  const importedApp = createStructuredPlayApplication({
    ...applicationOptions,
    timelineStore: imported.timelineStore,
    conversationStore: imported.conversationStore,
  });
  assert.deepEqual(importedApp.view().state, sourceState);
  imported.close();
  adventure.close();
});
