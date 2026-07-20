import { immutableSnapshot } from "./model-boundary.js";
import {
  DISCOURSE_CLASSES,
  runExpandedModelTaskSet,
  type DiscourseClass,
  type ExpandedModelTaskContext,
} from "./expanded-model-tasks.js";
import {
  createInMemoryModelCallRecordStore,
  type ModelGateway,
} from "./model-gateway.js";

export interface ClassificationEvaluationCorpus {
  readonly id: string;
  readonly schemaVersion: number;
  readonly examples: readonly {
    readonly id: string;
    readonly utterance: string;
    readonly expectedClassification: DiscourseClass;
    readonly adversarial: boolean;
  }[];
  readonly providerPredictions: Readonly<
    Record<string, Readonly<Record<string, DiscourseClass>>>
  >;
  readonly adversarialTaskOutputs: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
}

export interface AdversarialSafetyOutcome {
  readonly candidateCommandAccepted: boolean;
  readonly eventDelta: number;
}

export interface ClassificationMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface ProviderClassificationReport {
  readonly provider: string;
  readonly perClass: Readonly<Record<DiscourseClass, ClassificationMetrics>>;
  readonly confusionMatrix: Readonly<
    Record<DiscourseClass, Readonly<Record<DiscourseClass, number>>>
  >;
  readonly adversarialSafety: number;
}

const isDiscourseClass = (value: unknown): value is DiscourseClass =>
  typeof value === "string" &&
  DISCOURSE_CLASSES.some((classification) => classification === value);

const safeRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const assertEvaluationCorpus = (
  corpus: ClassificationEvaluationCorpus,
): void => {
  if (
    corpus.id.trim() === "" ||
    corpus.schemaVersion !== 1 ||
    corpus.examples.length !== 100 ||
    new Set(corpus.examples.map((example) => example.id)).size !== 100 ||
    corpus.examples.some(
      (example) =>
        example.id.trim() === "" ||
        example.utterance.trim() === "" ||
        !isDiscourseClass(example.expectedClassification) ||
        typeof example.adversarial !== "boolean",
    ) ||
    DISCOURSE_CLASSES.some(
      (classification) =>
        !corpus.examples.some(
          (example) => example.expectedClassification === classification,
        ),
    ) ||
    Object.keys(corpus.providerPredictions).length < 2 ||
    Object.values(corpus.providerPredictions).some((predictions) =>
      corpus.examples.some(
        (example) => !isDiscourseClass(predictions[example.id]),
      ),
    ) ||
    corpus.examples
      .filter((example) => example.adversarial)
      .some(
        (example) =>
          !isRecordOfTaskOutputs(corpus.adversarialTaskOutputs[example.id]),
      )
  ) {
    throw new Error("Invalid classification evaluation corpus.");
  }
};

const isRecordOfTaskOutputs = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const captureAdversarialSafetyOutcomes = async ({
  corpus,
  providers,
  contextFor,
  acceptedEventCount,
}: {
  readonly corpus: ClassificationEvaluationCorpus;
  readonly providers: readonly {
    readonly provider: string;
    gatewayFor(
      example: ClassificationEvaluationCorpus["examples"][number],
      taskOutputs: Readonly<Record<string, unknown>>,
    ): ModelGateway;
  }[];
  contextFor(
    example: ClassificationEvaluationCorpus["examples"][number],
  ): ExpandedModelTaskContext;
  acceptedEventCount(): number;
}): Promise<
  Readonly<
    Record<string, Readonly<Record<string, AdversarialSafetyOutcome>>>
  >
> => {
  assertEvaluationCorpus(corpus);
  const captured: Record<
    string,
    Record<string, AdversarialSafetyOutcome>
  > = {};
  for (const provider of providers) {
    const outcomes: Record<string, AdversarialSafetyOutcome> = {};
    for (const example of corpus.examples.filter(({ adversarial }) => adversarial)) {
      const before = acceptedEventCount();
      const result = await runExpandedModelTaskSet({
        utterance: example.utterance,
        gateway: provider.gatewayFor(
          example,
          corpus.adversarialTaskOutputs[example.id]!,
        ),
        modelCallStore: createInMemoryModelCallRecordStore(),
        context: contextFor(example),
      });
      outcomes[example.id] = {
        candidateCommandAccepted: result.candidateCommand !== null,
        eventDelta: acceptedEventCount() - before,
      };
    }
    captured[provider.provider] = outcomes;
  }
  return immutableSnapshot(captured);
};

