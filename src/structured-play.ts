import { randomUUID } from "node:crypto";

import { createInMemoryEventStore } from "./in-memory-event-store.js";
import {
  DEFAULT_ADVENTURE_ENDINGS,
  DEFAULT_AUTHORED_WORLD_KNOWLEDGE,
  DEFAULT_CHECK_ACTIONS,
  DEFAULT_CONFRONTATION,
  DEFAULT_FREE_ACTIONS,
  DEFAULT_ORACLE_ACTIONS,
  DEFAULT_REVEALS,
  DEFAULT_SCENE_TRANSITIONS,
  FRESH_FOOTPRINTS,
} from "./locked-manor-content.js";
import {
  createSeededRandomSource,
  type RandomSource,
} from "./random-source.js";
import {
  filterCanonicalEventsVisibleTo,
  isPlayerCharacterRevealScope,
  projectWorldKnowledge,
  type KnowledgeScope,
  type WorldKnowledgeEstablishedPayload,
  type WorldKnowledgeRevealedPayload,
  validateWorldKnowledgeAppend,
  WorldKnowledgeError,
} from "./world-knowledge.js";

export { createInMemoryEventStore } from "./in-memory-event-store.js";
export { createInMemoryTimelineStore } from "./in-memory-timeline-store.js";
export { createSeededRandomSource } from "./random-source.js";
export type { RandomSource } from "./random-source.js";

export type Trait = "Might" | "Wits" | "Presence";
export type CheckOutcome = "Setback" | "Success with Cost" | "Clean Success";
export type Likelihood = "Unlikely" | "Even" | "Likely";
export type OracleAnswer = "Yes" | "No";
export type Health = 0 | 1 | 2 | 3;
export type Resolve = 0 | 1 | 2 | 3;
export type Resource = "Health" | "Resolve";
export type Scene = "arrival" | "discovery" | "confrontation" | "consequence";
export type Condition = "Shaken" | "Restrained";
export type ClockName = "Resistance" | "Danger";
export type InventoryItemName =
  | "Lantern"
  | "Lockpick Set"
  | "Short Blade"
  | "Field Kit";
export type InventoryItemState = "carried" | "removed";

export interface InventoryItem {
  readonly name: InventoryItemName;
  readonly state: InventoryItemState;
}

export type TraitRatings = Readonly<Record<Trait, 0 | 1 | 2>>;

export interface EstablishedFact {
  readonly id: string;
  readonly text: string;
}

export interface UnresolvedProposition {
  readonly id: string;
  readonly text: string;
  readonly answers: Readonly<Record<OracleAnswer, EstablishedFact>>;
  readonly exceptionalConsequences: Readonly<
    Record<ExceptionalConsequence["kind"], ExceptionalConsequence>
  >;
}

export interface NarratorLikelihoodRecommendation {
  readonly id: string;
  readonly proposition: UnresolvedProposition;
  readonly likelihood: Likelihood;
  readonly evidence: readonly EstablishedFact[];
}

export interface ExceptionalConsequence {
  readonly kind: "favourable" | "adverse";
  readonly establishedFact: EstablishedFact;
}

export interface OracleTrace {
  readonly rule: {
    readonly id: "micro-ruleset.oracle";
    readonly version: "1.0.0";
  };
  readonly random: {
    readonly source: string;
    readonly seed: number | null;
    readonly inputs: readonly [number];
  };
  readonly proposition: UnresolvedProposition;
  readonly recommendation: {
    readonly likelihood: Likelihood;
    readonly evidence: readonly EstablishedFact[];
  };
  readonly confirmedLikelihood: Likelihood;
  readonly result: {
    readonly roll: number;
    readonly yesThreshold: 25 | 50 | 75;
    readonly answer: OracleAnswer;
    readonly exceptionalConsequence: ExceptionalConsequence | null;
  };
}

export interface OracleResolution {
  readonly recommendationId: string;
  readonly establishedFact: EstablishedFact;
  readonly trace: OracleTrace;
}

export interface PlayerCharacter {
  readonly name: string;
  readonly pronouns: string;
  readonly motivation: string;
  readonly traits: TraitRatings;
  readonly health: Health;
  readonly resolve: Resolve;
  readonly inventory: readonly InventoryItem[];
}

export interface LoseHealthEffect {
  readonly type: "lose-health";
  readonly amount: 1;
}

export interface RemoveInventoryItemEffect {
  readonly type: "remove-inventory-item";
  readonly item: InventoryItemName;
  readonly reason: "loss" | "breakage" | "surrender" | "consumption";
}

export interface AddConditionEffect {
  readonly type: "add-condition";
  readonly condition: Condition;
}

export interface RemoveConditionEffect {
  readonly type: "remove-condition";
  readonly condition: "Restrained";
}

export interface AdvanceClockEffect {
  readonly type: "advance-clock";
  readonly clock: ClockName;
  readonly amount: 1;
}

export type MechanicalEffect =
  | LoseHealthEffect
  | RemoveInventoryItemEffect
  | AddConditionEffect
  | RemoveConditionEffect
  | AdvanceClockEffect;

export interface Clock {
  readonly current: number;
  readonly capacity: number;
  readonly fillingConsequence: EstablishedFact;
}

export interface ConfrontationEnding {
  readonly kind: "victory" | "defeat";
  readonly reason: "resistance" | "danger" | "health";
  readonly establishedFact: EstablishedFact;
}

export interface ConfrontationState {
  readonly id: string;
  readonly status: "active" | "victory" | "defeat";
  readonly resistanceClock: Clock;
  readonly dangerClock: Clock;
  readonly healthZeroConsequence: EstablishedFact;
  readonly defeatEffects: readonly MechanicalEffect[];
  readonly ending: ConfrontationEnding | null;
}

export interface ConfrontationDefinition {
  readonly id: string;
  readonly resistanceClock: {
    readonly capacity: number;
    readonly fillingConsequence: EstablishedFact;
  };
  readonly dangerClock: {
    readonly capacity: number;
    readonly fillingConsequence: EstablishedFact;
  };
  readonly healthZeroConsequence: EstablishedFact;
  readonly defeatEffects: readonly MechanicalEffect[];
}

export interface FictionalConsequence {
  readonly type: "establish-fact";
  readonly fact: EstablishedFact;
}

export type OutcomeConsequence = MechanicalEffect | FictionalConsequence;

export interface CheckStake {
  readonly summary: string;
  readonly consequences: readonly OutcomeConsequence[];
}

export interface CheckStakes {
  readonly Setback: CheckStake;
  readonly "Success with Cost": CheckStake;
  readonly "Clean Success": CheckStake;
}

export interface CheckProposal {
  readonly id: string;
  readonly actionId: string;
  readonly goal: string;
  readonly trait: Trait;
  readonly stakes: CheckStakes;
}

interface CheckRollEvidence {
  readonly rule: {
    readonly id: "micro-ruleset.check";
    readonly version: "1.0.0";
  };
  readonly random: {
    readonly source: string;
    readonly seed: number | null;
    readonly inputs: readonly [number, number];
  };
}

interface TraitModifier {
  readonly source: Trait;
  readonly value: 0 | 1 | 2;
}

interface ResolveModifier {
  readonly source: "Resolve";
  readonly value: 1;
}

export interface RevealedCheckRoll extends CheckRollEvidence {
  readonly modifiers: readonly [TraitModifier];
  readonly result: {
    readonly diceTotal: number;
    readonly total: number;
  };
}

export interface CheckTrace extends CheckRollEvidence {
  readonly modifiers:
    | readonly [TraitModifier]
    | readonly [TraitModifier, ResolveModifier];
  readonly result: {
    readonly diceTotal: number;
    readonly originalTotal: number;
    readonly total: number;
    readonly outcome: CheckOutcome;
  };
}

export interface CheckResolution {
  readonly proposalId: string;
  readonly actionId: string;
  readonly pendingChoiceId: string;
  readonly goal: string;
  readonly trait: Trait;
  readonly resolveSpent: 0 | 1;
  readonly adjustedTotal: number;
  readonly outcome: CheckOutcome;
  readonly committedStake: CheckStake;
  readonly resultingResolve: Resolve;
  readonly trace: CheckTrace;
}

export type ResolveChoice = "decline" | "spend-resolve";

export interface PendingChoice {
  readonly id: string;
  readonly type: "spend-resolve";
  readonly proposal: CheckProposal;
  readonly roll: RevealedCheckRoll;
  readonly availableChoices: readonly ResolveChoice[];
}

export interface GameState {
  readonly playerCharacter: PlayerCharacter | null;
  readonly activeScene: Scene | null;
  readonly confrontation: ConfrontationState | null;
  readonly conditions: readonly Condition[];
  readonly establishedFacts: readonly EstablishedFact[];
  readonly pendingCheckProposal: CheckProposal | null;
  readonly pendingChoice: PendingChoice | null;
  readonly lastCheckResolution: CheckResolution | null;
  readonly pendingNarratorRecommendation: NarratorLikelihoodRecommendation | null;
  readonly lastOracleResolution: OracleResolution | null;
  readonly resolvedPropositionIds: readonly string[];
  readonly resolvedCheckActionIds: readonly string[];
  readonly resolvedFreeActionIds: readonly string[];
  readonly adventureEnding: AdventureEnding | null;
}

export interface AdventureEnding {
  readonly id: string;
  readonly kind: "favourable" | "adverse" | "unresolved";
  readonly text: string;
}

const endingAdverb = (kind: AdventureEnding["kind"]): string =>
  kind === "favourable"
    ? "favourably"
    : kind === "adverse"
      ? "adversely"
      : "unresolved";

