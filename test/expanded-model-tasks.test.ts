import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assembleActorScopedModelTaskEvidence,
  type ActorScopedEvidenceBundle,
} from "../src/actor-scoped-retrieval.js";
import {
  assembleStateProposalEvidence,
  runExpandedModelTaskSet,
  validateRuleMatchSuggestion,
  validateStateProposal,
} from "../src/expanded-model-tasks.js";
import {
  captureAdversarialSafetyOutcomes,
  evaluateClassificationProviders,
  type ClassificationEvaluationCorpus,
} from "../src/model-task-evaluation.js";
import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  createScriptedModelProvider,
} from "../src/model-gateway.js";
import type { ModelTask } from "../src/model-gateway.js";
import { createOpenAIModelProvider } from "../src/openai-model-provider.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import { publishedCheckPackage } from "./support/published-check-package.js";
import { DEFAULT_PLAYER_ACTOR_SCOPE } from "../src/structured-play.js";

const evidenceBundle: ActorScopedEvidenceBundle = {
  id: `evidence:${"a".repeat(64)}`,
  taskType: "classify-discourse",
  scope: {
    actorScope: { kind: "Player", playerCharacterId: "player-character:primary" },
    playerCharacterId: "player-character:primary",
    campaignId: "campaign:locked-manor",
    taskType: "classify-discourse",
    rulesetVersion: "1.0.0",
  },
  items: [
    {
      id: "entity:scene:arrival",
      sourceKind: "active-scene",
      sourceReference: "scene:arrival",
      content: "arrival",
      inclusionReason: "The active Scene bounds the task.",
      visibility: "Player-visible",
      citation: "scene:arrival",
    },
    {
      id: "capability:survey-manor",
      sourceKind: "capability",
      sourceReference: "survey-manor",
      content: "Survey the manor grounds",
      inclusionReason: "The capability is currently available.",
      visibility: "Player-visible",
      citation: null,
    },
    {
      id: "rule:checks@1.0.0",
      sourceKind: "authority-rule",
      sourceReference: "rule-package:micro-ruleset@1.0.0#checks",
      content: "Checks roll 2d6 plus a Trait.",
      inclusionReason: "The approved rule may govern the utterance.",
      visibility: "Player-visible",
      citation: "rule-package:micro-ruleset@1.0.0#checks",
    },
    {
      id: "rule:free-actions@1.0.0",
      sourceKind: "authority-rule",
      sourceReference: "rule-package:micro-ruleset@1.0.0#free-actions",
      content: "Free Actions proceed without a Check.",
      inclusionReason: "The approved rule may govern the utterance.",
      visibility: "Player-visible",
      citation: "rule-package:micro-ruleset@1.0.0#free-actions",
    },
  ],
};

const retrievedEvidenceFor = (utterance: string): ActorScopedEvidenceBundle => {
  const { app, eventStore } = beginAdventureFixture();
  return assembleActorScopedModelTaskEvidence({
    scope: {
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
      campaignId: "campaign:locked-manor",
      taskType: "classify-discourse",
      rulesetVersion: "1.0.0",
    },
    corpus: {
      campaignId: "campaign:locked-manor",
      entities: [],
      acceptedEvents: eventStore.readAll(),
      approvedRules: [publishedCheckPackage()],
    },
    utterance,
    view: app.view(),
  });
};

test("rule-match suggestions distinguish matched, no-rule, and needs-adjudication outcomes", () => {
  assert.deepEqual(
    validateRuleMatchSuggestion(
      {
        status: "matched",
        ruleId: "rule:checks@1.0.0",
        evidenceItemIds: ["rule:checks@1.0.0"],
      },
      evidenceBundle,
    ),
    {
      status: "matched",
      ruleId: "rule:checks@1.0.0",
      evidenceItemIds: ["rule:checks@1.0.0"],
    },
  );
  assert.deepEqual(
    validateRuleMatchSuggestion({ status: "no-rule" }, evidenceBundle),
    { status: "no-rule" },
  );
  assert.deepEqual(
    validateRuleMatchSuggestion(
      {
        status: "needs-adjudication",
        candidateRuleIds: [
          "rule:checks@1.0.0",
          "rule:free-actions@1.0.0",
        ],
      },
      evidenceBundle,
    ),
    {
      status: "needs-adjudication",
      candidateRuleIds: [
        "rule:checks@1.0.0",
        "rule:free-actions@1.0.0",
      ],
    },
  );
  assert.equal(
    validateRuleMatchSuggestion(
      {
        status: "matched",
        ruleId: "rule:invented@9.9.9",
        evidenceItemIds: ["rule:invented@9.9.9"],
      },
      evidenceBundle,
    ),
    null,
  );
});

