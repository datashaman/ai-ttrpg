import type { CanonicalEvent } from "./structured-play.js";
import { isWorldKnowledgeEstablishedPayload } from "./world-knowledge.js";

type ValueObject = Record<string, unknown>;

const isObject = (value: unknown): value is ValueObject =>
  typeof value === "object" && value !== null;
const isString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const isInteger = (value: unknown, minimum: number, maximum: number): boolean =>
  Number.isInteger(value) &&
  (value as number) >= minimum &&
  (value as number) <= maximum;
const isOneOf = <Value extends string | number>(
  value: unknown,
  choices: readonly Value[],
): value is Value => choices.includes(value as Value);
const isArrayOf = (
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is unknown[] => Array.isArray(value) && value.every(predicate);

const scenes = ["arrival", "discovery", "confrontation", "consequence"] as const;
const traits = ["Might", "Wits", "Presence"] as const;
const outcomes = ["Setback", "Success with Cost", "Clean Success"] as const;
const likelihoods = ["Unlikely", "Even", "Likely"] as const;
const inventoryItems = [
  "Lantern",
  "Lockpick Set",
  "Short Blade",
  "Field Kit",
] as const;

const isEstablishedFact = (value: unknown): boolean =>
  isObject(value) && isString(value.id) && isString(value.text);

const isExceptionalConsequence = (
  value: unknown,
  expectedKind?: "favourable" | "adverse",
): boolean =>
  isObject(value) &&
  isOneOf(value.kind, ["favourable", "adverse"] as const) &&
  (expectedKind === undefined || value.kind === expectedKind) &&
  isEstablishedFact(value.establishedFact);

const isUnresolvedProposition = (value: unknown): boolean => {
  if (!isObject(value) || !isString(value.id) || !isString(value.text)) return false;
  const answers = value.answers;
  const exceptional = value.exceptionalConsequences;
  return (
    isObject(answers) &&
    isEstablishedFact(answers.Yes) &&
    isEstablishedFact(answers.No) &&
    isObject(exceptional) &&
    isExceptionalConsequence(exceptional.favourable, "favourable") &&
    isExceptionalConsequence(exceptional.adverse, "adverse")
  );
};

const isInventoryItem = (value: unknown): boolean =>
  isObject(value) &&
  isOneOf(value.name, inventoryItems) &&
  isOneOf(value.state, ["carried", "removed"] as const);

const isPlayerCharacter = (value: unknown): boolean => {
  if (!isObject(value) || !isObject(value.traits)) return false;
  const ratings = traits.map(
    (trait) => (value.traits as ValueObject)[trait],
  );
  return (
    isString(value.name) &&
    isString(value.pronouns) &&
    isString(value.motivation) &&
    ratings.every((rating) => isInteger(rating, 0, 2)) &&
    [...ratings].sort().join(",") === "0,1,2" &&
    isInteger(value.health, 0, 3) &&
    isInteger(value.resolve, 0, 3) &&
    isArrayOf(value.inventory, isInventoryItem)
  );
};

const isMechanicalEffect = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "lose-health":
      return value.amount === 1;
    case "remove-inventory-item":
      return (
        isOneOf(value.item, inventoryItems) &&
        isOneOf(value.reason, ["loss", "breakage", "surrender", "consumption"])
      );
    case "add-condition":
      return isOneOf(value.condition, ["Shaken", "Restrained"]);
    case "remove-condition":
      return value.condition === "Restrained";
    case "advance-clock":
      return isOneOf(value.clock, ["Resistance", "Danger"]) && value.amount === 1;
    default:
      return false;
  }
};

const isOutcomeConsequence = (value: unknown): boolean =>
  isObject(value) &&
  (value.type === "establish-fact"
    ? isEstablishedFact(value.fact)
    : isMechanicalEffect(value));

const isCheckStake = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.summary) &&
  isArrayOf(value.consequences, isOutcomeConsequence);

const isCheckStakes = (value: unknown): boolean =>
  isObject(value) &&
  outcomes.every((outcome) => isCheckStake(value[outcome]));

const isCheckProposal = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.actionId) &&
  isString(value.goal) &&
  isOneOf(value.trait, traits) &&
  isCheckStakes(value.stakes);

const isSeed = (value: unknown): boolean =>
  value === null || isInteger(value, 0, 0xffff_ffff);

const isCheckRandom = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.source) &&
  isSeed(value.seed) &&
  Array.isArray(value.inputs) &&
  value.inputs.length === 2 &&
  value.inputs.every((input) => isInteger(input, 1, 6));

const isCheckRule = (value: unknown): boolean =>
  isObject(value) &&
  value.id === "micro-ruleset.check" &&
  value.version === "1.0.0";

const isTraitModifier = (value: unknown): boolean =>
  isObject(value) &&
  isOneOf(value.source, traits) &&
  isInteger(value.value, 0, 2);