interface EventEnvelope<EventType extends string, Payload> {
  readonly id: string;
  readonly streamId: "adventure";
  readonly sequence: number;
  readonly type: EventType;
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly origin: "structured-play";
  readonly correlationId: string;
  readonly causationId: string;
  readonly payload: Payload;
}

interface EventPayloads {
  readonly PlayerCharacterConfigured: PlayerCharacter;
  readonly SceneStarted: { readonly scene: Scene };
  readonly WorldKnowledgeEstablished: WorldKnowledgeEstablishedPayload;
  readonly WorldKnowledgeRevealed: WorldKnowledgeRevealedPayload;
  readonly SceneTransitioned: {
    readonly from: Scene;
    readonly to: Scene;
  };
  readonly ConfrontationStarted: {
    readonly definition: ConfrontationDefinition;
  };
  readonly FreeActionCompleted: {
    readonly actionId: string;
    readonly establishedFact: EstablishedFact;
  };
  readonly AdventureEnded: {
    readonly from: Scene;
    readonly ending: AdventureEnding;
  };
  readonly CheckProposalCreated: { readonly proposal: CheckProposal };
  readonly CheckProposalReplaced: {
    readonly supersededProposalId: string;
    readonly proposal: CheckProposal;
    readonly reason: "correction" | "revised-action";
  };
  readonly CheckProposalWithdrawn: { readonly proposalId: string };
  readonly CheckRollRevealed: { readonly pendingChoice: PendingChoice };
  readonly CheckResolved: CheckResolution;
  readonly ConfrontationEnded: {
    readonly confrontationId: string;
    readonly ending: ConfrontationEnding;
    readonly effects: readonly MechanicalEffect[];
    readonly nextScene: "consequence" | null;
  };
  readonly FieldKitUsed: {
    readonly item: "Field Kit";
    readonly removalReason: "consumption";
    readonly resource: Resource;
    readonly restored: 1;
    readonly resultingValue: Health | Resolve;
  };
  readonly NarratorLikelihoodRecommended: {
    readonly recommendation: NarratorLikelihoodRecommendation;
  };
  readonly OracleAnswered: OracleResolution;
}

export type CanonicalEvent = {
  readonly [EventType in keyof EventPayloads]: EventEnvelope<
    EventType,
    EventPayloads[EventType]
  >;
}[keyof EventPayloads];

export interface ConfigurePlayerCharacter {
  readonly type: "configure-player-character";
  readonly name: string;
  readonly pronouns: string;
  readonly motivation: string;
  readonly traits: TraitRatings;
}

export interface BeginAdventure {
  readonly type: "begin-adventure";
}

export interface ChooseAction {
  readonly type: "choose-action";
  readonly actionId: string;
}

export interface ConfirmCheckProposal {
  readonly type: "confirm-check-proposal";
  readonly proposalId: string;
}

export interface ResolvePendingCheck {
  readonly type: "resolve-pending-check";
  readonly pendingChoiceId: string;
  readonly choice: ResolveChoice;
}

export interface CorrectCheckProposal {
  readonly type: "correct-check-proposal";
  readonly proposalId: string;
  readonly goal: string;
  readonly trait: Trait;
}

export interface ReviseCheckAction {
  readonly type: "revise-check-action";
  readonly proposalId: string;
  readonly actionId: string;
}

export interface WithdrawCheckProposal {
  readonly type: "withdraw-check-proposal";
  readonly proposalId: string;
}

export interface AmendCheckStakes {
  readonly type: "amend-check-stakes";
  readonly proposalId: string;
  readonly stakes: CheckStakes;
}

export interface RecommendLikelihood {
  readonly type: "recommend-likelihood";
  readonly proposition: UnresolvedProposition;
  readonly likelihood: Likelihood;
  readonly supportingFactIds: readonly string[];
}

export interface ConfirmOracleLikelihood {
  readonly type: "confirm-oracle-likelihood";
  readonly recommendationId: string;
  readonly likelihood: Likelihood;
}

export interface UseFieldKit {
  readonly type: "use-field-kit";
  readonly resource: Resource;
}

export interface TransitionScene {
  readonly type: "transition-scene";
  readonly scene: Exclude<Scene, "arrival">;
}

export interface BranchTimeline {
  readonly type: "branch-timeline";
  readonly eventPosition: number;
}

export interface SelectTimeline {
  readonly type: "select-timeline";
  readonly timelineId: string;
}

export interface SceneTransitionDefinition {
  readonly from: Scene;
  readonly to: Scene;
  readonly requiredFactIds: readonly string[];
  readonly automatic?: boolean;
}

export type StructuredPlayInput =
  | ConfigurePlayerCharacter
  | BeginAdventure
  | ChooseAction
  | ConfirmCheckProposal
  | ResolvePendingCheck
  | CorrectCheckProposal
  | ReviseCheckAction
  | WithdrawCheckProposal
  | AmendCheckStakes
  | RecommendLikelihood
  | ConfirmOracleLikelihood
  | UseFieldKit
  | TransitionScene
  | BranchTimeline
  | SelectTimeline;

export interface FreeAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "Free Action";
}

export interface FreeActionDefinition extends FreeAction {
  readonly establishedFact: EstablishedFact;
  readonly availableInScenes: readonly Scene[];
  readonly requiredFactIds: readonly string[];
}

export interface RevealAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "Reveal";
}

export interface RevealDefinition extends RevealAction {
  readonly worldKnowledgeId: string;
  readonly availableInScenes: readonly Scene[];
  readonly requiredFactIds: readonly string[];
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export interface AdventureEndingDefinition {
  readonly from: Scene;
  readonly requiredFactIds: readonly string[];
  readonly ending: AdventureEnding;
}

const SURVEY_MANOR_ACTION: FreeActionDefinition = {
  id: "survey-manor",
  label: "Survey the manor grounds",
  kind: "Free Action",
  establishedFact: FRESH_FOOTPRINTS,
  availableInScenes: ["arrival"],
  requiredFactIds: [],
};

export interface CheckAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "Check";
}

export interface OracleAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "Oracle";
}

export interface RecoveryAction {
  readonly id: "use-field-kit-health" | "use-field-kit-resolve";
  readonly label: string;
  readonly kind: "Recovery";
  readonly resource: Resource;
}

export interface SceneTransitionAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "Scene Transition";
  readonly scene: Exclude<Scene, "arrival">;
}

export interface TimelineBranchAction {
  readonly id: "branch-timeline";
  readonly label: "Branch from an accepted event";
  readonly kind: "Timeline Branch";
}

export interface TimelineSelectionAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "Timeline Selection";
  readonly timelineId: string;
}

export type AvailableAction =
  | FreeAction
  | RevealAction
  | CheckAction
  | OracleAction
  | RecoveryAction
  | SceneTransitionAction
  | TimelineBranchAction
  | TimelineSelectionAction;

export interface CheckActionDefinition extends CheckAction {
  readonly goal: string;
  readonly trait: Trait;
  readonly stakes: CheckStakes;
  readonly requiredItem?: InventoryItemName;
  readonly requiresFreeMovement?: boolean;
  readonly availableInScenes?: readonly Scene[];
  readonly repeatable?: boolean;
}

export interface OracleActionDefinition extends OracleAction {
  readonly proposition: UnresolvedProposition;
  readonly recommendedLikelihood: Likelihood;
  readonly supportingFactIds: readonly string[];
}

export interface AcceptedResult {
  readonly status: "accepted";
  readonly message: string;
  readonly state: GameState;
  readonly availableActions: readonly AvailableAction[];
  readonly timeline: TimelineCollectionView | null;
  readonly appendedEvents: readonly CanonicalEvent[];
}

export interface RejectedResult {
  readonly status: "rejected";
  readonly code:
    | "invalid-identity"
    | "invalid-trait-assignment"
    | "action-unavailable"
    | "player-character-already-configured"
    | "player-character-required"
    | "check-proposal-unavailable"
    | "pending-choice-unavailable"
    | "resolve-unavailable"
    | "invalid-check-correction"
    | "check-stakes-immutable"
    | "invalid-likelihood-recommendation"
    | "likelihood-recommendation-unavailable"
    | "field-kit-unavailable"
    | "scene-transition-unavailable"
    | "action-requires-free-movement"
    | "timeline-unavailable"
    | "invalid-timeline-position"
    | "write-conflict"
    | "idempotency-conflict"
    | "invalid-write-batch"
    | "invalid-world-knowledge"
    | "persistence-failed";
  readonly message: string;
  readonly state: GameState;
  readonly availableActions: readonly AvailableAction[];
  readonly timeline: TimelineCollectionView | null;
  readonly appendedEvents: readonly [];
}

export interface ApplicationView {
  readonly state: GameState;
  readonly availableActions: readonly AvailableAction[];
  readonly timeline: TimelineCollectionView | null;
}

export interface EventStore {
  readAll(): readonly CanonicalEvent[];
  append(event: CanonicalEvent): void;
  appendBatch?(request: EventBatchRequest): EventBatchResult;
}

export interface EventBatchRequest {
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly events: readonly CanonicalEvent[];
}

export type EventBatchResult =
  | {
      readonly status: "accepted" | "replayed";
      readonly events: readonly CanonicalEvent[];
      readonly actualPosition: number;
    }
  | {
      readonly status: "rejected";
      readonly code:
        | "stale-position"
        | "idempotency-conflict"
        | "invalid-batch"
        | "persistence-failed";
      readonly message: string;
      readonly expectedPosition: number;
      readonly actualPosition: number;
    };

export interface BatchEventStore extends EventStore {
  appendBatch(request: EventBatchRequest): EventBatchResult;
}

export interface TimelineSummary {
  readonly id: string;
  readonly parentTimelineId: string | null;
  readonly branchEventPosition: number | null;
  readonly eventCount: number;
  readonly randomPosition: number;
}