test("state proposals become candidate commands only after every authority check", () => {
  const validatedIntent = {
    capabilityId: "survey-manor",
    referencedEntityIds: ["scene:arrival"],
    evidenceItemIds: [
      "entity:scene:arrival",
      "capability:survey-manor",
    ],
  } as const;
  const proposalEvidence = assembleStateProposalEvidence(
    evidenceBundle,
    validatedIntent,
  );
  const intentEvidenceItemId = proposalEvidence.items.at(-1)!.id;
  const proposal = {
    status: "proposed",
    capabilityId: "survey-manor",
    referencedEntityIds: ["scene:arrival"],
    evidenceItemIds: [
      "entity:scene:arrival",
      "capability:survey-manor",
      "rule:free-actions@1.0.0",
      intentEvidenceItemId,
    ],
    intentEvidenceItemId,
    ruleEvidenceItemIds: ["rule:free-actions@1.0.0"],
    stateEvidenceItemIds: ["entity:scene:arrival"],
    rulesetVersion: "1.0.0",
    command: { type: "choose-action", actionId: "survey-manor" },
  } as const;
  const context = {
    evidenceBundle: proposalEvidence,
    validatedIntent,
    knownEntityIds: ["scene:arrival"],
    availableCapabilityIds: ["survey-manor"],
    authorizedCapabilityIds: ["survey-manor"],
    rulesetVersion: "1.0.0",
    commandSatisfiesInvariants: () => true,
  } as const;

  assert.deepEqual(validateStateProposal(proposal, context), {
    type: "choose-action",
    actionId: "survey-manor",
  });
  assert.equal(
    validateStateProposal(
      { ...proposal, ruleEvidenceItemIds: [] },
      context,
    ),
    null,
  );
  assert.equal(
    validateStateProposal(proposal, {
      ...context,
      authorizedCapabilityIds: [],
    }),
    null,
  );
  assert.equal(
    validateStateProposal(
      { ...proposal, rulesetVersion: "2.0.0" },
      context,
    ),
    null,
  );
  assert.equal(
    validateStateProposal(
      { ...proposal, referencedEntityIds: ["scene:hidden"] },
      context,
    ),
    null,
  );
  assert.equal(
    validateStateProposal(proposal, {
      ...context,
      commandSatisfiesInvariants: () => false,
    }),
    null,
  );
  assert.equal(
    validateStateProposal({ ...proposal, mechanicalEffect: "gain-health" }, context),
    null,
  );
  const substitutionEvidence = assembleStateProposalEvidence(
    {
      ...evidenceBundle,
      items: [
        ...evidenceBundle.items,
        {
          id: "capability:force-side-door",
          sourceKind: "capability",
          sourceReference: "force-side-door",
          content: "Force the side door",
          inclusionReason: "The capability is currently available.",
          visibility: "Player-visible",
          citation: null,
        },
      ],
    },
    validatedIntent,
  );
  assert.equal(
    validateStateProposal(
      {
        ...proposal,
        capabilityId: "force-side-door",
        evidenceItemIds: [
          ...proposal.evidenceItemIds,
          "capability:force-side-door",
        ],
        command: { type: "choose-action", actionId: "force-side-door" },
      },
      {
        ...context,
        evidenceBundle: substitutionEvidence,
        availableCapabilityIds: ["survey-manor", "force-side-door"],
        authorizedCapabilityIds: ["survey-manor", "force-side-door"],
      },
    ),
    null,
  );
});

