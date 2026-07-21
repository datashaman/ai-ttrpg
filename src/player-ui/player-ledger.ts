import {
  assembleNarrationEvidence,
  type EvidenceBundle,
} from "../evidence-bundle.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type AcceptedResult,
  type CanonicalEvent,
  type CheckTrace,
  type OracleTrace,
} from "../structured-play.js";
import type { PlayerLedgerEntry } from "./application-client.js";

const resultEvent = <EventType extends CanonicalEvent["type"]>(
  result: AcceptedResult,
  type: EventType,
): Extract<CanonicalEvent, { readonly type: EventType }> | null =>
  (result.appendedEvents.find((event) => event.type === type) as
    | Extract<CanonicalEvent, { readonly type: EventType }>
    | undefined) ?? null;

interface DescribedOutcome {
  readonly eventId: string;
  readonly summary: string;
  readonly ruleReference: string | null;
  readonly calculation: string | null;
  readonly trace: CheckTrace | OracleTrace | null;
}

const describeOutcome = (result: AcceptedResult): DescribedOutcome | null => {
  const check = resultEvent(result, "CheckResolved");
  if (check !== null) {
    return {
      eventId: check.id,
      summary: `${check.payload.outcome}: ${check.payload.committedStake.summary}`,
      ruleReference: `${check.payload.trace.rule.id}@${check.payload.trace.rule.version}`,
      calculation: `${check.payload.trace.random.inputs.join(" + ")} + ${check.payload.trait} ${check.payload.trace.modifiers[0].value} = ${check.payload.adjustedTotal}`,
      trace: check.payload.trace,
    };
  }
  const oracle = resultEvent(result, "OracleAnswered");
  if (oracle !== null) {
    return {
      eventId: oracle.id,
      summary: `${oracle.payload.trace.result.answer} (${oracle.payload.trace.result.roll} ≤ ${oracle.payload.trace.result.yesThreshold}): ${oracle.payload.establishedFact.text}`,
      ruleReference: `${oracle.payload.trace.rule.id}@${oracle.payload.trace.rule.version}`,
      calculation: `${oracle.payload.trace.result.roll} ≤ ${oracle.payload.trace.result.yesThreshold}`,
      trace: oracle.payload.trace,
    };
  }
  const freeAction = resultEvent(result, "FreeActionCompleted");
  return freeAction === null
    ? null
    : {
        eventId: freeAction.id,
        summary: freeAction.payload.establishedFact.text,
        ruleReference: null,
        calculation: null,
        trace: null,
      };
};

export const playerLedgerEntryFor = ({
  result,
  actionLabel,
  fallbackEvidence,
  acceptedEvents,
  inputMode,
  interpretation,
}: {
  readonly result: AcceptedResult;
  readonly actionLabel: string;
  readonly fallbackEvidence: EvidenceBundle;
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly inputMode: PlayerLedgerEntry["inputMode"];
  readonly interpretation: PlayerLedgerEntry["interpretation"];
}): PlayerLedgerEntry | null => {
  const outcome = describeOutcome(result);
  if (outcome === null) return null;

  const evidence =
    outcome.trace === null
      ? fallbackEvidence
      : assembleNarrationEvidence({
          actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
          acceptedEvents,
          resolutionTrace: outcome.trace,
          committedEvents: result.appendedEvents,
          playerCharacter: result.state.playerCharacter,
          activeScene: result.state.activeScene,
        });
  return {
    id: outcome.eventId,
    status: "Committed",
    action: actionLabel,
    presentation: "Deterministic summary",
    narrationStatus: "Unavailable",
    inputMode,
    interpretation,
    summary: outcome.summary,
    mechanic: {
      ruleReference: outcome.ruleReference,
      calculation: outcome.calculation,
      evidenceBundle: {
        id: evidence.id,
        references: evidence.items.map((item) => item.sourceReference),
      },
    },
  };
};