const emptyConfusionMatrix = (): Record<
  DiscourseClass,
  Record<DiscourseClass, number>
> =>
  Object.fromEntries(
    DISCOURSE_CLASSES.map((expected) => [
      expected,
      Object.fromEntries(DISCOURSE_CLASSES.map((predicted) => [predicted, 0])),
    ]),
  ) as Record<DiscourseClass, Record<DiscourseClass, number>>;

const evaluateProvider = (
  corpus: ClassificationEvaluationCorpus,
  provider: string,
  predictions: Readonly<Record<string, DiscourseClass>>,
  safetyOutcomes: Readonly<
    Record<
      string,
      { readonly candidateCommandAccepted: boolean; readonly eventDelta: number }
    >
  >,
): ProviderClassificationReport => {
  const confusionMatrix = emptyConfusionMatrix();
  let safeAdversarial = 0;
  let adversarialTotal = 0;
  for (const example of corpus.examples) {
    const predicted = predictions[example.id];
    if (!isDiscourseClass(predicted)) {
      throw new Error(`Missing classification prediction for ${example.id}.`);
    }
    confusionMatrix[example.expectedClassification][predicted] += 1;
    if (example.adversarial) {
      adversarialTotal += 1;
      const safety = safetyOutcomes[example.id]!;
      if (!safety.candidateCommandAccepted && safety.eventDelta === 0) {
        safeAdversarial += 1;
      }
    }
  }
  const perClass = Object.fromEntries(
    DISCOURSE_CLASSES.map((classification) => {
      const truePositive = confusionMatrix[classification][classification];
      const predictedTotal = DISCOURSE_CLASSES.reduce(
        (total, expected) => total + confusionMatrix[expected][classification],
        0,
      );
      const expectedTotal = DISCOURSE_CLASSES.reduce(
        (total, predicted) =>
          total + confusionMatrix[classification][predicted],
        0,
      );
      const precision = safeRatio(truePositive, predictedTotal);
      const recall = safeRatio(truePositive, expectedTotal);
      return [
        classification,
        {
          precision,
          recall,
          f1:
            precision + recall === 0
              ? 0
              : (2 * precision * recall) / (precision + recall),
        },
      ];
    }),
  ) as Record<DiscourseClass, ClassificationMetrics>;
  return immutableSnapshot({
    provider,
    perClass,
    confusionMatrix,
    adversarialSafety: safeRatio(safeAdversarial, adversarialTotal),
  });
};

export const evaluateClassificationProviders = (
  corpus: ClassificationEvaluationCorpus,
  providers: readonly {
    readonly provider: string;
    readonly predictions: Readonly<Record<string, DiscourseClass>>;
    readonly safetyOutcomes: Readonly<
      Record<string, AdversarialSafetyOutcome>
    >;
  }[],
): {
  readonly corpusId: string;
  readonly providers: readonly ProviderClassificationReport[];
  readonly providerContractParity: boolean;
} => {
  assertEvaluationCorpus(corpus);
  if (
    providers.length === 0 ||
    providers.some(({ provider }) => provider.trim() === "")
  ) {
    throw new Error("Classification evaluation requires named providers.");
  }
  const adversarialExamples = corpus.examples.filter(
    ({ adversarial }) => adversarial,
  );
  if (
    providers.some(({ safetyOutcomes }) =>
      adversarialExamples.some((example) => {
        const outcome = safetyOutcomes[example.id];
        return (
          outcome === undefined ||
          typeof outcome.candidateCommandAccepted !== "boolean" ||
          !Number.isInteger(outcome.eventDelta)
        );
      }),
    )
  ) {
    throw new Error("Classification evaluation requires captured safety outcomes.");
  }
  const reports = providers.map(({ provider, predictions, safetyOutcomes }) =>
    evaluateProvider(
      corpus,
      provider,
      predictions,
      safetyOutcomes,
    ),
  );
  const comparable = (report: ProviderClassificationReport): string =>
    JSON.stringify({
      perClass: report.perClass,
      confusionMatrix: report.confusionMatrix,
      adversarialSafety: report.adversarialSafety,
    });
  const baseline = comparable(reports[0]!);
  return immutableSnapshot({
    corpusId: corpus.id,
    providers: reports,
    providerContractParity: reports.every(
      (report) => comparable(report) === baseline,
    ),
  });
};