test("expanded stateless Model Tasks route every discourse class and keep records outside Timelines", async () => {
  const utterances = {
    action: "I survey the manor grounds with a Check.",
    speech: "Mara calls into the dark hall.",
    rules: "Does surveying require a Check?",
    ooc: "Out of character, pause a moment.",
    chat: "That was a tense scene.",
    system: "Show my available actions.",
    noRule: "What rule governs the moon turning green?",
    adjudication: "Is this a Check or a Free Action?",
  } as const;
  const responses: Record<string, unknown> = {};
  const classify = (utterance: string, classification: string): void => {
    responses[`classify-discourse:${utterance}`] = { classification };
  };
  classify(utterances.action, "player-action");
  classify(utterances.speech, "in-character-speech");
  classify(utterances.rules, "rules-query");
  classify(utterances.ooc, "out-of-character-request");
  classify(utterances.chat, "table-chat");
  classify(utterances.system, "system-command");
  classify(utterances.noRule, "rules-query");
  classify(utterances.adjudication, "rules-query");
  responses[`extract-intent:${utterances.action}`] = {
    capabilityId: "survey-manor",
    referencedEntityIds: ["scene:arrival"],
    evidenceItemIds: [
      "entity:scene:arrival",
      "capability:survey-manor",
    ],
  };
  const validatedIntent = responses[
    `extract-intent:${utterances.action}`
  ] as {
    capabilityId: string;
    referencedEntityIds: readonly string[];
    evidenceItemIds: readonly string[];
  };
  const actionEvidenceBundle = retrievedEvidenceFor(utterances.action);
  const intentEvidenceItemId = assembleStateProposalEvidence(
    actionEvidenceBundle,
    validatedIntent,
  ).items.at(-1)!.id;
  responses[`propose-state-change:${utterances.action}`] = {
    status: "proposed",
    capabilityId: "survey-manor",
    referencedEntityIds: ["scene:arrival"],
    evidenceItemIds: [
      "entity:scene:arrival",
      "capability:survey-manor",
      "rule:micro-ruleset.check@1.0.0",
      intentEvidenceItemId,
    ],
    intentEvidenceItemId,
    ruleEvidenceItemIds: ["rule:micro-ruleset.check@1.0.0"],
    stateEvidenceItemIds: ["entity:scene:arrival"],
    rulesetVersion: "1.0.0",
    command: { type: "choose-action", actionId: "survey-manor" },
  };
  responses[`suggest-rule-match:${utterances.rules}`] = {
    status: "matched",
    ruleId: "rule:micro-ruleset.check@1.0.0",
    evidenceItemIds: ["rule:micro-ruleset.check@1.0.0"],
  };
  responses[`suggest-rule-match:${utterances.noRule}`] = { status: "no-rule" };
  responses[`suggest-rule-match:${utterances.adjudication}`] = {
    status: "needs-adjudication",
    candidateRuleIds: [
      "rule:checks@1.0.0",
      "rule:free-actions@1.0.0",
    ],
  };
  const modelCallStore = createInMemoryModelCallRecordStore();
  const gateway = createModelGateway({
    provider: createScriptedModelProvider({ model: "expanded-v1", responses }),
  });
  const results = await Promise.all(
    Object.values(utterances).map((utterance) => {
      const scopedEvidenceBundle =
        utterance === utterances.action
          ? actionEvidenceBundle
          : retrievedEvidenceFor(utterance);
      return runExpandedModelTaskSet({
        utterance,
        gateway,
        modelCallStore,
        context: {
          evidenceBundle: scopedEvidenceBundle,
          knownEntityIds: ["scene:arrival"],
          availableCapabilityIds: ["survey-manor"],
          authorizedCapabilityIds: ["survey-manor"],
          rulesetVersion: "1.0.0",
          commandSatisfiesInvariants: () => true,
        },
      });
    }),
  );

  assert.deepEqual(results.map(({ classification }) => classification), [
    "player-action",
    "in-character-speech",
    "rules-query",
    "out-of-character-request",
    "table-chat",
    "system-command",
    "rules-query",
    "rules-query",
  ]);
  assert.deepEqual(results[0]?.candidateCommand, {
    type: "choose-action",
    actionId: "survey-manor",
  });
  assert.equal(results.slice(1).every(({ candidateCommand }) => candidateCommand === null), true);
  assert.deepEqual(results[2]?.ruleMatch, {
    status: "matched",
    ruleId: "rule:micro-ruleset.check@1.0.0",
    evidenceItemIds: ["rule:micro-ruleset.check@1.0.0"],
  });
  assert.deepEqual(results[6]?.ruleMatch, { status: "no-rule" });
  assert.equal(results[7]?.ruleMatch, null);
  assert.equal(modelCallStore.readAll().length, 13);
  assert.equal(
    modelCallStore.readAll().every((record) => record.acceptedEventIds.length === 0),
    true,
  );
  assert.equal(modelCallStore.readAll().every((record) => record.promptVersion.endsWith("-v1")), true);
  assert.equal(results[0]?.evidenceTrace.modelCallIds.length, 3);
  assert.deepEqual(results[0]?.evidenceTrace.ruleIds, [
    "rule:micro-ruleset.check@1.0.0",
  ]);
  assert.equal(
    results[0]?.evidenceTrace.evidenceItemIds.some((id) => id.startsWith("intent:")),
    true,
  );
  assert.deepEqual(results[2]?.evidenceTrace.ruleIds, [
    "rule:micro-ruleset.check@1.0.0",
  ]);
  assert.equal(
    results[0]?.evidenceTrace.modelCallIds.every((id) =>
      modelCallStore.readAll().some((record) => record.id === id),
    ),
    true,
  );
});