export interface TimelineCollectionView {
  readonly activeTimelineId: string;
  readonly activeTimeline: TimelineSummary;
  readonly timelines: readonly TimelineSummary[];
  readonly acceptedEvents: readonly TimelineEventSummary[];
}

export interface TimelineEventSummary {
  readonly position: number;
  readonly type: CanonicalEvent["type"];
}

export interface TimelineStore extends BatchEventStore, RandomSource {
  view(): TimelineCollectionView;
  readTimeline(timelineId: string): readonly CanonicalEvent[];
  branchTimeline(eventPosition: number): TimelineSummary;
  selectTimeline(timelineId: string): boolean;
}

export interface StructuredPlayApplication {
  submit(input: StructuredPlayInput): AcceptedResult | RejectedResult;
  view(): ApplicationView;
}

export interface StructuredPlayOptions {
  readonly eventStore?: EventStore;
  readonly randomSource?: RandomSource;
  readonly checkActions?: readonly CheckActionDefinition[];
  readonly oracleActions?: readonly OracleActionDefinition[];
  readonly sceneTransitions?: readonly SceneTransitionDefinition[];
  readonly confrontation?: ConfrontationDefinition;
  readonly freeActions?: readonly FreeActionDefinition[];
  readonly adventureEndings?: readonly AdventureEndingDefinition[];
  readonly authoredWorldKnowledge?: readonly WorldKnowledgeEstablishedPayload[];
  readonly reveals?: readonly RevealDefinition[];
  readonly timelineStore?: TimelineStore;
}

const STARTING_INVENTORY: readonly InventoryItem[] = [
  { name: "Lantern", state: "carried" },
  { name: "Lockpick Set", state: "carried" },
  { name: "Short Blade", state: "carried" },
  { name: "Field Kit", state: "carried" },
];

const initialState = (): GameState => ({
  playerCharacter: null,
  activeScene: null,
  confrontation: null,
  conditions: [],
  establishedFacts: [],
  pendingCheckProposal: null,
  pendingChoice: null,
  lastCheckResolution: null,
  pendingNarratorRecommendation: null,
  lastOracleResolution: null,
  resolvedPropositionIds: [],
  resolvedCheckActionIds: [],
  resolvedFreeActionIds: [],
  adventureEnding: null,
});

const isTrait = (value: unknown): value is Trait =>
  value === "Might" || value === "Wits" || value === "Presence";

const isLikelihood = (value: unknown): value is Likelihood =>
  value === "Unlikely" || value === "Even" || value === "Likely";

const isInventoryItemName = (value: unknown): value is InventoryItemName =>
  value === "Lantern" ||
  value === "Lockpick Set" ||
  value === "Short Blade" ||
  value === "Field Kit";

const isCondition = (value: unknown): value is Condition =>
  value === "Shaken" || value === "Restrained";

const isCarrying = (
  playerCharacter: PlayerCharacter | null,
  itemName: InventoryItemName,
): boolean =>
  playerCharacter?.inventory.some(
    (item) => item.name === itemName && item.state === "carried",
  ) ?? false;

const validateEstablishedFact = (fact: unknown): fact is EstablishedFact => {
  if (typeof fact !== "object" || fact === null) return false;
  const candidate = fact as Partial<EstablishedFact>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim() !== "" &&
    typeof candidate.text === "string" &&
    candidate.text.trim() !== ""
  );
};

const validateUnresolvedProposition = (
  proposition: unknown,
): proposition is UnresolvedProposition => {
  if (typeof proposition !== "object" || proposition === null) return false;
  const candidate = proposition as Partial<UnresolvedProposition>;
  const isStructurallyValid =
    typeof candidate.id === "string" &&
    candidate.id.trim() !== "" &&
    typeof candidate.text === "string" &&
    candidate.text.trim() !== "" &&
    validateEstablishedFact(candidate.answers?.Yes) &&
    validateEstablishedFact(candidate.answers?.No) &&
    candidate.answers.Yes.id !== candidate.answers.No.id &&
    candidate.exceptionalConsequences?.favourable?.kind === "favourable" &&
    validateEstablishedFact(
      candidate.exceptionalConsequences.favourable.establishedFact,
    ) &&
    candidate.exceptionalConsequences?.adverse?.kind === "adverse" &&
    validateEstablishedFact(
      candidate.exceptionalConsequences.adverse.establishedFact,
    );
  if (!isStructurallyValid) return false;
  const factIds = [
    candidate.answers.Yes.id,
    candidate.answers.No.id,
    candidate.exceptionalConsequences.favourable.establishedFact.id,
    candidate.exceptionalConsequences.adverse.establishedFact.id,
  ];
  return new Set(factIds).size === factIds.length;
};

const oracleEstablishedFactsFor = (
  proposition: UnresolvedProposition,
): readonly EstablishedFact[] => [
  ...Object.values(proposition.answers),
  ...Object.values(proposition.exceptionalConsequences).map(
    (consequence) => consequence.establishedFact,
  ),
];

const validateOutcomeConsequence = (
  consequence: unknown,
): consequence is OutcomeConsequence => {
  if (typeof consequence !== "object" || consequence === null) return false;
  const candidate = consequence as Partial<OutcomeConsequence>;
  if (candidate.type === "lose-health") {
    return (candidate as Partial<LoseHealthEffect>).amount === 1;
  }
  if (candidate.type === "remove-inventory-item") {
    const effect = candidate as Partial<RemoveInventoryItemEffect>;
    return (
      isInventoryItemName(effect.item) &&
      (effect.reason === "loss" ||
        effect.reason === "breakage" ||
        effect.reason === "surrender" ||
        effect.reason === "consumption")
    );
  }
  if (candidate.type === "add-condition") {
    return isCondition((candidate as Partial<AddConditionEffect>).condition);
  }
  if (candidate.type === "remove-condition") {
    return (
      (candidate as Partial<RemoveConditionEffect>).condition === "Restrained"
    );
  }
  if (candidate.type === "advance-clock") {
    const effect = candidate as Partial<AdvanceClockEffect>;
    return (
      (effect.clock === "Resistance" || effect.clock === "Danger") &&
      effect.amount === 1
    );
  }
  if (candidate.type === "establish-fact") {
    const fact = (candidate as Partial<FictionalConsequence>).fact;
    return (
      typeof fact?.id === "string" &&
      fact.id.trim() !== "" &&
      typeof fact.text === "string" &&
      fact.text.trim() !== ""
    );
  }
  return false;
};

const validateCheckAction = (action: CheckActionDefinition): void => {
  if (
    typeof action.id !== "string" ||
    action.id.trim() === "" ||
    typeof action.label !== "string" ||
    action.label.trim() === "" ||
    typeof action.goal !== "string" ||
    action.goal.trim() === "" ||
    !isTrait(action.trait)
  ) {
    throw new Error(`Invalid Check action definition: ${action.id || "<unknown>"}.`);
  }
  if (
    (action.requiredItem !== undefined &&
      !isInventoryItemName(action.requiredItem)) ||
    (action.requiresFreeMovement !== undefined &&
      typeof action.requiresFreeMovement !== "boolean") ||
    (action.availableInScenes !== undefined &&
      (action.availableInScenes.length === 0 ||
        new Set(action.availableInScenes).size !==
          action.availableInScenes.length)) ||
    (action.repeatable !== undefined && typeof action.repeatable !== "boolean")
  ) {
    throw new Error(`Invalid Check action permission: ${action.id}.`);
  }

  const outcomes: readonly CheckOutcome[] = [
    "Setback",
    "Success with Cost",
    "Clean Success",
  ];
  for (const outcome of outcomes) {
    const stake = action.stakes?.[outcome];
    const isConfrontationAction =
      action.availableInScenes?.includes("confrontation") === true;
    const hasClockEffect =
      Array.isArray(stake?.consequences) &&
      stake.consequences.some(
        (consequence) => consequence?.type === "advance-clock",
      );
    if (
      stake === undefined ||
      typeof stake.summary !== "string" ||
      stake.summary.trim() === "" ||
      !Array.isArray(stake.consequences) ||
      !stake.consequences.every(validateOutcomeConsequence) ||
      (outcome === "Setback" &&
        stake.consequences.some(
          (consequence) =>
            consequence.type === "remove-condition" &&
            consequence.condition === "Restrained",
        )) ||
      (isConfrontationAction &&
        !stake.consequences.some(
          (consequence) => consequence.type !== "establish-fact",
        )) ||
      (!isConfrontationAction &&
        stake.consequences.some(
          (consequence) => consequence.type === "advance-clock",
        )) ||
      (hasClockEffect === true &&
        (action.availableInScenes?.length !== 1 ||
          action.availableInScenes[0] !== "confrontation"))
    ) {
      throw new Error(
        `Invalid Outcome Consequence or stake for ${action.id} (${outcome}).`,
      );
    }
  }
};

const validateConfrontation = (
  confrontation: ConfrontationDefinition,
): void => {
  const validClock = (clock: ConfrontationDefinition["resistanceClock"]) =>
    Number.isInteger(clock.capacity) &&
    clock.capacity > 0 &&
    validateEstablishedFact(clock.fillingConsequence);
  if (
    confrontation.id.trim() === "" ||
    !validClock(confrontation.resistanceClock) ||
    !validClock(confrontation.dangerClock) ||
    !validateEstablishedFact(confrontation.healthZeroConsequence) ||
    !confrontation.defeatEffects.every(validateOutcomeConsequence) ||
    confrontation.defeatEffects.some(
      (effect) => effect.type === "advance-clock",
    )
  ) {
    throw new Error(`Invalid Confrontation definition: ${confrontation.id}.`);
  }
};

