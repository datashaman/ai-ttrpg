import { immutableSnapshot } from "./model-boundary.js";

export type RetrievalEvaluationKind =
  | "entity"
  | "relationship"
  | "rule"
  | "event";

export interface RetrievalQualityThresholds {
  readonly minimumPrecisionAtK: number;
  readonly minimumRecallAtK: number;
  readonly minimumMeanReciprocalRank: number;
  readonly minimumUnambiguousEntityLinkAccuracy: number;
  readonly maximumForbiddenDataLeakage: number;
}

interface RetrievalEvaluationCaseBase {
  readonly id: string;
  readonly expectedItemIds: readonly string[];
  readonly retrievedItemIds: readonly string[];
  readonly forbiddenItemIds: readonly string[];
}

export type RetrievalEvaluationCase = RetrievalEvaluationCaseBase &
  (
    | {
        readonly retrievalKind: "entity";
        readonly referenceKind: "unambiguous";
        readonly expectedUnambiguousEntityId: string;
      }
    | {
        readonly retrievalKind: "entity";
        readonly referenceKind?: "ambiguous";
        readonly expectedUnambiguousEntityId?: never;
      }
    | {
        readonly retrievalKind: Exclude<RetrievalEvaluationKind, "entity">;
        readonly referenceKind?: never;
        readonly expectedUnambiguousEntityId?: never;
      }
  );

export interface RetrievalKindMeasurements {
  readonly caseCount: number;
  readonly precisionAtK: number;
  readonly recallAtK: number;
  readonly meanReciprocalRank: number;
  readonly forbiddenDataLeakage: number;
}

export interface RetrievalEvaluationReport {
  readonly evaluationId: string;
  readonly k: number;
  readonly thresholds: RetrievalQualityThresholds;
  readonly byKind: Readonly<Partial<Record<RetrievalEvaluationKind, RetrievalKindMeasurements>>>;
  readonly unambiguousEntityLinkAccuracy: number;
  readonly totalForbiddenDataLeakage: number;
  readonly passed: boolean;
  readonly failedThresholds: readonly string[];
}

export interface RetrievalEvaluationInput {
  readonly evaluationId: string;
  readonly k: number;
  readonly thresholds: RetrievalQualityThresholds;
  readonly cases: readonly RetrievalEvaluationCase[];
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : numerator / denominator;

const fixed = (value: number): string => value.toFixed(4);

export const evaluateRetrieval = (
  input: RetrievalEvaluationInput,
): RetrievalEvaluationReport => {
  if (!Number.isInteger(input.k) || input.k < 1) {
    throw new RangeError("Retrieval evaluation k must be a positive integer.");
  }
  input.cases.forEach((evaluationCase) => {
    if (
      evaluationCase.referenceKind === "unambiguous" &&
      evaluationCase.expectedUnambiguousEntityId.trim() === ""
    ) {
      throw new TypeError(
        `Unambiguous entity evaluation case ${evaluationCase.id} requires one expected entity ID.`,
      );
    }
  });

  const byKind: Partial<Record<RetrievalEvaluationKind, RetrievalKindMeasurements>> = {};
  const failedThresholds: string[] = [];
  const kinds: readonly RetrievalEvaluationKind[] = [
    "entity",
    "relationship",
    "rule",
    "event",
  ];

  kinds.forEach((kind) => {
    const cases = input.cases.filter((candidate) => candidate.retrievalKind === kind);
    if (cases.length === 0) return;

    let relevantAtK = 0;
    let retrievedAtK = 0;
    let expected = 0;
    let reciprocalRank = 0;
    let forbiddenDataLeakage = 0;
    cases.forEach((evaluationCase) => {
      const expectedIds = new Set(evaluationCase.expectedItemIds);
      const forbiddenIds = new Set(evaluationCase.forbiddenItemIds);
      const ranked = evaluationCase.retrievedItemIds.slice(0, input.k);
      relevantAtK += ranked.filter((id) => expectedIds.has(id)).length;
      retrievedAtK += ranked.length;
      expected += expectedIds.size;
      const firstRelevant = evaluationCase.retrievedItemIds.findIndex((id) =>
        expectedIds.has(id),
      );
      reciprocalRank += firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1);
      forbiddenDataLeakage += evaluationCase.retrievedItemIds.filter((id) =>
        forbiddenIds.has(id),
      ).length;
    });

    const measurements: RetrievalKindMeasurements = {
      caseCount: cases.length,
      precisionAtK: ratio(relevantAtK, retrievedAtK),
      recallAtK: ratio(relevantAtK, expected),
      meanReciprocalRank: reciprocalRank / cases.length,
      forbiddenDataLeakage,
    };
    byKind[kind] = measurements;

    if (measurements.precisionAtK < input.thresholds.minimumPrecisionAtK) {
      failedThresholds.push(
        `${kind} precision@${input.k} ${fixed(measurements.precisionAtK)} < ${fixed(input.thresholds.minimumPrecisionAtK)}`,
      );
    }
    if (measurements.recallAtK < input.thresholds.minimumRecallAtK) {
      failedThresholds.push(
        `${kind} recall@${input.k} ${fixed(measurements.recallAtK)} < ${fixed(input.thresholds.minimumRecallAtK)}`,
      );
    }
    if (
      measurements.meanReciprocalRank <
      input.thresholds.minimumMeanReciprocalRank
    ) {
      failedThresholds.push(
        `${kind} mean reciprocal rank ${fixed(measurements.meanReciprocalRank)} < ${fixed(input.thresholds.minimumMeanReciprocalRank)}`,
      );
    }
  });

  const unambiguousEntityCases = input.cases.filter(
    (candidate) =>
      candidate.retrievalKind === "entity" &&
      candidate.referenceKind === "unambiguous",
  );
  const correctlyLinked = unambiguousEntityCases.filter((evaluationCase) =>
    evaluationCase.retrievedItemIds[0] ===
    evaluationCase.expectedUnambiguousEntityId,
  ).length;
  const unambiguousEntityLinkAccuracy = ratio(
    correctlyLinked,
    unambiguousEntityCases.length,
  );
  const totalForbiddenDataLeakage = Object.values(byKind).reduce(
    (total, measurements) => total + measurements.forbiddenDataLeakage,
    0,
  );

  if (
    unambiguousEntityLinkAccuracy <
    input.thresholds.minimumUnambiguousEntityLinkAccuracy
  ) {
    failedThresholds.push(
      `unambiguous entity-link accuracy ${fixed(unambiguousEntityLinkAccuracy)} < ${fixed(input.thresholds.minimumUnambiguousEntityLinkAccuracy)}`,
    );
  }
  if (
    totalForbiddenDataLeakage >
    input.thresholds.maximumForbiddenDataLeakage
  ) {
    failedThresholds.push(
      `forbidden-data leakage ${totalForbiddenDataLeakage} > ${input.thresholds.maximumForbiddenDataLeakage}`,
    );
  }

  return immutableSnapshot({
    evaluationId: input.evaluationId,
    k: input.k,
    thresholds: input.thresholds,
    byKind,
    unambiguousEntityLinkAccuracy,
    totalForbiddenDataLeakage,
    passed: failedThresholds.length === 0,
    failedThresholds,
  });
};