test("invalid and unsupported expanded task outputs fail closed after one repair", async () => {
  const utterance = "Use the nonexistent secret passage.";
  const modelCallStore = createInMemoryModelCallRecordStore();
  const gateway = createModelGateway({
    provider: createScriptedModelProvider({
      model: "invalid-expanded-v1",
      responses: {
        [`classify-discourse:${utterance}`]: {
          classification: "player-action",
        },
        [`extract-intent:${utterance}`]: {
          capabilityId: "open-secret-passage",
          referencedEntityIds: ["scene:hidden"],
          evidenceItemIds: ["capability:open-secret-passage"],
        },
      },
    }),
  });

  const result = await runExpandedModelTaskSet({
    utterance,
    gateway,
    modelCallStore,
    context: {
      evidenceBundle: retrievedEvidenceFor(utterance),
      knownEntityIds: ["scene:arrival"],
      availableCapabilityIds: ["survey-manor"],
      authorizedCapabilityIds: ["survey-manor"],
      rulesetVersion: "1.0.0",
      commandSatisfiesInvariants: () => true,
    },
  });

  assert.equal(result.candidateCommand, null);
  assert.equal(result.intent, null);
  assert.equal(modelCallStore.readAll().length, 2);
  assert.deepEqual(modelCallStore.readAll()[1]?.validation, {
    status: "rejected",
    reason: "The Model Task output failed strict validation.",
  });
  assert.equal(modelCallStore.readAll()[1]?.retryCount, 1);
  assert.equal(modelCallStore.readAll()[1]?.fallbackOutcome, "safe-rejection");
  assert.deepEqual(modelCallStore.readAll()[1]?.acceptedEventIds, []);
});

