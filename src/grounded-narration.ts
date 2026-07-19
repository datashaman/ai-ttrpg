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
import type { ApplicationView } from "./structured-play.js";

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

const normalizedTokens = (value: string): readonly string[] =>
  value.toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? [];

const PROSE_GLUE = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "has",
  "in",
  "into",
  "is",
  "of",
  "on",
  "the",
  "then",
  "this",
  "to",
  "was",
  "with",
]);

const NEGATIONS = new Set(["never", "no", "not", "without"]);

const claimsRemainWithin = (
  segment: NarrationSegment,
  evidenceBundle: EvidenceBundle,
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
  const citedItems = ids.map((id) => evidenceById.get(id)!);
  if (
    !citedItems.some(
      (item) =>
        item.sourceKind === "accepted-event" ||
        item.sourceKind === "resolution",
    )
  ) {
    return false;
  }
  const supported = new Set(
    citedItems.flatMap((item) => normalizedTokens(item.content)),
  );
  return normalizedTokens(segment.text).every(
    (token) =>
      supported.has(token) ||
      (PROSE_GLUE.has(token) &&
        (!NEGATIONS.has(token) || supported.has(token))),
  );
};

const validatedNarration = (
  value: unknown,
  evidenceBundle: EvidenceBundle,
): GroundedNarration | null =>
  hasGroundedNarrationShape(value) &&
  value.segments.every((segment) =>
    claimsRemainWithin(segment, evidenceBundle),
  )
    ? immutableSnapshot(value)
    : null;

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
    deterministicSummary: context.deterministicSummary,
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
      input: { deterministicSummary: context.deterministicSummary },
      evidenceBundle,
    }),
    {
      timeoutMs,
      isStructurallyValid: hasGroundedNarrationShape,
    },
  );
  const narration =
    execution.outcome.status === "succeeded"
      ? validatedNarration(execution.outcome.output, evidenceBundle)
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
