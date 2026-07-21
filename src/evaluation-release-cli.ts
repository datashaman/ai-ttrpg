import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { runDurableAdventureSimulation } from "./adventure-simulation.js";
import { assembleActorScopedModelTaskEvidence } from "./actor-scoped-retrieval.js";
import {
  evaluateReleaseMeasurements,
  parseEvaluationPolicy,
  parseReleaseEvaluationSuite,
  type EvaluationObservations,
  type EvaluationQualityLayer,
  type RetrievalObservation,
} from "./evaluation-release-gate.js";
import {
  evaluateGoldenCampaign,
  parseGoldenCampaignFixture,
  supportedGoldenCampaignAdapters,
} from "./golden-campaign-evaluation.js";
import {
  createModelGateway,
  createScriptedModelProvider,
  modelPromptVersions,
} from "./model-gateway.js";
import { immutableSnapshot } from "./model-boundary.js";
import {
  captureAdversarialSafetyOutcomes,
  type ClassificationEvaluationCorpus,
} from "./model-task-evaluation.js";
import { createMicroRulesetPackage } from "./micro-ruleset-package.js";
import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  DEFAULT_PLAYER_ACTOR_SCOPE,
} from "./structured-play.js";
import {
  evaluateLockedManorUtterances,
  type LockedManorUtteranceDataset,
} from "./locked-manor-evaluation.js";

const policyPath = process.argv[2] ?? "benchmarks/evaluation-policy-v1.json";
const suitePath = process.argv[3] ?? "benchmarks/release-measurements-v1.json";
const policy = parseEvaluationPolicy(readFileSync(policyPath, "utf8"));
const suite = parseReleaseEvaluationSuite(readFileSync(suitePath, "utf8"));
const sources = new Map<EvaluationQualityLayer, unknown>();

for (const dataset of suite.datasets) {
  const sourceText = readFileSync(dataset.path, "utf8");
  const source = JSON.parse(sourceText) as { readonly id?: unknown };
  if (source.id !== dataset.datasetId) {
    throw new Error(`Measurement dataset ${dataset.datasetId} does not match ${dataset.path}.`);
  }
  if (createHash("sha256").update(sourceText).digest("hex") !== dataset.sha256) {
    throw new Error(`Measurement dataset ${dataset.datasetId} changed; rerun and review its fixed evaluation before release.`);
  }
  sources.set(dataset.layer, source);
}

const classificationSource = sources.get("classification") as {
  readonly examples: readonly { readonly id: string; readonly expectedClassification: string }[];
  readonly providerPredictions: Readonly<Record<string, Readonly<Record<string, string>>>>;
};
const predictions = Object.values(classificationSource.providerPredictions);
const predictionCount = predictions.length * classificationSource.examples.length;
const correctPredictions = predictions.reduce(
  (total, provider) => total + classificationSource.examples.filter(
    (example) => provider[example.id] === example.expectedClassification,
  ).length,
  0,
);
const classificationAccuracy = correctPredictions / predictionCount;
const discourseClasses = [
  ...new Set(
    classificationSource.examples.map(({ expectedClassification }) =>
      expectedClassification
    ),
  ),
];
const classificationPrecision = Math.min(
  ...predictions.flatMap((provider) => discourseClasses.map((classification) => {
    const truePositive = classificationSource.examples.filter(
      (example) =>
        example.expectedClassification === classification &&
        provider[example.id] === classification,
    ).length;
    const predicted = classificationSource.examples.filter(
      (example) => provider[example.id] === classification,
    ).length;
    return predicted === 0 ? 0 : truePositive / predicted;
  })),
);
const classificationRecall = Math.min(
  ...predictions.flatMap((provider) => discourseClasses.map((classification) => {
    const expected = classificationSource.examples.filter(
      (example) => example.expectedClassification === classification,
    );
    const truePositive = expected.filter(
      (example) => provider[example.id] === classification,
    ).length;
    return truePositive / expected.length;
  })),
);

const proposalSource = sources.get("proposal-validity") as ClassificationEvaluationCorpus;
const proposalEventStore = createInMemoryEventStore();
const proposalApplication = createStructuredPlayApplication({
  eventStore: proposalEventStore,
});
proposalApplication.submit({
  type: "configure-player-character",
  name: "Mara Vey",
  pronouns: "she/her",
  motivation: "Find her missing sister",
  traits: { Might: 0, Wits: 2, Presence: 1 },
});
proposalApplication.submit({ type: "begin-adventure" });
const proposalEvidenceFor = (utterance: string) =>
  assembleActorScopedModelTaskEvidence({
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
      acceptedEvents: proposalEventStore.readAll(),
      approvedRules: [createMicroRulesetPackage()],
    },
    utterance,
    view: proposalApplication.view(),
  });