test("the versioned 100-example evaluation reports per-class metrics, confusion, safety, and provider parity", async () => {
  const corpus = JSON.parse(
    readFileSync(
      new URL("../benchmarks/expanded-model-tasks-v1.json", import.meta.url),
      "utf8",
    ),
  ) as ClassificationEvaluationCorpus;
  const { eventStore } = beginAdventureFixture();
  const scriptedGatewayFor = (
    example: ClassificationEvaluationCorpus["examples"][number],
    taskOutputs: Readonly<Record<string, unknown>>,
  ) =>
    createModelGateway({
      provider: createScriptedModelProvider({
        model: "expanded-evaluation-v1",
        responses: Object.fromEntries(
          Object.entries(taskOutputs).map(([taskType, output]) => [
            `${taskType}:${example.utterance}`,
            output,
          ]),
        ),
      }),
    });
  const safetyOutcomes = await captureAdversarialSafetyOutcomes({
    corpus,
    providers: [
      { provider: "scripted-contract", gatewayFor: scriptedGatewayFor },
      {
        provider: "openai-contract",
        gatewayFor: (example, taskOutputs) =>
          createModelGateway({
            provider: createOpenAIModelProvider({
              apiKey: "test-openai-key",
              model: "expanded-evaluation-v1",
              fetcher: async (_url, init) => {
                const request = JSON.parse(String(init.body)) as {
                  input: string;
                };
                const task = JSON.parse(request.input) as ModelTask;
                const output = taskOutputs[task.type];
                assert.notEqual(output, undefined, `${task.type} output missing`);
                return new Response(
                  JSON.stringify({
                    status: "completed",
                    output: [
                      {
                        type: "message",
                        content: [
                          {
                            type: "output_text",
                            text: JSON.stringify(
                              task.type === "suggest-rule-match"
                                ? { result: output }
                                : output,
                            ),
                          },
                        ],
                      },
                    ],
                    usage: {
                      input_tokens: 5,
                      output_tokens: 3,
                      total_tokens: 8,
                    },
                  }),
                  { status: 200 },
                );
              },
            }),
          }),
      },
    ],
    contextFor: (example) => ({
      evidenceBundle: retrievedEvidenceFor(example.utterance),
      knownEntityIds: ["scene:arrival"],
      availableCapabilityIds: ["survey-manor"],
      authorizedCapabilityIds: ["survey-manor"],
      rulesetVersion: "1.0.0",
      commandSatisfiesInvariants: () => true,
    }),
    acceptedEventCount: () => eventStore.readAll().length,
  });
  const report = evaluateClassificationProviders(
    corpus,
    Object.entries(corpus.providerPredictions).map(
      ([provider, predictions]) => ({
        provider,
        predictions,
        safetyOutcomes: safetyOutcomes[provider]!,
      }),
    ),
  );

  assert.equal(corpus.id, "expanded-model-tasks-v1");
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.examples.length, 100);
  assert.equal(Object.keys(report.providers[0]!.perClass).length, 6);
  assert.equal(
    Object.values(report.providers[0]!.perClass).every(
      ({ precision, recall, f1 }) => precision === 1 && recall === 1 && f1 === 1,
    ),
    true,
  );
  assert.equal(report.providers[0]!.adversarialSafety, 1);
  assert.equal(report.providerContractParity, true);
  const unsafeOutcomes = {
    ...safetyOutcomes["scripted-contract"],
    "example-017": {
      candidateCommandAccepted: true,
      eventDelta: 1,
    },
  };
  const unsafeReport = evaluateClassificationProviders(corpus, [
    {
      provider: "scripted-contract",
      predictions: corpus.providerPredictions["scripted-contract"]!,
      safetyOutcomes: unsafeOutcomes,
    },
  ]);
  assert.equal(unsafeReport.providers[0]!.adversarialSafety, 0.8);
  assert.equal(
    Object.values(report.providers[0]!.confusionMatrix).every(
      (row) => Object.values(row).reduce((total, count) => total + count, 0) > 0,
    ),
    true,
  );
  const documentedReport = readFileSync(
    new URL("../docs/model-task-evaluation-report.md", import.meta.url),
    "utf8",
  );
  assert.match(documentedReport, /expanded-model-tasks-v1/);
  assert.match(documentedReport, /provider-contract parity is true/i);
  for (const classification of [
    "Player action",
    "In-character speech",
    "Rules query",
    "Out-of-character request",
    "Table chat",
    "System command",
  ]) {
    assert.match(documentedReport, new RegExp(classification));
  }
});