const isRevealedCheckRoll = (value: unknown): boolean => {
  if (
    !isObject(value) ||
    !isCheckRule(value.rule) ||
    !isCheckRandom(value.random) ||
    !Array.isArray(value.modifiers) ||
    value.modifiers.length !== 1 ||
    !isTraitModifier(value.modifiers[0]) ||
    !isObject(value.result) ||
    !isInteger(value.result.diceTotal, 2, 12) ||
    !isInteger(value.result.total, 2, 14)
  ) {
    return false;
  }
  const inputs = (value.random as ValueObject).inputs as number[];
  const modifier = value.modifiers[0] as ValueObject;
  return (
    value.result.diceTotal === inputs[0]! + inputs[1]! &&
    value.result.total === value.result.diceTotal + (modifier.value as number)
  );
};

const isPendingChoice = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  value.type === "spend-resolve" &&
  isCheckProposal(value.proposal) &&
  isRevealedCheckRoll(value.roll) &&
  isArrayOf(value.availableChoices, (choice) =>
    isOneOf(choice, ["decline", "spend-resolve"]),
  ) &&
  value.availableChoices.includes("decline");

const isCheckTrace = (value: unknown): boolean => {
  if (
    !isObject(value) ||
    !isCheckRule(value.rule) ||
    !isCheckRandom(value.random) ||
    !Array.isArray(value.modifiers) ||
    ![1, 2].includes(value.modifiers.length) ||
    !isTraitModifier(value.modifiers[0]) ||
    (value.modifiers.length === 2 &&
      (!isObject(value.modifiers[1]) ||
        value.modifiers[1].source !== "Resolve" ||
        value.modifiers[1].value !== 1)) ||
    !isObject(value.result) ||
    !isInteger(value.result.diceTotal, 2, 12) ||
    !isInteger(value.result.originalTotal, 2, 14) ||
    !isInteger(value.result.total, 2, 15) ||
    !isOneOf(value.result.outcome, outcomes)
  ) {
    return false;
  }
  const inputs = (value.random as ValueObject).inputs as number[];
  const traitModifier = value.modifiers[0] as ValueObject;
  const expectedOutcome =
    (value.result.total as number) <= 6
      ? "Setback"
      : (value.result.total as number) <= 9
        ? "Success with Cost"
        : "Clean Success";
  return (
    value.result.diceTotal === inputs[0]! + inputs[1]! &&
    value.result.originalTotal ===
      value.result.diceTotal + (traitModifier.value as number) &&
    value.result.total ===
      value.result.originalTotal + (value.modifiers.length === 2 ? 1 : 0) &&
    value.result.outcome === expectedOutcome
  );
};

const isCheckResolution = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.proposalId) &&
  isString(value.actionId) &&
  isString(value.pendingChoiceId) &&
  isString(value.goal) &&
  isOneOf(value.trait, traits) &&
  isOneOf(value.resolveSpent, [0, 1] as const) &&
  isInteger(value.adjustedTotal, 2, 15) &&
  isOneOf(value.outcome, outcomes) &&
  isCheckStake(value.committedStake) &&
  isInteger(value.resultingResolve, 0, 3) &&
  isCheckTrace(value.trace) &&
  (value.trace as ValueObject).result !== undefined &&
  ((value.trace as ValueObject).result as ValueObject).total === value.adjustedTotal &&
  ((value.trace as ValueObject).result as ValueObject).outcome === value.outcome &&
  ((value.trace as ValueObject).modifiers as unknown[]).length ===
    (value.resolveSpent === 1 ? 2 : 1);

const isConfrontationDefinition = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  const resistance = value.resistanceClock;
  const danger = value.dangerClock;
  return (
    isString(value.id) &&
    isObject(resistance) &&
    isInteger(resistance.capacity, 1, Number.MAX_SAFE_INTEGER) &&
    isEstablishedFact(resistance.fillingConsequence) &&
    isObject(danger) &&
    isInteger(danger.capacity, 1, Number.MAX_SAFE_INTEGER) &&
    isEstablishedFact(danger.fillingConsequence) &&
    isEstablishedFact(value.healthZeroConsequence) &&
    isArrayOf(value.defeatEffects, isMechanicalEffect)
  );
};

const isConfrontationEnding = (value: unknown): boolean =>
  isObject(value) &&
  isOneOf(value.kind, ["victory", "defeat"] as const) &&
  isOneOf(value.reason, ["resistance", "danger", "health"] as const) &&
  isEstablishedFact(value.establishedFact) &&
  (value.kind === "victory"
    ? value.reason === "resistance"
    : value.reason === "danger" || value.reason === "health");

const isAdventureEnding = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isOneOf(value.kind, ["favourable", "adverse", "unresolved"] as const) &&
  isString(value.text);

const isRecommendation = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isUnresolvedProposition(value.proposition) &&
  isOneOf(value.likelihood, likelihoods) &&
  isArrayOf(value.evidence, isEstablishedFact);

