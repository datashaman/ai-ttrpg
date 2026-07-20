import type { ActorScopedEvidenceBundle } from "./actor-scoped-retrieval.js";
import {
  isValidatedExpandedModelTaskResult,
  type ExpandedModelTaskResult,
  type ModelTaskEvidenceTrace,
} from "./expanded-model-tasks.js";
import {
  hasExactKeys,
  isRecord,
} from "./model-boundary.js";
import type {
  CanonicalEvent,
  GameState,
  Resource,
} from "./structured-play.js";
import type { PlayerWorldKnowledgeActorScope } from "./world-knowledge.js";

export interface ValidatedSceneModelInput {
  readonly utterance: string;
  readonly modelResult: ExpandedModelTaskResult;
  readonly evidenceBundle: ActorScopedEvidenceBundle;
}

export interface SceneNarrationRequest extends ValidatedSceneModelInput {
  readonly committedEvents: readonly CanonicalEvent[];
  readonly state: GameState;
  readonly deterministicSummary: string;
}

export interface SceneNarrationOutput {
  readonly text: string;
  readonly entityIds: readonly string[];
  readonly locationIds: readonly string[];
  readonly resourceClaims: readonly {
    readonly resource: Resource;
    readonly value: number;
  }[];
  readonly ruleIds: readonly string[];
  readonly outcomeEventIds: readonly string[];
}

export interface ScenePresentation {
  readonly source: "model" | "deterministic-fallback";
  readonly text: string;
  readonly evidenceTrace: ModelTaskEvidenceTrace;
}

export const sceneModelInputIsValidated = (
  input: ValidatedSceneModelInput,
  actorScope: PlayerWorldKnowledgeActorScope,
): boolean => {
  const { evidenceBundle, modelResult } = input;
  const evidenceIds = new Set(evidenceBundle.items.map((item) => item.id));
  const authorityRuleIds = new Set(
    evidenceBundle.items
      .filter((item) => item.sourceKind === "authority-rule")
      .map((item) => item.id),
  );
  return (
    isValidatedExpandedModelTaskResult(modelResult, {
      utterance: input.utterance,
      evidenceBundle,
    }) &&
    evidenceBundle.scope.actorScope.kind === "Player" &&
    evidenceBundle.scope.actorScope.playerCharacterId ===
      actorScope.playerCharacterId &&
    evidenceBundle.scope.playerCharacterId === actorScope.playerCharacterId &&
    evidenceBundle.scope.campaignId.trim().length > 0 &&
    evidenceBundle.scope.rulesetVersion.trim().length > 0 &&
    evidenceBundle.items.every(
      (item) =>
        item.visibility === "Player-visible" &&
        typeof item.citation !== "undefined",
    ) &&
    modelResult.evidenceTrace.evidenceBundleIds.includes(evidenceBundle.id) &&
    [...evidenceIds].every((id) =>
      modelResult.evidenceTrace.evidenceItemIds.includes(id),
    ) &&
    modelResult.evidenceTrace.ruleIds.every((id) =>
      authorityRuleIds.has(id),
    ) &&
    (modelResult.candidateCommand === null ||
      (modelResult.candidateCommand.type === "choose-action" &&
        modelResult.intent?.capabilityId ===
          modelResult.candidateCommand.actionId &&
        evidenceIds.has(`capability:${modelResult.candidateCommand.actionId}`)))
  );
};

export const isCommittedSceneOutcome = (event: CanonicalEvent): boolean =>
  [
    "FreeActionCompleted",
    "CheckResolved",
    "FieldKitUsed",
    "OracleAnswered",
    "ConfrontationEnded",
  ].includes(event.type);

const resourceValue = (
  state: GameState,
  resource: Resource,
): number | null => {
  if (state.playerCharacter === null) return null;
  return resource === "Health"
    ? state.playerCharacter.health
    : state.playerCharacter.resolve;
};

const SAFE_NARRATIVE_FRAMING = new Set([
  "a",
  "and",
  "as",
  "at",
  "certain",
  "certainty",
  "clear",
  "clearly",
  "in",
  "is",
  "of",
  "outcome",
  "quiet",
  "settled",
  "settles",
  "the",
  "this",
  "with",
]);

export const validatesSceneNarration = (
  output: unknown,
  request: SceneNarrationRequest,
): output is SceneNarrationOutput => {
  if (
    !isRecord(output) ||
    !hasExactKeys(output, [
      "text",
      "entityIds",
      "locationIds",
      "resourceClaims",
      "ruleIds",
      "outcomeEventIds",
    ]) ||
    typeof output.text !== "string" ||
    output.text.trim().length === 0 ||
    !Array.isArray(output.entityIds) ||
    !Array.isArray(output.locationIds) ||
    !Array.isArray(output.resourceClaims) ||
    !Array.isArray(output.ruleIds) ||
    !Array.isArray(output.outcomeEventIds)
  ) {
    return false;
  }
  const entityIds = new Set(
    request.evidenceBundle.items
      .filter((item) =>
        ["inventory-item", "player-character", "retrieved-entity"].includes(
          item.sourceKind,
        ),
      )
      .map((item) => item.sourceReference),
  );
  const locationIds = new Set(
    request.evidenceBundle.items
      .filter(
        (item) =>
          item.sourceKind === "active-scene" ||
          (item.sourceKind === "retrieved-entity" &&
            item.content.includes('"kind":"Location"')),
      )
      .map((item) => item.sourceReference),
  );
  const ruleIds = new Set(request.modelResult.evidenceTrace.ruleIds);
  const outputRuleIds = output.ruleIds;
  const eventIds = new Set(request.committedEvents.map((event) => event.id));
  const committedRuleIds = request.committedEvents.flatMap((event) => {
    if (event.type === "CheckResolved" || event.type === "OracleAnswered") {
      return [
        `rule:${event.payload.trace.rule.id}@${event.payload.trace.rule.version}`,
      ];
    }
    return [];
  });
  const normalizedSummary = request.deterministicSummary.toLocaleLowerCase("en");
  const normalizedText = output.text.toLocaleLowerCase("en");
  const framing = normalizedText.replace(normalizedSummary, " ");
  return (
    normalizedText.includes(normalizedSummary) &&
    (framing.match(/[a-z0-9]+/g) ?? []).every((token) =>
      SAFE_NARRATIVE_FRAMING.has(token),
    ) &&
    output.entityIds.every(
      (id) => typeof id === "string" && entityIds.has(id),
    ) &&
    output.locationIds.every(
      (id) => typeof id === "string" && locationIds.has(id),
    ) &&
    outputRuleIds.every((id) => typeof id === "string" && ruleIds.has(id)) &&
    committedRuleIds.every((id) => outputRuleIds.includes(id)) &&
    output.outcomeEventIds.length > 0 &&
    output.outcomeEventIds.every(
      (id) => typeof id === "string" && eventIds.has(id),
    ) &&
    output.resourceClaims.every(
      (claim) =>
        isRecord(claim) &&
        hasExactKeys(claim, ["resource", "value"]) &&
        (claim.resource === "Health" || claim.resource === "Resolve") &&
        typeof claim.value === "number" &&
        resourceValue(request.state, claim.resource) === claim.value,
    )
  );
};