const proposalSafety = await captureAdversarialSafetyOutcomes({
  corpus: proposalSource,
  providers: [{
    provider: "scripted-contract",
    gatewayFor: (example, taskOutputs) => createModelGateway({
      provider: createScriptedModelProvider({
        model: "expanded-evaluation-v1",
        responses: Object.fromEntries(
          Object.entries(taskOutputs).map(([taskType, output]) => [
            `${taskType}:${example.utterance}`,
            output,
          ]),
        ),
      }),
    }),
  }],
  contextFor: (example) => ({
    evidenceBundle: proposalEvidenceFor(example.utterance),
    knownEntityIds: ["scene:arrival"],
    availableCapabilityIds: ["survey-manor"],
    authorizedCapabilityIds: ["survey-manor"],
    rulesetVersion: "1.0.0",
    commandSatisfiesInvariants: () => true,
  }),
  acceptedEventCount: () => proposalEventStore.readAll().length,
});
const adversarialExamples = proposalSource.examples.filter(({ adversarial }) => adversarial);
const proposalOutcomes = proposalSafety["scripted-contract"]!;
const unsafeProposals = adversarialExamples.filter((example) => {
  const outcome = proposalOutcomes[example.id]!;
  return outcome.candidateCommandAccepted || outcome.eventDelta !== 0;
});
const proposalDatasetAccuracy =
  (adversarialExamples.length - unsafeProposals.length) /
  adversarialExamples.length;
const proposalDatasetLeakage = unsafeProposals.filter((example) =>
  /hidden|forbidden/i.test(
    JSON.stringify(proposalSource.adversarialTaskOutputs[example.id]),
  )
).length;

const retrievalSource = sources.get("retrieval") as {
  readonly k: number;
  readonly expectedMeasurements: Omit<RetrievalObservation, "k">;
};
const retrieval: RetrievalObservation = {
  k: retrievalSource.k,
  ...retrievalSource.expectedMeasurements,
};

const goldenSource = sources.get("narration");
const goldenReport = await evaluateGoldenCampaign({
  fixture: parseGoldenCampaignFixture(JSON.stringify(goldenSource)),
  adapters: supportedGoldenCampaignAdapters(),
});
const lockedManor = await evaluateLockedManorUtterances(
  sources.get("intent-extraction") as LockedManorUtteranceDataset,
);
const ruleSource = sources.get("rule-selection") as {
  readonly labels: Readonly<Record<string, readonly string[]>>;
  readonly scriptedExtraction: Readonly<Record<string, {
    readonly attribution?: { readonly passageAnchors?: readonly string[] };
  }>>;
};
const ruleFields = ["trigger", "prerequisites", "procedure", "outcomes"] as const;
let expectedRuleCitations = 0;
let selectedRuleCitations = 0;
let correctRuleCitations = 0;
for (const field of ruleFields) {
  const expected = new Set(ruleSource.labels[field] ?? []);
  const selected = ruleSource.scriptedExtraction[field]?.attribution?.passageAnchors ?? [];
  expectedRuleCitations += expected.size;
  selectedRuleCitations += selected.length;
  correctRuleCitations += selected.filter((anchor) => expected.has(anchor)).length;
}
const ruleExtractionPrecision = correctRuleCitations / selectedRuleCitations;
const ruleExtractionRecall = correctRuleCitations / expectedRuleCitations;
const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort();
const executedSurfaces = goldenReport.runs.flatMap((run) =>
  run.operations === null ? [] : [run.operations.changeSurface]
);
const evaluatedChangeSurface = {
  models: unique(executedSurfaces.flatMap(({ models }) => models)),
  promptVersions: unique(modelPromptVersions()),
  providers: unique(executedSurfaces.flatMap(({ providers }) => providers)),
  retrievalPolicies: unique(
    executedSurfaces.flatMap(({ retrievalPolicies }) => retrievalPolicies),
  ),
  rulesets: unique(executedSurfaces.flatMap(({ rulesets }) => rulesets)),
};
for (const key of ["models", "promptVersions", "providers", "retrievalPolicies", "rulesets"] as const) {
  if (JSON.stringify(unique(suite.changeSurface[key])) !== JSON.stringify(evaluatedChangeSurface[key])) {
    throw new Error(`Configured ${key} do not match the fixed evaluation run.`);
  }
}
const goldenRate = (
  predicate: (quality: (typeof goldenReport.runs)[number]["quality"]) => boolean,
): number => goldenReport.runs.length === 0
  ? 0
  : goldenReport.runs.filter(({ quality }) => predicate(quality)).length /
    goldenReport.runs.length;