const isOracleTrace = (value: unknown): boolean => {
  if (!isObject(value) || !isObject(value.rule) || !isObject(value.random)) {
    return false;
  }
  const recommendation = value.recommendation;
  const result = value.result;
  if (
    !(
    value.rule.id === "micro-ruleset.oracle" &&
    value.rule.version === "1.0.0" &&
    isString(value.random.source) &&
    isSeed(value.random.seed) &&
    Array.isArray(value.random.inputs) &&
    value.random.inputs.length === 1 &&
    isInteger(value.random.inputs[0], 1, 100) &&
    isUnresolvedProposition(value.proposition) &&
    isObject(recommendation) &&
    isOneOf(recommendation.likelihood, likelihoods) &&
    isArrayOf(recommendation.evidence, isEstablishedFact) &&
    isOneOf(value.confirmedLikelihood, likelihoods) &&
    isObject(result) &&
    isInteger(result.roll, 1, 100) &&
    isOneOf(result.yesThreshold, [25, 50, 75] as const) &&
    isOneOf(result.answer, ["Yes", "No"] as const) &&
    (result.exceptionalConsequence === null ||
      isExceptionalConsequence(result.exceptionalConsequence))
    )
  ) {
    return false;
  }
  const roll = value.random.inputs[0] as number;
  const threshold =
    value.confirmedLikelihood === "Unlikely"
      ? 25
      : value.confirmedLikelihood === "Even"
        ? 50
        : 75;
  const expectedAnswer = roll <= threshold ? "Yes" : "No";
  const expectedExceptionalKind =
    roll <= 5 ? "favourable" : roll >= 96 ? "adverse" : null;
  return (
    result.roll === roll &&
    result.yesThreshold === threshold &&
    result.answer === expectedAnswer &&
    (expectedExceptionalKind === null
      ? result.exceptionalConsequence === null
      : isExceptionalConsequence(
          result.exceptionalConsequence,
          expectedExceptionalKind,
        ))
  );
};

export const canonicalEventRandomSeed = (
  event: CanonicalEvent,
): number | null | undefined => {
  switch (event.type) {
    case "CheckRollRevealed":
      return event.payload.pendingChoice.roll.random.seed;
    case "CheckResolved":
      return event.payload.trace.random.seed;
    case "OracleAnswered":
      return event.payload.trace.random.seed;
    default:
      return undefined;
  }
};

type PayloadValidator = (payload: ValueObject) => boolean;

const payloadValidators = {
  PlayerCharacterConfigured: isPlayerCharacter,
  SceneStarted: (payload) => isOneOf(payload.scene, scenes),
  WorldKnowledgeEstablished: isWorldKnowledgeEstablishedPayload,
  SceneTransitioned: (payload) =>
    isOneOf(payload.from, scenes) && isOneOf(payload.to, scenes),
  ConfrontationStarted: (payload) =>
    isConfrontationDefinition(payload.definition),
  FreeActionCompleted: (payload) =>
    isString(payload.actionId) && isEstablishedFact(payload.establishedFact),
  AdventureEnded: (payload) =>
    isOneOf(payload.from, scenes) && isAdventureEnding(payload.ending),
  CheckProposalCreated: (payload) => isCheckProposal(payload.proposal),
  CheckProposalReplaced: (payload) =>
    isString(payload.supersededProposalId) &&
    isCheckProposal(payload.proposal) &&
    isOneOf(payload.reason, ["correction", "revised-action"] as const),
  CheckProposalWithdrawn: (payload) => isString(payload.proposalId),
  CheckRollRevealed: (payload) => isPendingChoice(payload.pendingChoice),
  CheckResolved: isCheckResolution,
  ConfrontationEnded: (payload) =>
    isString(payload.confrontationId) &&
    isConfrontationEnding(payload.ending) &&
    isArrayOf(payload.effects, isMechanicalEffect) &&
    (payload.nextScene === null || payload.nextScene === "consequence"),
  FieldKitUsed: (payload) =>
    payload.item === "Field Kit" &&
    payload.removalReason === "consumption" &&
    isOneOf(payload.resource, ["Health", "Resolve"] as const) &&
    payload.restored === 1 &&
    isInteger(payload.resultingValue, 0, 3),
  NarratorLikelihoodRecommended: (payload) =>
    isRecommendation(payload.recommendation),
  OracleAnswered: (payload) =>
    isString(payload.recommendationId) &&
    isEstablishedFact(payload.establishedFact) &&
    isOracleTrace(payload.trace),
} satisfies Record<CanonicalEvent["type"], PayloadValidator>;

export const isCanonicalEventEnvelope = (
  value: unknown,
  expectedSequence: number,
): value is CanonicalEvent => {
  if (!isObject(value) || typeof value.type !== "string") return false;
  if (!Object.hasOwn(payloadValidators, value.type)) return false;
  const type = value.type as CanonicalEvent["type"];
  return (
    isString(value.id) &&
    value.streamId === "adventure" &&
    value.sequence === expectedSequence &&
    value.schemaVersion === 1 &&
    isString(value.timestamp) &&
    !Number.isNaN(Date.parse(value.timestamp)) &&
    value.origin === "structured-play" &&
    isString(value.correlationId) &&
    isString(value.causationId) &&
    isObject(value.payload) &&
    payloadValidators[type](value.payload)
  );
};
