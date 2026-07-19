import {
  assembleNarrationEvidence,
  type EvidenceBundle,
} from "./evidence-bundle.js";
import {
  modelCallRecordFrom,
  type ModelCallRecordStore,
  type ModelGateway,
} from "./model-gateway.js";
import {
  hasExactKeys,
  immutableSnapshot,
  isRecord,
} from "./model-boundary.js";
import type {
  PresentationContext,
  PresentedText,
} from "./presentation.js";
import type {
  ApplicationView,
  CanonicalEvent,
  CheckTrace,
  OracleTrace,
} from "./structured-play.js";

interface NarrationSegment {
  readonly text: string;
  readonly evidenceItemIds: readonly string[];
}

interface GroundedNarration {
  readonly segments: readonly NarrationSegment[];
}

const hasStringArray = (
  value: Record<string, unknown>,
  key: string,
): boolean =>
  Array.isArray(value[key]) &&
  (value[key] as unknown[]).every((item) => typeof item === "string");

const isNarrationSegment = (value: unknown): value is NarrationSegment =>
  isRecord(value) &&
  hasExactKeys(value, ["text", "evidenceItemIds"]) &&
  typeof value.text === "string" &&
  value.text.trim().length > 0 &&
  hasStringArray(value, "evidenceItemIds") &&
  (value.evidenceItemIds as readonly string[]).length > 0;

const hasGroundedNarrationShape = (
  value: unknown,
): value is GroundedNarration =>
  isRecord(value) &&
  hasExactKeys(value, ["segments"]) &&
  Array.isArray(value.segments) &&
  value.segments.length > 0 &&
  value.segments.every(isNarrationSegment);

export const retainedNarrationText = (
  modelCallStore: ModelCallRecordStore,
  acceptedEvents: readonly CanonicalEvent[],
): readonly string[] => {
  const acceptedEventIds = new Set(acceptedEvents.map((event) => event.id));
  return modelCallStore.readAll().flatMap((record) => {
    if (
      record.taskType !== "narrate-committed-outcome" ||
      record.validation.status !== "accepted" ||
      record.acceptedEventIds.length === 0 ||
      !record.acceptedEventIds.every((id) => acceptedEventIds.has(id)) ||
      !hasGroundedNarrationShape(record.validatedOutput)
    ) {
      return [];
    }
    return [
      record.validatedOutput.segments
        .map((segment) => segment.text)
        .join(" "),
    ];
  });
};

const normalizedTokens = (value: string): readonly string[] =>
  value.toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? [];

const SAFE_NARRATIVE_FRAMING = new Set([
  "a",
  "an",
  "and",
  "answer",
  "as",
  "at",
  "by",
  "certain",
  "certainty",
  "clear",
  "clearly",
  "for",
  "from",
  "has",
  "in",
  "into",
  "is",
  "of",
  "on",
  "outcome",
  "quiet",
  "settled",
  "settles",
  "so",
  "stands",
  "the",
  "then",
  "this",
  "to",
  "was",
  "with",
]);

interface AcceptedNarrationClaim {
  readonly text: string;
  readonly evidenceItemId: string;
}

const acceptedClaimsFrom = (
  events: readonly CanonicalEvent[],
): readonly AcceptedNarrationClaim[] =>
  events.flatMap((event, index) => {
    const evidenceItemId = `event:committed:${index}`;
    if (event.type === "CheckResolved") {
      return [{ text: event.payload.committedStake.summary, evidenceItemId }];
    }
    if (event.type === "OracleAnswered") {
      return [
        { text: event.payload.establishedFact.text, evidenceItemId },
        ...(event.payload.trace.result.exceptionalConsequence === null
          ? []
          : [
              {
                text: event.payload.trace.result.exceptionalConsequence
                  .establishedFact.text,
                evidenceItemId,
              },
            ]),
      ];
    }
    if (event.type === "ConfrontationEnded") {
      return [
        { text: event.payload.ending.establishedFact.text, evidenceItemId },
      ];
    }
    if (event.type === "AdventureEnded") {
      return [{ text: event.payload.ending.text, evidenceItemId }];
    }
    return [];
  });

