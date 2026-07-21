import {
  assembleActorScopedModelTaskEvidence,
  type ActorScopedEvidenceBundle,
} from "../actor-scoped-retrieval.js";
import {
  assembleStateProposalEvidence,
  runExpandedModelTaskSet,
  type ExpandedModelTaskResult,
} from "../expanded-model-tasks.js";
import { createMicroRulesetPackage } from "../micro-ruleset-package.js";
import { isRecord } from "../model-boundary.js";
import type {
  ModelCallRecordStore,
  ModelGateway,
} from "../model-gateway.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type ApplicationView,
  type CanonicalEvent,
} from "../structured-play.js";

export interface PlayerNaturalLanguageInterpretation {
  readonly result: ExpandedModelTaskResult;
  readonly evidenceBundle: ActorScopedEvidenceBundle;
  readonly evidenceBundles: readonly ActorScopedEvidenceBundle[];
  readonly citedEvidenceItemIds: readonly string[];
}

export const interpretPlayerNaturalLanguage = async ({
  utterance,
  view,
  acceptedEvents,
  modelGateway,
  modelCallStore,
}: {
  readonly utterance: string;
  readonly view: ApplicationView;
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly modelGateway: ModelGateway;
  readonly modelCallStore: ModelCallRecordStore;
}): Promise<PlayerNaturalLanguageInterpretation> => {
  const recordsBefore = modelCallStore.readAll().length;
  const rulesetVersion = "1.0.0";
  const evidenceBundle = assembleActorScopedModelTaskEvidence({
    scope: {
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
      campaignId: "locked-manor",
      taskType: "classify-discourse",
      rulesetVersion,
    },
    corpus: {
      campaignId: "locked-manor",
      entities: [],
      acceptedEvents,
      approvedRules: [createMicroRulesetPackage(rulesetVersion)],
    },
    utterance,
    view,
  });
  const availableCapabilityIds = view.availableActions.map(({ id }) => id);
  const knownEntityIds = evidenceBundle.items
    .filter((item) =>
      item.sourceKind === "active-scene" ||
      item.sourceKind === "player-character" ||
      item.sourceKind === "retrieved-entity" ||
      item.sourceKind === "established-fact" ||
      item.sourceKind === "relationship",
    )
    .map(({ sourceReference }) => sourceReference);
  const result = await runExpandedModelTaskSet({
    utterance,
    gateway: modelGateway,
    modelCallStore,
    context: {
      evidenceBundle,
      knownEntityIds,
      availableCapabilityIds,
      authorizedCapabilityIds: availableCapabilityIds,
      rulesetVersion,
      commandSatisfiesInvariants: (command) =>
        command.type === "choose-action" &&
        availableCapabilityIds.includes(command.actionId),
    },
  });
  const citedEvidenceItemIds = [
    ...new Set(
      modelCallStore
        .readAll()
        .slice(recordsBefore)
        .flatMap(({ validation, validatedOutput }) => {
          if (
            validation.status !== "accepted" ||
            !isRecord(validatedOutput) ||
            !Array.isArray(validatedOutput.evidenceItemIds) ||
            !validatedOutput.evidenceItemIds.every(
              (item) => typeof item === "string",
            )
          ) {
            return [];
          }
          return validatedOutput.evidenceItemIds as string[];
        }),
    ),
  ];
  return {
    result,
    evidenceBundle,
    evidenceBundles:
      result.intent === null
        ? [evidenceBundle]
        : [evidenceBundle, assembleStateProposalEvidence(evidenceBundle, result.intent)],
    citedEvidenceItemIds,
  };
};