const goldenIntentAccuracy = goldenRate(({ intentExtractionCorrect }) => intentExtractionCorrect);
const goldenRuleAccuracy = goldenRate(({ ruleSelectionCorrect }) => ruleSelectionCorrect);
const goldenProposalAccuracy = goldenRate(({ proposalValid }) => proposalValid);
const goldenCitationAccuracy = goldenRate(({ citationAccurate }) => citationAccurate);
const goldenProposalContradictionRate = goldenRate(({ proposalContradiction }) => proposalContradiction);
const goldenNarrationContradictionRate = goldenRate(({ narrationContradiction }) => narrationContradiction);
let goldenLeakage = 0;
for (const { quality } of goldenReport.runs) {
  goldenLeakage += quality.forbiddenDataLeakage;
}

const datasetId = (layer: EvaluationQualityLayer): string =>
  suite.datasets.find((dataset) => dataset.layer === layer)!.datasetId;
const datasetObservations: EvaluationObservations["datasets"] = [
  { layer: "classification", datasetId: datasetId("classification"), metrics: {
    precision: classificationPrecision,
    recall: classificationRecall,
    accuracy: classificationAccuracy,
  } },
  { layer: "intent-extraction", datasetId: datasetId("intent-extraction"), metrics: {
    accuracy: Math.min(lockedManor.intentExtractionAccuracy, goldenIntentAccuracy),
  } },
  { layer: "rule-selection", datasetId: datasetId("rule-selection"), metrics: {
    precision: Math.min(ruleExtractionPrecision, goldenRuleAccuracy),
    recall: Math.min(ruleExtractionRecall, goldenRuleAccuracy),
    citationAccuracy: Math.min(ruleExtractionPrecision, goldenCitationAccuracy),
  } },
  { layer: "retrieval", datasetId: datasetId("retrieval"), metrics: {}, retrieval },
  { layer: "citation", datasetId: datasetId("citation"), metrics: {
    citationAccuracy: Math.min(lockedManor.citationAccuracy, goldenCitationAccuracy),
  } },
  { layer: "proposal-validity", datasetId: datasetId("proposal-validity"), metrics: {
    accuracy: Math.min(proposalDatasetAccuracy, lockedManor.proposalValidityAccuracy, goldenProposalAccuracy),
    contradictionRate: Math.max(1 - proposalDatasetAccuracy, lockedManor.proposalContradictionRate, goldenProposalContradictionRate),
    forbiddenDataLeakage: proposalDatasetLeakage + goldenLeakage,
  } },
  { layer: "narration", datasetId: datasetId("narration"), metrics: {
    contradictionRate: goldenNarrationContradictionRate,
    citationAccuracy: goldenCitationAccuracy,
    forbiddenDataLeakage: goldenLeakage,
  } },
];

const turns: EvaluationObservations["turns"] = goldenReport.runs.map((run) =>
  run.operations === null
    ? {
        sessionId: Object.values(run.adapters).join(":"),
        latencyMs: 0,
        modelTasks: 0,
        costUsd: 0,
        retries: 0,
        repairs: 0,
        failures: 1,
        evidenceBundleItems: 0,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }
    : ({
    sessionId: Object.values(run.adapters).join(":"),
    latencyMs: run.operations.latencyMs,
    modelTasks: run.operations.modelTasks / run.operations.turns,
    costUsd: run.operations.costUsd,
    retries: run.operations.retries,
    repairs: run.operations.repairs,
    failures: run.operations.failures,
    evidenceBundleItems: run.operations.evidenceBundleItems,
    usage: {
      inputTokens: run.operations.inputTokens,
      outputTokens: run.operations.outputTokens,
      totalTokens: run.operations.inputTokens + run.operations.outputTokens,
    },
  })
);
const observations: EvaluationObservations = {
  datasets: datasetObservations,
  turns: turns.length > 0 ? turns : [{
    sessionId: "failed-golden-campaign",
    latencyMs: 0,
    modelTasks: 0,
    costUsd: 0,
    retries: 0,
    repairs: 0,
    failures: 1,
    evidenceBundleItems: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }],
};
const evaluation = evaluateReleaseMeasurements({ policy, suite, observations });
const simulation = await runDurableAdventureSimulation();
const report = immutableSnapshot({
  ...evaluation,
  status:
    evaluation.status === "passed" && simulation.status === "passed"
      ? ("passed" as const)
      : ("failed" as const),
  simulation,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === "failed") process.exitCode = 1;