const claimsRemainWithin = (
  segment: NarrationSegment,
  evidenceBundle: EvidenceBundle,
  acceptedClaims: readonly AcceptedNarrationClaim[],
): boolean => {
  const evidenceById = new Map(
    evidenceBundle.items.map((item) => [item.id, item]),
  );
  const ids = segment.evidenceItemIds;
  if (
    new Set(ids).size !== ids.length ||
    !ids.every((id) => evidenceById.has(id))
  ) {
    return false;
  }
  const citedClaims = acceptedClaims.filter((claim) =>
    ids.includes(claim.evidenceItemId),
  );
  const lowerText = segment.text.toLocaleLowerCase("en");
  const anchoredClaims = citedClaims.filter((claim) =>
    lowerText.includes(claim.text.toLocaleLowerCase("en")),
  );
  if (anchoredClaims.length === 0) return false;
  const framing = anchoredClaims.reduce(
    (remaining, claim) =>
      remaining.replaceAll(claim.text.toLocaleLowerCase("en"), " "),
    lowerText,
  );
  return normalizedTokens(framing).every((token) =>
    SAFE_NARRATIVE_FRAMING.has(token),
  );
};

const validatedNarration = (
  value: unknown,
  evidenceBundle: EvidenceBundle,
  committedEvents: readonly CanonicalEvent[],
): GroundedNarration | null => {
  if (!hasGroundedNarrationShape(value)) return null;
  const acceptedClaims = acceptedClaimsFrom(committedEvents);
  return value.segments.every((segment) =>
    claimsRemainWithin(segment, evidenceBundle, acceptedClaims),
  )
    ? immutableSnapshot(value)
    : null;
};

const outcomeReferenceFrom = (trace: CheckTrace | OracleTrace): string =>
  `${trace.rule.id}@${trace.rule.version}:${
    "outcome" in trace.result ? trace.result.outcome : trace.result.answer
  }`;

export const narrateCommittedOutcomeThroughGateway = async ({
  gateway,
  modelCallStore,
  context,
  state,
  timeoutMs,
  evidenceBudget,
}: {
  readonly gateway: ModelGateway;
  readonly modelCallStore: ModelCallRecordStore;
  readonly context: PresentationContext;
  readonly state: ApplicationView["state"];
  readonly timeoutMs: number;
  readonly evidenceBudget?: number;
}): Promise<PresentedText> => {
  if (context.resolutionTrace === null) {
    return {
      source: "deterministic-fallback",
      text: context.deterministicSummary,
    };
  }
  const evidenceBundle = assembleNarrationEvidence({
    visibleEvidence: context.visibleEvidence,
    resolutionTrace: context.resolutionTrace,
    committedEvents: context.committedEvents,
    playerCharacter: state.playerCharacter,
    activeScene: state.activeScene,
    ...(evidenceBudget === undefined ? {} : { maxItems: evidenceBudget }),
  });
  const execution = await gateway.execute(
    immutableSnapshot({
      type: "narrate-committed-outcome" as const,
      input: { outcomeReference: outcomeReferenceFrom(context.resolutionTrace) },
      evidenceBundle,
    }),
    {
      timeoutMs,
      isStructurallyValid: hasGroundedNarrationShape,
    },
  );
  const narration =
    execution.outcome.status === "succeeded"
      ? validatedNarration(
          execution.outcome.output,
          evidenceBundle,
          context.committedEvents,
        )
      : null;
  modelCallStore.append(
    modelCallRecordFrom({
      execution,
      validation:
        narration === null
          ? {
              status: "rejected",
              reason:
                execution.outcome.status === "failed"
                  ? execution.outcome.reason
                  : "Every Narration segment must contain only claims supported by its cited Evidence Bundle items.",
            }
          : { status: "accepted" },
      validatedOutput: narration,
      command: null,
      acceptedEvents: context.committedEvents,
      fallbackOutcome:
        narration === null ? "deterministic-narration" : "none",
    }),
  );
  return narration === null
    ? {
        source: "deterministic-fallback",
        text: context.deterministicSummary,
      }
    : {
        source: "model",
        text: narration.segments.map((segment) => segment.text).join(" "),
      };
};