const validateOracleAction = (action: OracleActionDefinition): void => {
  if (
    typeof action.id !== "string" ||
    action.id.trim() === "" ||
    typeof action.label !== "string" ||
    action.label.trim() === "" ||
    action.kind !== "Oracle" ||
    !validateUnresolvedProposition(action.proposition) ||
    !isLikelihood(action.recommendedLikelihood) ||
    new Set(action.supportingFactIds).size !== action.supportingFactIds.length
  ) {
    throw new Error(`Invalid Oracle action definition: ${action.id || "<unknown>"}.`);
  }
};

const validateFreeAction = (action: FreeActionDefinition): void => {
  if (
    action.id.trim() === "" ||
    action.label.trim() === "" ||
    action.kind !== "Free Action" ||
    !validateEstablishedFact(action.establishedFact) ||
    action.availableInScenes.length === 0 ||
    new Set(action.availableInScenes).size !== action.availableInScenes.length ||
    new Set(action.requiredFactIds).size !== action.requiredFactIds.length ||
    action.requiredFactIds.some((factId) => factId.trim() === "")
  ) {
    throw new Error(`Invalid Free Action definition: ${action.id || "<unknown>"}.`);
  }
};

const validateReveal = (reveal: RevealDefinition): void => {
  if (
    reveal.id.trim() === "" ||
    reveal.label.trim() === "" ||
    reveal.kind !== "Reveal" ||
    reveal.worldKnowledgeId.trim() === "" ||
    reveal.availableInScenes.length === 0 ||
    new Set(reveal.availableInScenes).size !== reveal.availableInScenes.length ||
    new Set(reveal.requiredFactIds).size !== reveal.requiredFactIds.length ||
    reveal.requiredFactIds.some((factId) => factId.trim() === "") ||
    !isPlayerCharacterRevealScope(reveal.knowledgeScope)
  ) {
    throw new Error(`Invalid Reveal definition: ${reveal.id || "<unknown>"}.`);
  }
};

const validateAdventureEnding = (
  definition: AdventureEndingDefinition,
): void => {
  if (
    definition.requiredFactIds.length === 0 ||
    new Set(definition.requiredFactIds).size !==
      definition.requiredFactIds.length ||
    definition.requiredFactIds.some((factId) => factId.trim() === "") ||
    definition.ending.id.trim() === "" ||
    definition.ending.text.trim() === "" ||
    !["favourable", "adverse", "unresolved"].includes(
      definition.ending.kind,
    )
  ) {
    throw new Error(
      `Invalid Adventure ending definition: ${definition.ending.id || "<unknown>"}.`,
    );
  }
};

const validateSceneTransition = (
  transition: SceneTransitionDefinition,
): void => {
  if (
    transition.from === transition.to ||
    transition.to === "arrival" ||
    transition.requiredFactIds.length === 0 ||
    new Set(transition.requiredFactIds).size !==
      transition.requiredFactIds.length ||
    transition.requiredFactIds.some((factId) => factId.trim() === "") ||
    (transition.automatic !== undefined &&
      typeof transition.automatic !== "boolean")
  ) {
    throw new Error(
      `Invalid Scene transition definition: ${transition.from} -> ${transition.to}.`,
    );
  }
};

const requiredFactsAreEstablished = (
  requiredFactIds: readonly string[],
  state: GameState,
): boolean =>
  requiredFactIds.every((factId) =>
    state.establishedFacts.some((fact) => fact.id === factId),
  );

const transitionIsSatisfied = (
  transition: SceneTransitionDefinition,
  state: GameState,
): boolean =>
  transition.from === state.activeScene &&
  requiredFactsAreEstablished(transition.requiredFactIds, state);

const checkActionRejectionCode = (
  action: CheckActionDefinition,
  state: GameState,
): "action-unavailable" | "action-requires-free-movement" | null => {
  if (
    (state.resolvedCheckActionIds.includes(action.id) &&
      action.repeatable !== true) ||
    (state.activeScene === "confrontation" &&
      action.availableInScenes?.includes("confrontation") !== true) ||
    (action.availableInScenes !== undefined &&
      (state.activeScene === null ||
        !action.availableInScenes.includes(state.activeScene))) ||
    (action.requiredItem !== undefined &&
      !isCarrying(state.playerCharacter, action.requiredItem))
  ) {
    return "action-unavailable";
  }
  if (
    action.requiresFreeMovement === true &&
    state.conditions.includes("Restrained")
  ) {
    return "action-requires-free-movement";
  }
  return null;
};

const availableActionsFor = (
  state: GameState,
  checkActions: readonly CheckActionDefinition[],
  oracleActions: readonly OracleActionDefinition[],
  sceneTransitions: readonly SceneTransitionDefinition[],
  freeActions: readonly FreeActionDefinition[],
): readonly AvailableAction[] => {
  if (
    state.activeScene === null ||
    state.pendingCheckProposal !== null ||
    state.pendingChoice !== null ||
    state.pendingNarratorRecommendation !== null
  ) {
    return [];
  }

  const actions: AvailableAction[] = [];
  if (
    state.activeScene === "arrival" &&
    !state.establishedFacts.some((fact) => fact.id === FRESH_FOOTPRINTS.id)
  ) {
    actions.push({
      id: SURVEY_MANOR_ACTION.id,
      label: SURVEY_MANOR_ACTION.label,
      kind: SURVEY_MANOR_ACTION.kind,
    });
  }
  actions.push(
    ...checkActions
      .filter((action) => checkActionRejectionCode(action, state) === null)
      .map(({ id, label, kind }) => ({ id, label, kind })),
  );
  if (oracleActions.some(
    (action) => !state.resolvedPropositionIds.includes(action.proposition.id),
  )) {
    actions.push(
      ...oracleActions
        .filter(
          (action) =>
            !state.resolvedPropositionIds.includes(action.proposition.id),
        )
        .filter((action) =>
          requiredFactsAreEstablished(action.supportingFactIds, state),
        )
        .map(({ id, label, kind }) => ({ id, label, kind })),
    );
  }
  actions.push(
    ...freeActions
      .filter(
        (action) =>
          !state.resolvedFreeActionIds.includes(action.id) &&
          state.activeScene !== null &&
          action.availableInScenes.includes(state.activeScene) &&
          requiredFactsAreEstablished(action.requiredFactIds, state),
      )
      .map(({ id, label, kind }) => ({ id, label, kind })),
  );
  const playerCharacter = state.playerCharacter;
  if (
    playerCharacter !== null &&
    state.activeScene !== "confrontation" &&
    isCarrying(playerCharacter, "Field Kit")
  ) {
    if (playerCharacter.health < 3) {
      actions.push({
        id: "use-field-kit-health",
        label: "Use the Field Kit to restore 1 Health",
        kind: "Recovery",
        resource: "Health",
      });
    }
    if (playerCharacter.resolve < 3) {
      actions.push({
        id: "use-field-kit-resolve",
        label: "Use the Field Kit to restore 1 Resolve",
        kind: "Recovery",
        resource: "Resolve",
      });
    }
  }
  actions.push(
    ...sceneTransitions
      .filter((transition) => transitionIsSatisfied(transition, state))
      .map((transition) => ({
        id: `transition-${transition.from}-to-${transition.to}`,
        label: `Continue to the ${transition.to} Scene`,
        kind: "Scene Transition" as const,
        scene: transition.to as Exclude<Scene, "arrival">,
      })),
  );
  return actions;
};

const applyConsequences = (
  state: GameState,
  consequences: readonly OutcomeConsequence[],
): GameState =>
  consequences.reduce<GameState>((nextState, consequence) => {
    if (consequence.type === "establish-fact") {
      return nextState.establishedFacts.some(
        (fact) => fact.id === consequence.fact.id,
      )
        ? nextState
        : {
            ...nextState,
            establishedFacts: [
              ...nextState.establishedFacts,
              consequence.fact,
            ],
          };
    }
    if (consequence.type === "add-condition") {
      return nextState.conditions.includes(consequence.condition)
        ? nextState
        : {
            ...nextState,
            conditions: [...nextState.conditions, consequence.condition],
          };
    }
    if (consequence.type === "remove-condition") {
      return {
        ...nextState,
        conditions: nextState.conditions.filter(
          (condition) => condition !== consequence.condition,
        ),
      };
    }
    if (consequence.type === "advance-clock") {
      const confrontation = nextState.confrontation;
      if (confrontation === null || confrontation.status !== "active") {
        return nextState;
      }
      const clockKey =
        consequence.clock === "Resistance"
          ? "resistanceClock"
          : "dangerClock";
      const clock = confrontation[clockKey];
      return {
        ...nextState,
        confrontation: {
          ...confrontation,
          [clockKey]: {
            ...clock,
            current: Math.min(clock.capacity, clock.current + consequence.amount),
          },
        },
      };
    }
    const playerCharacter = nextState.playerCharacter;
    if (playerCharacter === null) return nextState;
    if (consequence.type === "remove-inventory-item") {
      return {
        ...nextState,
        playerCharacter: {
          ...playerCharacter,
          inventory: playerCharacter.inventory.map((item) =>
            item.name === consequence.item ? { ...item, state: "removed" } : item,
          ),
        },
      };
    }
    const health = Math.max(0, playerCharacter.health - consequence.amount) as Health;
    return {
      ...nextState,
      playerCharacter: { ...playerCharacter, health },
    };
  }, state);

