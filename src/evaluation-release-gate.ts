import { immutableSnapshot, isRecord } from "./model-boundary.js";

export type EvaluationQualityLayer =
  | "classification"
  | "intent-extraction"
  | "rule-selection"
  | "retrieval"
  | "citation"
  | "proposal-validity"
  | "narration";
export type EvaluationGateLayer = EvaluationQualityLayer | "model" | "cost";
export type QualityMetric =
  | "precision"
  | "recall"
  | "accuracy"
  | "contradictionRate"
  | "citationAccuracy"
  | "forbiddenDataLeakage";
export type RetrievalKind = "entity" | "relationship" | "rule" | "event";

export interface EvaluationPolicy {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly review: {
    readonly reviewer: string;
    readonly reviewedAt: string;
    readonly rationale: string;
  };
  readonly quality: Readonly<
    Record<QualityMetric, { readonly direction: "minimum" | "maximum"; readonly value: number }>
  >;
  readonly retrieval: {
    readonly byKind: Readonly<Record<RetrievalKind, {
      readonly minimumPrecisionAtK: number;
      readonly minimumRecallAtK: number;
      readonly minimumMeanReciprocalRank: number;
    }>>;
    readonly minimumUnambiguousEntityLinkAccuracy: number;
    readonly maximumForbiddenDataLeakage: number;
  };
  readonly operations: {
    readonly maximumP95LatencyMs: number;
    readonly maximumModelTasksPerTurn: number;
    readonly maximumCostUsdPerTurn: number;
    readonly maximumCostUsdPerSession: number;
    readonly maximumRetries: number;
    readonly maximumRepairs: number;
    readonly maximumFailures: number;
    readonly maximumP95EvidenceBundleItems: number;
  };
}

export interface ReleaseEvaluationSuite {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly mode: "deterministic-scripted" | "paid-provider";
  readonly datasets: readonly {
    readonly layer: EvaluationQualityLayer;
    readonly datasetId: string;
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly changeSurface: {
    readonly models: readonly string[];
    readonly promptVersions: readonly string[];
    readonly providers: readonly string[];
    readonly retrievalPolicies: readonly string[];
    readonly rulesets: readonly string[];
  };
}

export interface RetrievalObservation {
  readonly k: number;
  readonly byKind: Readonly<
    Record<RetrievalKind, {
      readonly caseCount: number;
      readonly precisionAtK: number;
      readonly recallAtK: number;
      readonly meanReciprocalRank: number;
      readonly forbiddenDataLeakage: number;
    }>
  >;
  readonly unambiguousEntityLinkAccuracy: number;
  readonly totalForbiddenDataLeakage: number;
}

export interface EvaluationObservations {
  readonly datasets: readonly {
    readonly layer: EvaluationQualityLayer;
    readonly datasetId: string;
    readonly metrics: Readonly<Partial<Record<QualityMetric, number>>>;
    readonly retrieval?: RetrievalObservation;
  }[];
  readonly turns: readonly {
    readonly sessionId: string;
    readonly latencyMs: number;
    readonly modelTasks: number;
    readonly costUsd: number;
    readonly retries: number;
    readonly repairs: number;
    readonly failures: number;
    readonly evidenceBundleItems: number;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
    };
  }[];
}

const layers: readonly EvaluationQualityLayer[] = [
  "classification", "intent-extraction", "rule-selection", "retrieval",
  "citation", "proposal-validity", "narration",
];
const metrics: readonly QualityMetric[] = [
  "precision", "recall", "accuracy", "contradictionRate",
  "citationAccuracy", "forbiddenDataLeakage",
];
const requiredMetrics: Readonly<Record<EvaluationQualityLayer, readonly QualityMetric[]>> = {
  classification: ["precision", "recall", "accuracy"],
  "intent-extraction": ["accuracy"],
  "rule-selection": ["precision", "recall", "citationAccuracy"],
  retrieval: [],
  citation: ["citationAccuracy"],
  "proposal-validity": ["accuracy", "contradictionRate", "forbiddenDataLeakage"],
  narration: ["contradictionRate", "citationAccuracy", "forbiddenDataLeakage"],
};
const retrievalKinds: readonly RetrievalKind[] = ["entity", "relationship", "rule", "event"];
const invalid = (kind: string): never => { throw new Error(`Invalid ${kind}.`); };
const recordJson = (text: string, kind: string): Record<string, unknown> => {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return invalid(kind); }
  return isRecord(value) ? value : invalid(kind);
};
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";
const nonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const stringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length > 0 && value.every(nonEmpty);

export const parseEvaluationPolicy = (text: string): EvaluationPolicy => {
  const value = recordJson(text, "evaluation policy");
  if (!nonEmpty(value.id) || value.schemaVersion !== 1 || !isRecord(value.review) ||
      !nonEmpty(value.review.reviewer) || !nonEmpty(value.review.reviewedAt) ||
      !nonEmpty(value.review.rationale) || !isRecord(value.quality) ||
      !isRecord(value.retrieval) || !isRecord(value.operations)) invalid("evaluation policy");
  const quality = value.quality as Record<string, unknown>;
  const retrievalPolicy = value.retrieval as Record<string, unknown>;
  const operationsPolicy = value.operations as Record<string, unknown>;
  for (const metric of metrics) {
    const threshold = quality[metric];
    if (!isRecord(threshold) ||
        (threshold.direction !== "minimum" && threshold.direction !== "maximum") ||
        !nonNegative(threshold.value)) invalid("evaluation policy");
  }
  if (!isRecord(retrievalPolicy.byKind)) invalid("evaluation policy");
  const retrievalByKind = retrievalPolicy.byKind as Record<string, unknown>;
  for (const kind of retrievalKinds) {
    const threshold = retrievalByKind[kind];
    if (!isRecord(threshold) ||
        ["minimumPrecisionAtK", "minimumRecallAtK", "minimumMeanReciprocalRank"]
          .some((key) => !nonNegative(threshold[key]))) invalid("evaluation policy");
  }
  const numericGroups = [
    [retrievalPolicy, ["minimumUnambiguousEntityLinkAccuracy", "maximumForbiddenDataLeakage"]],
    [operationsPolicy, ["maximumP95LatencyMs", "maximumModelTasksPerTurn", "maximumCostUsdPerTurn", "maximumCostUsdPerSession", "maximumRetries", "maximumRepairs", "maximumFailures", "maximumP95EvidenceBundleItems"]],
  ] as const;
  if (numericGroups.some(([group, keys]) => keys.some((key) => !nonNegative(group[key])))) {
    invalid("evaluation policy");
  }
  return immutableSnapshot(value) as unknown as EvaluationPolicy;
};

export const parseReleaseEvaluationSuite = (text: string): ReleaseEvaluationSuite => {
  const value = recordJson(text, "release evaluation suite");
  if (!nonEmpty(value.id) || value.schemaVersion !== 1 || !nonEmpty(value.policyId) ||
      (value.mode !== "deterministic-scripted" && value.mode !== "paid-provider") ||
      !Array.isArray(value.datasets) || !isRecord(value.changeSurface)) {
    invalid("release evaluation suite");
  }
  const datasets = value.datasets as unknown[];
  const changeSurface = value.changeSurface as Record<string, unknown>;
  const datasetLayers: EvaluationQualityLayer[] = [];
  for (const dataset of datasets) {
    if (!isRecord(dataset)) invalid("release evaluation suite");
    const configured = dataset as Record<string, unknown>;
    if (!layers.includes(configured.layer as EvaluationQualityLayer) ||
        !nonEmpty(configured.datasetId) || !nonEmpty(configured.path) ||
        typeof configured.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(configured.sha256)) {
      invalid("release evaluation suite");
    }
    datasetLayers.push(configured.layer as EvaluationQualityLayer);
  }
  if (datasetLayers.length !== layers.length ||
      layers.some((layer) => datasetLayers.filter((candidate) => candidate === layer).length !== 1)) {
    invalid("release evaluation suite");
  }
  for (const key of ["models", "promptVersions", "providers", "retrievalPolicies", "rulesets"] as const) {
    if (!stringList(changeSurface[key])) invalid("release evaluation suite");
  }
  return immutableSnapshot(value) as unknown as ReleaseEvaluationSuite;
};

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1]!;
};
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const round = (value: number): number => Number(value.toFixed(6));
export interface EvaluationGateFailure {
  readonly layer: EvaluationGateLayer;
  readonly metric: string;
  readonly measured: number;
  readonly tolerance: number;
  readonly message: string;
}
const addMaximumGate = (
  gates: EvaluationGateFailure[], layer: EvaluationGateLayer, metric: string,
  measured: number, tolerance: number,
): void => {
  if (measured > tolerance) gates.push({ layer, metric, measured, tolerance,
    message: `${metric} ${measured} exceeded maximum tolerance ${tolerance}.` });
};
const addMinimumGate = (
  gates: EvaluationGateFailure[], layer: EvaluationGateLayer, metric: string,
  measured: number, tolerance: number,
): void => {
  if (measured < tolerance) gates.push({ layer, metric, measured, tolerance,
    message: `${metric} ${measured} fell below minimum tolerance ${tolerance}.` });
};