const project = (events: readonly CanonicalEvent[]): GameState =>
  events.reduce<GameState>((state, event) => {
    switch (event.type) {
      case "PlayerCharacterConfigured":
        return { ...state, playerCharacter: event.payload };
      case "SceneStarted":
        return { ...state, activeScene: event.payload.scene };
      case "WorldKnowledgeEstablished":
      case "WorldKnowledgeRevealed":
        return state;
      case "SceneTransitioned":
        return {
          ...state,
          activeScene: event.payload.to,
          conditions: state.conditions.filter(
            (condition) => condition !== "Shaken",
          ),
        };
      case "ConfrontationStarted":
        return {
          ...state,
          confrontation: {
            id: event.payload.definition.id,
            status: "active",
            resistanceClock: {
              current: 0,
              capacity: event.payload.definition.resistanceClock.capacity,
              fillingConsequence:
                event.payload.definition.resistanceClock.fillingConsequence,
            },
            dangerClock: {
              current: 0,
              capacity: event.payload.definition.dangerClock.capacity,
              fillingConsequence:
                event.payload.definition.dangerClock.fillingConsequence,
            },
            healthZeroConsequence:
              event.payload.definition.healthZeroConsequence,
            defeatEffects: event.payload.definition.defeatEffects,
            ending: null,
          },
        };
      case "FreeActionCompleted":
        return {
          ...applyConsequences(state, [
            { type: "establish-fact", fact: event.payload.establishedFact },
          ]),
          resolvedFreeActionIds: state.resolvedFreeActionIds.includes(
            event.payload.actionId,
          )
            ? state.resolvedFreeActionIds
            : [...state.resolvedFreeActionIds, event.payload.actionId],
        };
      case "AdventureEnded":
        return {
          ...state,
          activeScene: null,
          adventureEnding: event.payload.ending,
          conditions: state.conditions.filter(
            (condition) => condition !== "Shaken",
          ),
        };
      case "CheckProposalCreated":
        return { ...state, pendingCheckProposal: event.payload.proposal };
      case "CheckProposalReplaced":
        return { ...state, pendingCheckProposal: event.payload.proposal };
      case "CheckProposalWithdrawn":
        return { ...state, pendingCheckProposal: null };
      case "CheckRollRevealed":
        return {
          ...state,
          pendingCheckProposal: null,
          pendingChoice: event.payload.pendingChoice,
        };
      case "CheckResolved":
        const playerCharacter = state.playerCharacter;
        const stateWithResolve =
          playerCharacter === null
            ? state
            : {
                ...state,
                playerCharacter: {
                  ...playerCharacter,
                  resolve: event.payload.resultingResolve,
                },
              };
        return {
          ...applyConsequences(
            stateWithResolve,
            event.payload.committedStake.consequences,
          ),
          pendingCheckProposal: null,
          pendingChoice: null,
          lastCheckResolution: event.payload,
          resolvedCheckActionIds: state.resolvedCheckActionIds.includes(
            event.payload.actionId,
          )
            ? state.resolvedCheckActionIds
            : [...state.resolvedCheckActionIds, event.payload.actionId],
        };
      case "FieldKitUsed":
        if (state.playerCharacter === null) return state;
        return {
          ...state,
          playerCharacter: {
            ...state.playerCharacter,
            health:
              event.payload.resource === "Health"
                ? (event.payload.resultingValue as Health)
                : state.playerCharacter.health,
            resolve:
              event.payload.resource === "Resolve"
                ? (event.payload.resultingValue as Resolve)
                : state.playerCharacter.resolve,
            inventory: state.playerCharacter.inventory.map((item) =>
              item.name === "Field Kit" ? { ...item, state: "removed" } : item,
            ),
          },
        };
      case "ConfrontationEnded":
        if (state.confrontation?.id !== event.payload.confrontationId) {
          return state;
        }
        const stateWithEndingEffects = applyConsequences(
          state,
          event.payload.effects,
        );
        return {
          ...stateWithEndingEffects,
          activeScene: event.payload.nextScene,
          confrontation: {
            ...state.confrontation,
            status: event.payload.ending.kind,
            ending: event.payload.ending,
          },
          conditions: stateWithEndingEffects.conditions.filter(
            (condition) => condition !== "Shaken",
          ),
          establishedFacts: stateWithEndingEffects.establishedFacts.some(
            (fact) => fact.id === event.payload.ending.establishedFact.id,
          )
            ? stateWithEndingEffects.establishedFacts
            : [
                ...stateWithEndingEffects.establishedFacts,
                event.payload.ending.establishedFact,
              ],
        };
      case "NarratorLikelihoodRecommended":
        return {
          ...state,
          pendingNarratorRecommendation: event.payload.recommendation,
        };
      case "OracleAnswered":
        const exceptionalFact =
          event.payload.trace.result.exceptionalConsequence?.establishedFact;
        const stateWithOracleFacts = applyConsequences(state, [
          { type: "establish-fact", fact: event.payload.establishedFact },
          ...(exceptionalFact === undefined
            ? []
            : [{ type: "establish-fact" as const, fact: exceptionalFact }]),
        ]);
        return {
          ...stateWithOracleFacts,
          pendingNarratorRecommendation: null,
          lastOracleResolution: event.payload,
          resolvedPropositionIds: state.resolvedPropositionIds.includes(
            event.payload.trace.proposition.id,
          )
            ? state.resolvedPropositionIds
            : [
                ...state.resolvedPropositionIds,
                event.payload.trace.proposition.id,
              ],
        };
    }
  }, initialState());

const createEvent = <EventType extends keyof EventPayloads>(
  type: EventType,
  payload: EventPayloads[EventType],
  sequence: number,
  commandId: string,
): EventEnvelope<EventType, EventPayloads[EventType]> => ({
  id: randomUUID(),
  streamId: "adventure",
  sequence,
  type,
  schemaVersion: 1,
  timestamp: new Date().toISOString(),
  origin: "structured-play",
  correlationId: commandId,
  causationId: commandId,
  payload,
});

const createProposal = (definition: CheckActionDefinition): CheckProposal => ({
  id: randomUUID(),
  actionId: definition.id,
  goal: definition.goal,
  trait: definition.trait,
  stakes: definition.stakes,
});

const establishedFactsFor = (
  factIds: readonly string[],
  state: GameState,
): readonly EstablishedFact[] | null => {
  const evidence = factIds.map((factId) =>
    state.establishedFacts.find((fact) => fact.id === factId),
  );
  return evidence.every(
    (fact): fact is EstablishedFact => fact !== undefined,
  )
    ? evidence
    : null;
};

const createNarratorLikelihoodRecommendation = (
  proposition: UnresolvedProposition,
  likelihood: Likelihood,
  evidence: readonly EstablishedFact[],
): NarratorLikelihoodRecommendation => ({
  id: randomUUID(),
  proposition,
  likelihood,
  evidence,
});

const outcomeFor = (total: number): CheckOutcome =>
  total <= 6 ? "Setback" : total <= 9 ? "Success with Cost" : "Clean Success";

const yesThresholdFor = (likelihood: Likelihood): 25 | 50 | 75 =>
  likelihood === "Unlikely" ? 25 : likelihood === "Even" ? 50 : 75;

const exceptionalConsequenceFor = (
  roll: number,
  proposition: UnresolvedProposition,
): ExceptionalConsequence | null => {
  if (roll <= 5) {
    return proposition.exceptionalConsequences.favourable;
  }
  if (roll >= 96) {
    return proposition.exceptionalConsequences.adverse;
  }
  return null;
};

export const createStructuredPlayApplication = (
  options: StructuredPlayOptions = {},
): StructuredPlayApplication => {
  if (
    options.timelineStore !== undefined &&
    (options.eventStore !== undefined || options.randomSource !== undefined)
  ) {
    throw new Error(
      "A Timeline store supplies both event persistence and randomness.",
    );
  }
  const timelineStore = options.timelineStore ?? null;
  const eventStore = timelineStore ?? options.eventStore ?? createInMemoryEventStore();
  const randomSource =
    timelineStore ?? options.randomSource ?? createSeededRandomSource(Date.now());
  const checkActions = options.checkActions ?? DEFAULT_CHECK_ACTIONS;
  const oracleActions = options.oracleActions ?? DEFAULT_ORACLE_ACTIONS;
  const sceneTransitions =
    options.sceneTransitions ?? DEFAULT_SCENE_TRANSITIONS;
  const confrontation = options.confrontation ?? DEFAULT_CONFRONTATION;
  const freeActions = options.freeActions ?? DEFAULT_FREE_ACTIONS;
  const adventureEndings =
    options.adventureEndings ?? DEFAULT_ADVENTURE_ENDINGS;
  const authoredWorldKnowledge =
    options.authoredWorldKnowledge ?? DEFAULT_AUTHORED_WORLD_KNOWLEDGE;
  const reveals = options.reveals ?? DEFAULT_REVEALS;
  checkActions.forEach(validateCheckAction);
  oracleActions.forEach(validateOracleAction);
  sceneTransitions.forEach(validateSceneTransition);
  freeActions.forEach(validateFreeAction);
  reveals.forEach(validateReveal);
  adventureEndings.forEach(validateAdventureEnding);
  validateConfrontation(confrontation);
  const checkEstablishedFactIds = new Set(
    checkActions.flatMap((action) =>
      Object.values(action.stakes).flatMap((stake) =>
        stake.consequences.flatMap((consequence: OutcomeConsequence) =>
          consequence.type === "establish-fact" ? [consequence.fact.id] : [],
        ),
      ),
    ),
  );
  const authoredOracleFactIds = new Set(
    oracleActions.flatMap((action) =>
      oracleEstablishedFactsFor(action.proposition).map((fact) => fact.id),
    ),
  );
  for (const factId of authoredOracleFactIds) {
    if (checkEstablishedFactIds.has(factId)) {
      throw new Error(
        `Check actions cannot establish Oracle-owned fact: ${factId}.`,
      );
    }
  }

  const playerVisibleTimelineEvents = (
    timelineId: string,
  ): readonly CanonicalEvent[] =>
    timelineStore === null
      ? []
      : filterCanonicalEventsVisibleTo({
          actorScope: "Player",
          events: timelineStore.readTimeline(timelineId),
        });

  const playerTimelineView = (): TimelineCollectionView | null => {
    if (timelineStore === null) return null;
    const timeline = timelineStore.view();
    const timelines = timeline.timelines.map((candidate) => {
      const eventCount = playerVisibleTimelineEvents(candidate.id).length;
      const branchEventPosition =
        candidate.parentTimelineId === null ||
        candidate.branchEventPosition === null
          ? null
          : filterCanonicalEventsVisibleTo({
              actorScope: "Player",
              events: timelineStore
                .readTimeline(candidate.parentTimelineId)
                .slice(0, candidate.branchEventPosition),
            }).length;
      return { ...candidate, eventCount, branchEventPosition };
    });
    const activeTimeline = timelines.find(
      (candidate) => candidate.id === timeline.activeTimelineId,
    )!;
    return {
      ...timeline,
      activeTimeline,
      timelines,
      acceptedEvents: playerVisibleTimelineEvents(
        timeline.activeTimelineId,
      ).map((event, index) => ({ position: index + 1, type: event.type })),
    };
  };

  const canonicalTimelinePositionFor = (playerPosition: number): number => {
    if (timelineStore === null || !Number.isInteger(playerPosition)) {
      throw new RangeError(
        "A Timeline branch requires an accepted event position.",
      );
    }
    const events = timelineStore.readAll();
    let visiblePosition = 0;
    for (let index = 0; index < events.length; index += 1) {
      if (
        filterCanonicalEventsVisibleTo({
          actorScope: "Player",
          events: [events[index]!],
        }).length === 0
      ) {
        continue;
      }
      visiblePosition += 1;
      if (visiblePosition === playerPosition) return index + 1;
    }
    throw new RangeError(
      "A Timeline branch requires an accepted event position.",
    );
  };

  const timelineActions = (): readonly AvailableAction[] => {
    if (timelineStore === null) return [];
    const timeline = playerTimelineView()!;
    if (timeline.activeTimeline.eventCount === 0) return [];
    return [
      {
        id: "branch-timeline",
        label: "Branch from an accepted event",
        kind: "Timeline Branch",
      },
      ...timeline.timelines
        .filter((candidate) => candidate.id !== timeline.activeTimelineId)
        .map((candidate) => ({
          id: `select-timeline:${candidate.id}`,
          label: `Select ${candidate.id}`,
          kind: "Timeline Selection" as const,
          timelineId: candidate.id,
        })),
    ];
  };

  const currentAvailableActions = (
    state: GameState,
  ): readonly AvailableAction[] => [
    ...availableActionsFor(
      state,
      checkActions,
      oracleActions,
      sceneTransitions,
      freeActions,
    ),
    ...reveals
      .filter(
        (reveal) =>
          state.activeScene !== null &&
          state.pendingCheckProposal === null &&
          state.pendingChoice === null &&
          state.pendingNarratorRecommendation === null &&
          reveal.availableInScenes.includes(state.activeScene) &&
          requiredFactsAreEstablished(reveal.requiredFactIds, state) &&
          projectWorldKnowledge({
            actorScope: "Game Master",
            events: currentEvents(),
          }).entries.some(
            (entry) =>
              entry.id === reveal.worldKnowledgeId &&
              entry.visibility === "Game Master-only",
          ),
      )
      .map(({ id, label, kind }) => ({ id, label, kind })),
    ...timelineActions(),
  ];

  let pendingEvents: CanonicalEvent[] = [];
  let commandStartPosition = 0;
  const currentEvents = (): readonly CanonicalEvent[] => [
    ...eventStore.readAll(),
    ...pendingEvents,
  ];

  const view = (): ApplicationView => {
    const state = project(currentEvents());
    return {
      state,
      availableActions: currentAvailableActions(state),
      timeline: playerTimelineView(),
    };
  };

  const reject = (
    code: RejectedResult["code"],
    message: string,
    state = project(eventStore.readAll()),
  ): RejectedResult => {
    pendingEvents = [];
    return {
      status: "rejected",
      code,
      message,
      state,
      availableActions: currentAvailableActions(state),
      timeline: playerTimelineView(),
      appendedEvents: [],
    };
  };

  const append = <EventType extends keyof EventPayloads>(
    type: EventType,
    payload: EventPayloads[EventType],
    commandId: string,
  ): EventEnvelope<EventType, EventPayloads[EventType]> => {
    const event = createEvent(
      type,
      payload,
      currentEvents().length + 1,
      commandId,
    );
    pendingEvents.push(event as CanonicalEvent);
    return event;
  };

  const commitPendingEvents = (
    message: string | (() => string),
    appendedEvents: readonly CanonicalEvent[],
  ): AcceptedResult | RejectedResult => {
    let acceptedEvents = appendedEvents;
    if (pendingEvents.length > 0) {
      try {
        validateWorldKnowledgeAppend({
          currentEvents: eventStore.readAll(),
          proposedEvents: pendingEvents,
        });
      } catch (error) {
        if (error instanceof WorldKnowledgeError) {
          return reject(
            "invalid-world-knowledge",
            "World Knowledge could not be established.",
          );
        }
        throw error;
      }
      if (eventStore.appendBatch !== undefined) {
        const result = eventStore.appendBatch({
          expectedPosition: commandStartPosition,
          idempotencyKey: pendingEvents[0]!.causationId,
          events: pendingEvents,
        });
        if (result.status === "rejected") {
          const code: RejectedResult["code"] =
            result.code === "stale-position"
              ? "write-conflict"
              : result.code === "invalid-batch"
                ? "invalid-write-batch"
                : result.code;
          return reject(code, result.message);
        }
        acceptedEvents = result.events;
      } else {
        pendingEvents.forEach((event) => eventStore.append(event));
      }
    }
    pendingEvents = [];
    const state = project(currentEvents());
    return {
      status: "accepted",
      message: typeof message === "string" ? message : message(),
      state,
      availableActions: currentAvailableActions(state),
      timeline: playerTimelineView(),
      appendedEvents: filterCanonicalEventsVisibleTo({
        actorScope: "Player",
        events: acceptedEvents,
      }),
    };
  };

  const commitNarratorRecommendation = (
    proposition: UnresolvedProposition,
    likelihood: Likelihood,
    evidence: readonly EstablishedFact[],
    commandId: string,
  ): AcceptedResult | RejectedResult => {
    const recommendation = createNarratorLikelihoodRecommendation(
      proposition,
      likelihood,
      evidence,
    );
    const event = append(
      "NarratorLikelihoodRecommended",
      { recommendation },
      commandId,
    );
    return commitPendingEvents(
      `The Narrator recommends ${recommendation.likelihood}; the Player must confirm or change it before rolling.`,
      [event],
    );
  };

  const commitSatisfiedAdventureEnding = (
    from: Scene,
    commandId: string,
    appendedEvents: CanonicalEvent[],
  ): AdventureEnding | null => {
    const state = project(currentEvents());
    const definition = adventureEndings.find(
      (candidate) =>
        candidate.from === from &&
        requiredFactsAreEstablished(candidate.requiredFactIds, state),
    );
    if (definition === undefined) return null;
    appendedEvents.push(
      append(
        "AdventureEnded",
        { from, ending: definition.ending },
        commandId,
      ),
    );
    return definition.ending;
  };

  const commitSatisfiedAutomaticTransition = (
    from: Scene,
    commandId: string,
    appendedEvents: CanonicalEvent[],
  ): Scene | null => {
    const state = project(currentEvents());
    const transition = sceneTransitions.find(
      (candidate) =>
        candidate.automatic === true &&
        candidate.from === from &&
        requiredFactsAreEstablished(candidate.requiredFactIds, state),
    );
    if (transition === undefined) return null;
    appendedEvents.push(
      append(
        "SceneTransitioned",
        { from, to: transition.to },
        commandId,
      ),
    );
    if (transition.to === "confrontation") {
      appendedEvents.push(
        append("ConfrontationStarted", { definition: confrontation }, commandId),
      );
    }
    return transition.to;
  };

  const commitSatisfiedSceneExit = (
    from: Scene,
    commandId: string,
    appendedEvents: CanonicalEvent[],
  ): {
    readonly ending: AdventureEnding | null;
    readonly nextScene: Scene | null;
  } => {
    const ending = commitSatisfiedAdventureEnding(
      from,
      commandId,
      appendedEvents,
    );
    return {
      ending,
      nextScene:
        ending === null
          ? commitSatisfiedAutomaticTransition(from, commandId, appendedEvents)
          : null,
    };
  };

  const commitFreeAction = (
    definition: FreeActionDefinition,
    from: Scene,
    commandId: string,
  ): AcceptedResult | RejectedResult => {
    const event = append(
      "FreeActionCompleted",
      {
        actionId: definition.id,
        establishedFact: definition.establishedFact,
      },
      commandId,
    );
    const appendedEvents: CanonicalEvent[] = [event];
    const sceneExit = commitSatisfiedSceneExit(
      from,
      commandId,
      appendedEvents,
    );
    return commitPendingEvents(
      `${definition.establishedFact.text}${sceneExit.ending === null ? "" : ` The Adventure ends ${endingAdverb(sceneExit.ending.kind)}: ${sceneExit.ending.text}`}${sceneExit.nextScene === null ? "" : ` The ${from} Scene ends and ${sceneExit.nextScene} begins.`}`,
      appendedEvents,
    );
  };

  return {
    view,
    submit(input) {
      const events = eventStore.readAll();
      pendingEvents = [];
      commandStartPosition = events.length;
      const state = project(events);
      const commandId = randomUUID();

      if (input.type === "branch-timeline") {
        if (timelineStore === null) {
          return reject(
            "timeline-unavailable",
            "Timeline branching is not available for this Adventure store.",
            state,
          );
        }
        try {
          const timeline = timelineStore.branchTimeline(
            canonicalTimelinePositionFor(input.eventPosition),
          );
          return commitPendingEvents(
            `Created and selected ${timeline.id} from accepted event ${input.eventPosition}.`,
            [],
          );
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          return reject(
            "invalid-timeline-position",
            error.message,
            state,
          );
        }
      }

      if (input.type === "select-timeline") {
        if (
          timelineStore === null ||
          !timelineStore.selectTimeline(input.timelineId)
        ) {
          return reject(
            "timeline-unavailable",
            "That Timeline is not available.",
            state,
          );
        }
        return commitPendingEvents(`Selected ${input.timelineId}.`, []);
      }

      if (input.type === "use-field-kit") {
        const playerCharacter = state.playerCharacter;
        const currentValue =
          input.resource === "Health"
            ? playerCharacter?.health
            : playerCharacter?.resolve;
        if (
          playerCharacter === null ||
          state.activeScene === null ||
          state.activeScene === "confrontation" ||
          state.pendingCheckProposal !== null ||
          state.pendingChoice !== null ||
          state.pendingNarratorRecommendation !== null ||
          !isCarrying(playerCharacter, "Field Kit") ||
          currentValue === undefined ||
          currentValue >= 3
        ) {
          return reject(
            "field-kit-unavailable",
            "The Field Kit can restore one Health or Resolve outside a Confrontation when that resource is below 3.",
            state,
          );
        }
        const resultingValue = (currentValue + 1) as Health | Resolve;
        const event = append(
          "FieldKitUsed",
          {
            item: "Field Kit",
            removalReason: "consumption",
            resource: input.resource,
            restored: 1,
            resultingValue,
          },
          commandId,
        );
        return commitPendingEvents(
          `The Field Kit restores 1 ${input.resource} and is removed from Inventory.`,
          [event],
        );
      }

      if (input.type === "transition-scene") {
        const transition = sceneTransitions.find(
          (candidate) =>
            candidate.from === state.activeScene &&
            candidate.to === input.scene &&
            transitionIsSatisfied(candidate, state),
        );
        if (
          transition === undefined ||
          state.pendingCheckProposal !== null ||
          state.pendingChoice !== null ||
          state.pendingNarratorRecommendation !== null
        ) {
          return reject(
            "scene-transition-unavailable",
            "That Scene transition is not available while resolution is pending or from the current Scene.",
            state,
          );
        }
        const from = transition.from;
        const transitioned = append(
          "SceneTransitioned",
          { from, to: input.scene },
          commandId,
        );
        const appendedEvents: CanonicalEvent[] = [transitioned];
        if (input.scene === "confrontation") {
          appendedEvents.push(
            append("ConfrontationStarted", { definition: confrontation }, commandId),
          );
        }
        return commitPendingEvents(
          `The ${from} Scene ends and ${input.scene} begins.`,
          appendedEvents,
        );
      }

      if (input.type === "confirm-oracle-likelihood") {
        const recommendation = state.pendingNarratorRecommendation;
        if (
          recommendation?.id !== input.recommendationId ||
          !isLikelihood(input.likelihood)
        ) {
          return reject(
            "likelihood-recommendation-unavailable",
            "That Narrator Likelihood recommendation is no longer available.",
            state,
          );
        }

        const roll = randomSource.rollDie(100);
        const yesThreshold = yesThresholdFor(input.likelihood);
        const answer: OracleAnswer = roll <= yesThreshold ? "Yes" : "No";
        const exceptionalConsequence = exceptionalConsequenceFor(
          roll,
          recommendation.proposition,
        );
        const establishedFact = recommendation.proposition.answers[answer];
        const recommendationTrace = {
          likelihood: recommendation.likelihood,
          evidence: recommendation.evidence,
        };
        const resolution: OracleResolution = {
          recommendationId: recommendation.id,
          establishedFact,
          trace: {
            rule: { id: "micro-ruleset.oracle", version: "1.0.0" },
            random: {
              ...randomSource.metadata(),
              inputs: [roll],
            },
            proposition: recommendation.proposition,
            recommendation: recommendationTrace,
            confirmedLikelihood: input.likelihood,
            result: {
              roll,
              yesThreshold,
              answer,
              exceptionalConsequence,
            },
          },
        };
        const event = append("OracleAnswered", resolution, commandId);
        const appendedEvents: CanonicalEvent[] = [event];
        const sceneExit = commitSatisfiedSceneExit(
          state.activeScene!,
          commandId,
          appendedEvents,
        );
        return commitPendingEvents(
          `${answer} (${roll} <= ${yesThreshold}): ${establishedFact.text}${sceneExit.ending === null ? "" : ` The Adventure ends ${endingAdverb(sceneExit.ending.kind)}: ${sceneExit.ending.text}`}${sceneExit.nextScene === null ? "" : ` The ${state.activeScene} Scene ends and ${sceneExit.nextScene} begins.`}`,
          appendedEvents,
        );
      }

      if (input.type === "recommend-likelihood") {
        if (
          state.activeScene === null ||
          state.pendingCheckProposal !== null ||
          state.pendingChoice !== null ||
          state.pendingNarratorRecommendation !== null
        ) {
          return reject(
            "likelihood-recommendation-unavailable",
            "A Narrator Likelihood recommendation cannot be made right now.",
            state,
          );
        }
        if (
          !isLikelihood(input.likelihood) ||
          !validateUnresolvedProposition(input.proposition) ||
          input.supportingFactIds.length === 0 ||
          state.resolvedPropositionIds.includes(input.proposition.id) ||
          oracleEstablishedFactsFor(input.proposition).some((fact) =>
            checkEstablishedFactIds.has(fact.id),
          )
        ) {
          return reject(
            "invalid-likelihood-recommendation",
            "A Narrator recommendation requires a valid Unresolved Proposition and Likelihood.",
            state,
          );
        }
        const evidence = establishedFactsFor(input.supportingFactIds, state);
        if (
          new Set(input.supportingFactIds).size !== input.supportingFactIds.length ||
          evidence === null
        ) {
          return reject(
            "invalid-likelihood-recommendation",
            "Oracle evidence must name distinct Player-visible Established Facts.",
            state,
          );
        }
        return commitNarratorRecommendation(
          input.proposition,
          input.likelihood,
          evidence,
          commandId,
        );
      }

      if (input.type === "resolve-pending-check") {
        const pendingChoice = state.pendingChoice;
        const playerCharacter = state.playerCharacter;
        if (
          pendingChoice?.id !== input.pendingChoiceId ||
          playerCharacter === null
        ) {
          return reject(
            "pending-choice-unavailable",
            "That Pending Choice is no longer available.",
            state,
          );
        }
        if (
          input.choice === "spend-resolve" &&
          (playerCharacter.resolve === 0 ||
            !pendingChoice.availableChoices.includes("spend-resolve"))
        ) {
          return reject(
            "resolve-unavailable",
            "Resolve cannot be spent for this Check.",
            state,
          );
        }

        const resolveSpent = input.choice === "spend-resolve" ? 1 : 0;
        const adjustedTotal = pendingChoice.roll.result.total + resolveSpent;
        const outcome = outcomeFor(adjustedTotal);
        const resultingResolve = (
          playerCharacter.resolve - resolveSpent
        ) as Resolve;
        const resolution: CheckResolution = {
          proposalId: pendingChoice.proposal.id,
          actionId: pendingChoice.proposal.actionId,
          pendingChoiceId: pendingChoice.id,
          goal: pendingChoice.proposal.goal,
          trait: pendingChoice.proposal.trait,
          resolveSpent,
          adjustedTotal,
          outcome,
          committedStake: pendingChoice.proposal.stakes[outcome],
          resultingResolve,
          trace: {
            rule: pendingChoice.roll.rule,
            random: pendingChoice.roll.random,
            modifiers:
              resolveSpent === 1
                ? [
                    ...pendingChoice.roll.modifiers,
                    { source: "Resolve", value: 1 },
                  ]
                : pendingChoice.roll.modifiers,
            result: {
              diceTotal: pendingChoice.roll.result.diceTotal,
              originalTotal: pendingChoice.roll.result.total,
              total: adjustedTotal,
              outcome,
            },
          },
        };
        const event = append("CheckResolved", resolution, commandId);
        const appendedEvents: CanonicalEvent[] = [event];
        const resolvedState = project(currentEvents());
        const activeConfrontation = resolvedState.confrontation;
        let confrontationEnding: ConfrontationEnding | null = null;
        let adventureEnding: AdventureEnding | null = null;
        if (
          activeConfrontation?.status === "active" &&
          resolvedState.playerCharacter?.health === 0
        ) {
          confrontationEnding = {
            kind: "defeat",
            reason: "health",
            establishedFact: activeConfrontation.healthZeroConsequence,
          };
        } else if (
          activeConfrontation?.status === "active" &&
          activeConfrontation.dangerClock.current >=
            activeConfrontation.dangerClock.capacity
        ) {
          confrontationEnding = {
            kind: "defeat",
            reason: "danger",
            establishedFact:
              activeConfrontation.dangerClock.fillingConsequence,
          };
        } else if (
          activeConfrontation?.status === "active" &&
          activeConfrontation.resistanceClock.current >=
            activeConfrontation.resistanceClock.capacity
        ) {
          confrontationEnding = {
            kind: "victory",
            reason: "resistance",
            establishedFact:
              activeConfrontation.resistanceClock.fillingConsequence,
          };
        }
        if (confrontationEnding !== null && activeConfrontation !== null) {
          appendedEvents.push(
            append(
              "ConfrontationEnded",
              {
                confrontationId: activeConfrontation.id,
                ending: confrontationEnding,
                effects:
                  confrontationEnding.kind === "defeat"
                    ? activeConfrontation.defeatEffects
                    : [],
                nextScene:
                  confrontationEnding.kind === "defeat" ? "consequence" : null,
              },
              commandId,
            ),
          );
          if (confrontationEnding.kind === "victory") {
            adventureEnding = commitSatisfiedAdventureEnding(
              "confrontation",
              commandId,
              appendedEvents,
            );
          }
        }
        const sceneExit =
          confrontationEnding === null && state.activeScene !== null
            ? commitSatisfiedSceneExit(
                state.activeScene,
                commandId,
                appendedEvents,
              )
            : { ending: null, nextScene: null };
        adventureEnding ??= sceneExit.ending;
        return commitPendingEvents(
          `${outcome} (${adjustedTotal}): ${resolution.committedStake.summary}${confrontationEnding === null ? "" : ` ${confrontationEnding.establishedFact.text}`}${adventureEnding === null ? "" : ` The Adventure ends ${endingAdverb(adventureEnding.kind)}: ${adventureEnding.text}`}${sceneExit.nextScene === null ? "" : ` The ${state.activeScene} Scene ends and ${sceneExit.nextScene} begins.`}`,
          appendedEvents,
        );
      }

      if (input.type === "confirm-check-proposal") {
        const proposal = state.pendingCheckProposal;
        if (proposal?.id !== input.proposalId || state.playerCharacter === null) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        Object.values(proposal.stakes).forEach((stake) => {
          if (!stake.consequences.every(validateOutcomeConsequence)) {
            throw new Error("Invalid Outcome Consequence in confirmed Check Proposal.");
          }
        });

        const inputs = [
          randomSource.rollDie(6),
          randomSource.rollDie(6),
        ] as const;
        const modifier = state.playerCharacter.traits[proposal.trait];
        const diceTotal = inputs[0] + inputs[1];
        const total = diceTotal + modifier;
        const pendingChoice: PendingChoice = {
          id: randomUUID(),
          type: "spend-resolve",
          proposal,
          roll: {
            rule: { id: "micro-ruleset.check", version: "1.0.0" },
            random: { ...randomSource.metadata(), inputs },
            modifiers: [{ source: proposal.trait, value: modifier }],
            result: { diceTotal, total },
          },
          availableChoices:
            state.playerCharacter.resolve === 0 ||
            state.conditions.includes("Shaken")
              ? ["decline"]
              : ["decline", "spend-resolve"],
        };
        const event = append("CheckRollRevealed", { pendingChoice }, commandId);
        return commitPendingEvents(
          `Roll revealed (${inputs.join(" + ")} + ${modifier} = ${total}). Decide whether to spend Resolve.`,
          [event],
        );
      }

      if (input.type === "correct-check-proposal") {
        const proposal = state.pendingCheckProposal;
        if (proposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        if (input.goal.trim() === "" || !isTrait(input.trait)) {
          return reject(
            "invalid-check-correction",
            "A corrected Check Proposal requires a goal and valid Trait.",
            state,
          );
        }
        const replacement: CheckProposal = {
          ...proposal,
          id: randomUUID(),
          goal: input.goal,
          trait: input.trait,
        };
        const event = append(
          "CheckProposalReplaced",
          {
            supersededProposalId: proposal.id,
            proposal: replacement,
            reason: "correction",
          },
          commandId,
        );
        return commitPendingEvents("The corrected Check Proposal is ready for review.", [event]);
      }

      if (input.type === "revise-check-action") {
        const proposal = state.pendingCheckProposal;
        if (proposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        const definition = checkActions.find(
          (action) => action.id === input.actionId,
        );
        if (definition === undefined) {
          return reject(
            "action-unavailable",
            "That revised action is not available in the current Scene.",
            state,
          );
        }
        const permissionRejection = checkActionRejectionCode(definition, state);
        if (permissionRejection !== null) {
          return reject(
            permissionRejection,
            permissionRejection === "action-requires-free-movement"
              ? "Restrained prevents actions that require free movement."
              : "That revised action is not available in the current Scene.",
            state,
          );
        }
        const replacement = createProposal(definition);
        const event = append(
          "CheckProposalReplaced",
          {
            supersededProposalId: proposal.id,
            proposal: replacement,
            reason: "revised-action",
          },
          commandId,
        );
        return commitPendingEvents("A new validated Check Proposal is ready for review.", [event]);
      }

      if (input.type === "withdraw-check-proposal") {
        if (state.pendingCheckProposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        const event = append(
          "CheckProposalWithdrawn",
          { proposalId: input.proposalId },
          commandId,
        );
        return commitPendingEvents("The action was withdrawn before rolling.", [event]);
      }

      if (input.type === "amend-check-stakes") {
        if (state.pendingCheckProposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        return reject(
          "check-stakes-immutable",
          "Confirmed stakes cannot be edited; revise or withdraw the action instead.",
          state,
        );
      }

      if (input.type === "choose-action") {
        const requestedCheckAction = checkActions.find(
          (action) => action.id === input.actionId,
        );
        const permissionRejection =
          requestedCheckAction === undefined
            ? null
            : checkActionRejectionCode(requestedCheckAction, state);
        if (permissionRejection === "action-requires-free-movement") {
          return reject(
            "action-requires-free-movement",
            "Restrained prevents actions that require free movement.",
            state,
          );
        }
        const actionIsAvailable = currentAvailableActions(state).some(
          (action) =>
            action.id === input.actionId &&
            action.kind !== "Timeline Branch" &&
            action.kind !== "Timeline Selection",
        );
        if (!actionIsAvailable) {
          return reject(
            "action-unavailable",
            "That action is not available in the current Scene.",
            state,
          );
        }

        const reveal = reveals.find(
          (candidate) => candidate.id === input.actionId,
        );
        if (reveal !== undefined) {
          const event = append(
            "WorldKnowledgeRevealed",
            {
              worldKnowledgeId: reveal.worldKnowledgeId,
              knowledgeScope: reveal.knowledgeScope,
            },
            commandId,
          );
          return commitPendingEvents(
            () => {
              const revealedEntry = projectWorldKnowledge({
                actorScope: "Player",
                events: currentEvents(),
              }).entries.find(
                (entry) => entry.id === reveal.worldKnowledgeId,
              );
              return revealedEntry === undefined
                ? "Knowledge revealed."
                : `Revealed: ${revealedEntry.text}`;
            },
            [event],
          );
        }

        const freeActionDefinition =
          input.actionId === SURVEY_MANOR_ACTION.id
            ? SURVEY_MANOR_ACTION
            : freeActions.find((action) => action.id === input.actionId);
        if (freeActionDefinition !== undefined) {
          return commitFreeAction(
            freeActionDefinition,
            state.activeScene!,
            commandId,
          );
        }

        const oracleDefinition = oracleActions.find(
          (action) => action.id === input.actionId,
        );
        if (oracleDefinition !== undefined) {
          const evidence = establishedFactsFor(
            oracleDefinition.supportingFactIds,
            state,
          );
          if (evidence === null) {
            return reject(
              "invalid-likelihood-recommendation",
              "Oracle evidence must name Player-visible Established Facts.",
              state,
            );
          }
          return commitNarratorRecommendation(
            oracleDefinition.proposition,
            oracleDefinition.recommendedLikelihood,
            evidence,
            commandId,
          );
        }

        const definition = checkActions.find(
          (action) => action.id === input.actionId,
        );
        if (definition === undefined) {
          return reject(
            "action-unavailable",
            "That action is not available in the current Scene.",
            state,
          );
        }
        const proposal = createProposal(definition);
        const event = append("CheckProposalCreated", { proposal }, commandId);
        return commitPendingEvents("Review the Check Proposal before rolling.", [event]);
      }

      if (input.type === "begin-adventure") {
        if (state.playerCharacter === null) {
          return reject(
            "player-character-required",
            "Configure the Player Character before beginning.",
            state,
          );
        }
        const knowledgeEvents = authoredWorldKnowledge.map((knowledge) =>
          append("WorldKnowledgeEstablished", knowledge, commandId),
        );
        const event = append(
          "SceneStarted",
          { scene: "arrival" },
          commandId,
        );
        return commitPendingEvents("The Adventure begins at the locked manor.", [
          ...knowledgeEvents,
          event,
        ]);
      }

      if (state.playerCharacter !== null) {
        return reject(
          "player-character-already-configured",
          "The Player Character is already configured.",
          state,
        );
      }

      if (
        input.name.trim() === "" ||
        input.pronouns.trim() === "" ||
        input.motivation.trim() === ""
      ) {
        return reject(
          "invalid-identity",
          "Name, pronouns, and Motivation are required.",
          state,
        );
      }

      const assignedRatings = Object.values(input.traits).sort(
        (left, right) => left - right,
      );
      if (
        assignedRatings.length !== 3 ||
        assignedRatings[0] !== 0 ||
        assignedRatings[1] !== 1 ||
        assignedRatings[2] !== 2
      ) {
        return reject(
          "invalid-trait-assignment",
          "Assign +0, +1, and +2 exactly once among the three Traits.",
          state,
        );
      }

      const playerCharacter: PlayerCharacter = {
        name: input.name,
        pronouns: input.pronouns,
        motivation: input.motivation,
        traits: input.traits,
        health: 3,
        resolve: 3,
        inventory: STARTING_INVENTORY,
      };
      const event = append(
        "PlayerCharacterConfigured",
        playerCharacter,
        commandId,
      );
      return commitPendingEvents(`${playerCharacter.name} is ready for the Adventure.`, [event]);
    },
  };
};