export const evaluateReleaseMeasurements = ({ policy, suite, observations }: {
  readonly policy: EvaluationPolicy;
  readonly suite: ReleaseEvaluationSuite;
  readonly observations: EvaluationObservations;
}) => {
  if (suite.policyId !== policy.id) throw new Error(`Release suite requires policy ${suite.policyId}, not ${policy.id}.`);
  if (observations.turns.length === 0) throw new Error("Release evaluation requires operational observations.");
  const observedLayers = observations.datasets.map(({ layer }) => layer);
  if (observedLayers.length !== layers.length ||
      layers.some((layer) => observedLayers.filter((candidate) => candidate === layer).length !== 1)) {
    throw new Error("Release evaluation requires every quality layer exactly once.");
  }
  const gates: EvaluationGateFailure[] = [];
  for (const dataset of observations.datasets) {
    const configured = suite.datasets.find(({ layer }) => layer === dataset.layer);
    if (configured?.datasetId !== dataset.datasetId) throw new Error(`Unexpected ${dataset.layer} dataset observation.`);
    for (const metric of requiredMetrics[dataset.layer]) {
      const measured = dataset.metrics[metric];
      if (measured === undefined) throw new Error(`${dataset.layer} requires ${metric}.`);
      const threshold = policy.quality[metric];
      if (threshold.direction === "minimum") addMinimumGate(gates, dataset.layer, metric, measured, threshold.value);
      else addMaximumGate(gates, dataset.layer, metric, measured, threshold.value);
    }
    if (dataset.layer === "retrieval") {
      const retrieval = dataset.retrieval;
      if (retrieval === undefined || !Number.isInteger(retrieval.k) || retrieval.k < 1) {
        throw new Error("Retrieval Evaluation requires k and per-kind measurements.");
      }
      for (const kind of retrievalKinds) {
        const measured = retrieval.byKind[kind];
        const threshold = policy.retrieval.byKind[kind];
        if (measured === undefined) throw new Error(`Retrieval Evaluation requires ${kind} measurements.`);
        addMinimumGate(gates, "retrieval", `${kind}.precision@${retrieval.k}`, measured.precisionAtK, threshold.minimumPrecisionAtK);
        addMinimumGate(gates, "retrieval", `${kind}.recall@${retrieval.k}`, measured.recallAtK, threshold.minimumRecallAtK);
        addMinimumGate(gates, "retrieval", `${kind}.meanReciprocalRank`, measured.meanReciprocalRank, threshold.minimumMeanReciprocalRank);
        addMaximumGate(gates, "retrieval", `${kind}.forbiddenDataLeakage`, measured.forbiddenDataLeakage, policy.retrieval.maximumForbiddenDataLeakage);
      }
      addMinimumGate(gates, "retrieval", "unambiguousEntityLinkAccuracy", retrieval.unambiguousEntityLinkAccuracy, policy.retrieval.minimumUnambiguousEntityLinkAccuracy);
      addMaximumGate(gates, "retrieval", "totalForbiddenDataLeakage", retrieval.totalForbiddenDataLeakage, policy.retrieval.maximumForbiddenDataLeakage);
    }
  }
  for (const turn of observations.turns) {
    if (!nonEmpty(turn.sessionId) || [turn.latencyMs, turn.modelTasks, turn.costUsd, turn.retries,
      turn.repairs, turn.failures, turn.evidenceBundleItems, turn.usage.inputTokens,
      turn.usage.outputTokens, turn.usage.totalTokens].some((value) => !nonNegative(value)) ||
      turn.usage.totalTokens !== turn.usage.inputTokens + turn.usage.outputTokens) {
      throw new Error("Invalid operational observation.");
    }
  }
  const sessions = new Set(observations.turns.map(({ sessionId }) => sessionId));
  const totalCost = sum(observations.turns.map(({ costUsd }) => costUsd));
  const operations = {
    turnCount: observations.turns.length,
    sessionCount: sessions.size,
    latencyMs: { p50: percentile(observations.turns.map(({ latencyMs }) => latencyMs), 0.5), p95: percentile(observations.turns.map(({ latencyMs }) => latencyMs), 0.95) },
    modelTasksPerTurn: round(sum(observations.turns.map(({ modelTasks }) => modelTasks)) / observations.turns.length),
    usage: {
      inputTokens: sum(observations.turns.map(({ usage }) => usage.inputTokens)),
      outputTokens: sum(observations.turns.map(({ usage }) => usage.outputTokens)),
      totalTokens: sum(observations.turns.map(({ usage }) => usage.totalTokens)),
      totalTokensPerTurn: round(sum(observations.turns.map(({ usage }) => usage.totalTokens)) / observations.turns.length),
    },
    costUsd: { perTurn: round(totalCost / observations.turns.length), perSession: round(totalCost / sessions.size) },
    retries: sum(observations.turns.map(({ retries }) => retries)),
    repairs: sum(observations.turns.map(({ repairs }) => repairs)),
    failures: sum(observations.turns.map(({ failures }) => failures)),
    evidenceBundle: {
      p50Items: percentile(observations.turns.map(({ evidenceBundleItems }) => evidenceBundleItems), 0.5),
      p95Items: percentile(observations.turns.map(({ evidenceBundleItems }) => evidenceBundleItems), 0.95),
    },
  };
  addMaximumGate(gates, "model", "latencyMs.p95", operations.latencyMs.p95, policy.operations.maximumP95LatencyMs);
  addMaximumGate(gates, "model", "modelTasksPerTurn", operations.modelTasksPerTurn, policy.operations.maximumModelTasksPerTurn);
  addMaximumGate(gates, "cost", "costUsd.perTurn", operations.costUsd.perTurn, policy.operations.maximumCostUsdPerTurn);
  addMaximumGate(gates, "cost", "costUsd.perSession", operations.costUsd.perSession, policy.operations.maximumCostUsdPerSession);
  addMaximumGate(gates, "model", "retries", operations.retries, policy.operations.maximumRetries);
  addMaximumGate(gates, "model", "repairs", operations.repairs, policy.operations.maximumRepairs);
  addMaximumGate(gates, "model", "failures", operations.failures, policy.operations.maximumFailures);
  addMaximumGate(gates, "retrieval", "evidenceBundle.p95Items", operations.evidenceBundle.p95Items, policy.operations.maximumP95EvidenceBundleItems);
  return immutableSnapshot({
    evaluationId: suite.id,
    policy: { id: policy.id, review: policy.review },
    status: gates.length === 0 ? "passed" as const : "failed" as const,
    measurementMode: suite.mode,
    paidProviderMeasurements: suite.mode === "paid-provider" ? operations : null,
    datasets: suite.datasets,
    changeSurface: suite.changeSurface,
    quality: observations.datasets,
    operations,
    gates,
  });
};
