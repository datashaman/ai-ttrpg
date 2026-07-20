import { createHash } from "node:crypto";

import type {
  ActorScopedEvidenceBundle,
  ActorScopedEvidenceItem,
} from "./actor-scoped-retrieval.js";
import { isActorScopedEvidenceBundleFromRetrieval } from "./actor-scoped-retrieval.js";
import type { EvidenceBundle } from "./evidence-bundle.js";
import { evidenceBundleId } from "./evidence-selection.js";
import {
  canonicalJson,
  hasExactKeys,
  immutableSnapshot,
  isRecord,
} from "./model-boundary.js";
import {
  modelCallRecordFrom,
  type ModelCallRecordStore,
  type ModelGateway,
  type ModelGatewayExecution,
  type ModelTask,
} from "./model-gateway.js";
import type { StructuredPlayInput } from "./structured-play.js";

export const DISCOURSE_CLASSES = [
  "player-action",
  "in-character-speech",
  "rules-query",
  "out-of-character-request",
  "table-chat",
  "system-command",
] as const;

export type DiscourseClass = (typeof DISCOURSE_CLASSES)[number];

export interface IntentExtraction {
  readonly capabilityId: string;
  readonly referencedEntityIds: readonly string[];
  readonly evidenceItemIds: readonly string[];
}

export type RuleMatchSuggestion =
  | {
      readonly status: "matched";
      readonly ruleId: string;
      readonly evidenceItemIds: readonly string[];
    }
  | { readonly status: "no-rule" }
  | {
      readonly status: "needs-adjudication";
      readonly candidateRuleIds: readonly string[];
    };

export interface ExpandedModelTaskContext {
  readonly evidenceBundle: ActorScopedEvidenceBundle;
  readonly knownEntityIds: readonly string[];
  readonly availableCapabilityIds: readonly string[];
  readonly authorizedCapabilityIds: readonly string[];
  readonly rulesetVersion: string;
  commandSatisfiesInvariants(command: StructuredPlayInput): boolean;
}

export interface StateProposalValidationContext
  extends ExpandedModelTaskContext {
  readonly validatedIntent: IntentExtraction;
}

export interface ModelTaskEvidenceTrace {
  readonly modelCallIds: readonly string[];
  readonly evidenceBundleIds: readonly string[];
  readonly evidenceItemIds: readonly string[];
  readonly ruleIds: readonly string[];
}

export interface ExpandedModelTaskResult {
  readonly classification: DiscourseClass | null;
  readonly intent: IntentExtraction | null;
  readonly ruleMatch: RuleMatchSuggestion | null;
  readonly candidateCommand: StructuredPlayInput | null;
  readonly evidenceTrace: ModelTaskEvidenceTrace;
}

const validatedExpandedModelTaskResults = new WeakMap<
  object,
  {
    readonly utterance: string;
    readonly evidenceBundle: ActorScopedEvidenceBundle;
  }
>();

export const isValidatedExpandedModelTaskResult = (
  result: ExpandedModelTaskResult,
  expected: {
    readonly utterance: string;
    readonly evidenceBundle: ActorScopedEvidenceBundle;
  },
): boolean => {
  const validation = validatedExpandedModelTaskResults.get(result);
  return (
    validation?.utterance === expected.utterance &&
    validation.evidenceBundle === expected.evidenceBundle
  );
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const uniqueNonEmptyStrings = (value: unknown): value is readonly string[] =>
  isStringArray(value) &&
  value.length > 0 &&
  new Set(value).size === value.length &&
  value.every((item) => item.trim().length > 0);

const isDiscourseClass = (value: unknown): value is DiscourseClass =>
  typeof value === "string" &&
  DISCOURSE_CLASSES.some((classification) => classification === value);

export const validateDiscourseClassification = (
  output: unknown,
): DiscourseClass | null =>
  isRecord(output) &&
  hasExactKeys(output, ["classification"]) &&
  isDiscourseClass(output.classification)
    ? output.classification
    : null;

const evidenceIds = (bundle: EvidenceBundle): ReadonlySet<string> =>
  new Set(bundle.items.map((item) => item.id));

const referencesExist = (
  references: readonly string[],
  available: ReadonlySet<string>,
): boolean => references.every((reference) => available.has(reference));

const evidenceBackedReferencesAreValid = (
  references: {
    readonly capabilityId: string;
    readonly referencedEntityIds: readonly string[];
    readonly evidenceItemIds: readonly string[];
  },
  context: ExpandedModelTaskContext,
): boolean => {
  const availableCapabilities = new Set(context.availableCapabilityIds);
  const knownEntities = new Set(context.knownEntityIds);
  const availableEvidence = evidenceIds(context.evidenceBundle);
  return (
    availableCapabilities.has(references.capabilityId) &&
    referencesExist(references.referencedEntityIds, knownEntities) &&
    referencesExist(references.evidenceItemIds, availableEvidence) &&
    references.evidenceItemIds.includes(
      `capability:${references.capabilityId}`,
    ) &&
    references.referencedEntityIds.every((entityId) =>
      context.evidenceBundle.items.some(
        (item) =>
          references.evidenceItemIds.includes(item.id) &&
          item.sourceReference === entityId,
      ),
    )
  );
};

export const validateIntentExtraction = (
  output: unknown,
  context: ExpandedModelTaskContext,
): IntentExtraction | null => {
  if (
    !isRecord(output) ||
    !hasExactKeys(output, [
      "capabilityId",
      "referencedEntityIds",
      "evidenceItemIds",
    ]) ||
    typeof output.capabilityId !== "string" ||
    !uniqueNonEmptyStrings(output.referencedEntityIds) ||
    !uniqueNonEmptyStrings(output.evidenceItemIds)
  ) {
    return null;
  }
  const capabilityId = output.capabilityId;
  const referencedEntityIds = output.referencedEntityIds;
  const citedEvidenceIds = output.evidenceItemIds;
  if (
    !evidenceBackedReferencesAreValid(
      {
        capabilityId,
        referencedEntityIds,
        evidenceItemIds: citedEvidenceIds,
      },
      context,
    )
  ) {
    return null;
  }
  return immutableSnapshot({
    capabilityId,
    referencedEntityIds,
    evidenceItemIds: citedEvidenceIds,
  });
};

const authorityRuleIds = (bundle: EvidenceBundle): ReadonlySet<string> =>
  new Set(
    bundle.items
      .filter((item) => item.sourceKind === "authority-rule")
      .map((item) => item.id),
  );

export const validateRuleMatchSuggestion = (
  output: unknown,
  bundle: EvidenceBundle,
): RuleMatchSuggestion | null => {
  if (!isRecord(output) || typeof output.status !== "string") return null;
  if (output.status === "no-rule") {
    return hasExactKeys(output, ["status"])
      ? immutableSnapshot({ status: "no-rule" as const })
      : null;
  }
  const rules = authorityRuleIds(bundle);
  if (output.status === "matched") {
    if (
      !hasExactKeys(output, ["status", "ruleId", "evidenceItemIds"]) ||
      typeof output.ruleId !== "string" ||
      !uniqueNonEmptyStrings(output.evidenceItemIds) ||
      !rules.has(output.ruleId) ||
      !output.evidenceItemIds.includes(output.ruleId) ||
      !referencesExist(output.evidenceItemIds, evidenceIds(bundle))
    ) {
      return null;
    }
    return immutableSnapshot({
      status: "matched" as const,
      ruleId: output.ruleId,
      evidenceItemIds: output.evidenceItemIds,
    });
  }
  if (
    output.status === "needs-adjudication" &&
    hasExactKeys(output, ["status", "candidateRuleIds"]) &&
    uniqueNonEmptyStrings(output.candidateRuleIds) &&
    output.candidateRuleIds.length >= 2 &&
    referencesExist(output.candidateRuleIds, rules)
  ) {
    return immutableSnapshot({
      status: "needs-adjudication" as const,
      candidateRuleIds: output.candidateRuleIds,
    });
  }
  return null;
};

const intentEvidenceItemFrom = (
  intent: IntentExtraction,
): ActorScopedEvidenceItem => {
  const content = canonicalJson(intent);
  const hash = createHash("sha256").update(content).digest("hex");
  return {
    id: `intent:${hash}`,
    sourceKind: "validated-intent",
    sourceReference: `validated-intent:${hash}`,
    content,
    inclusionReason:
      "This exact validated intent is the only intent authorized for the State Proposal.",
    visibility: "Player-visible",
    citation: null,
  };
};

export const assembleStateProposalEvidence = (
  bundle: ActorScopedEvidenceBundle,
  intent: IntentExtraction,
): ActorScopedEvidenceBundle => {
  const items = [...bundle.items, intentEvidenceItemFrom(intent)];
  return immutableSnapshot({
    id: evidenceBundleId(items),
    taskType: "propose-state-change" as const,
    scope: { ...bundle.scope, taskType: "propose-state-change" as const },
    items,
  });
};

const STATE_EVIDENCE_KINDS = new Set([
  "active-scene",
  "player-character",
  "inventory-item",
  "condition",
  "established-fact",
  "relationship",
  "resolution",
  "accepted-event",
]);

const sameStrings = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const validateStateProposal = (
  output: unknown,
  context: StateProposalValidationContext,
): StructuredPlayInput | null => {
  if (
    !isRecord(output) ||
    !hasExactKeys(output, [
      "status",
      "capabilityId",
      "referencedEntityIds",
      "evidenceItemIds",
      "intentEvidenceItemId",
      "ruleEvidenceItemIds",
      "stateEvidenceItemIds",
      "rulesetVersion",
      "command",
    ]) ||
    output.status !== "proposed" ||
    typeof output.capabilityId !== "string" ||
    !uniqueNonEmptyStrings(output.referencedEntityIds) ||
    !uniqueNonEmptyStrings(output.evidenceItemIds) ||
    typeof output.intentEvidenceItemId !== "string" ||
    !uniqueNonEmptyStrings(output.ruleEvidenceItemIds) ||
    !uniqueNonEmptyStrings(output.stateEvidenceItemIds) ||
    typeof output.rulesetVersion !== "string" ||
    !isRecord(output.command) ||
    !hasExactKeys(output.command, ["type", "actionId"]) ||
    output.command.type !== "choose-action" ||
    typeof output.command.actionId !== "string"
  ) {
    return null;
  }
  const authorized = new Set(context.authorizedCapabilityIds);
  const referencedEntityIds = output.referencedEntityIds;
  const citedEvidenceIds = output.evidenceItemIds;
  const intentEvidenceItem = context.evidenceBundle.items.find(
    (item) => item.id === output.intentEvidenceItemId,
  );
  const ruleEvidenceItems = output.ruleEvidenceItemIds.flatMap((id) => {
    const item = context.evidenceBundle.items.find((candidate) => candidate.id === id);
    return item === undefined ? [] : [item];
  });
  const stateEvidenceItems = output.stateEvidenceItemIds.flatMap((id) => {
    const item = context.evidenceBundle.items.find((candidate) => candidate.id === id);
    return item === undefined ? [] : [item];
  });
  const command: StructuredPlayInput = {
    type: "choose-action",
    actionId: output.command.actionId,
  };
  if (
    output.capabilityId !== output.command.actionId ||
    !authorized.has(output.capabilityId) ||
    output.rulesetVersion !== context.rulesetVersion ||
    !evidenceBackedReferencesAreValid(
      {
        capabilityId: output.capabilityId,
        referencedEntityIds,
        evidenceItemIds: citedEvidenceIds,
      },
      context,
    ) ||
    output.capabilityId !== context.validatedIntent.capabilityId ||
    !sameStrings(
      referencedEntityIds,
      context.validatedIntent.referencedEntityIds,
    ) ||
    !context.validatedIntent.evidenceItemIds.every((id) =>
      citedEvidenceIds.includes(id),
    ) ||
    intentEvidenceItem?.sourceKind !== "validated-intent" ||
    intentEvidenceItem.content !== canonicalJson(context.validatedIntent) ||
    !citedEvidenceIds.includes(output.intentEvidenceItemId) ||
    ruleEvidenceItems.length !== output.ruleEvidenceItemIds.length ||
    !ruleEvidenceItems.every((item) => item.sourceKind === "authority-rule") ||
    !output.ruleEvidenceItemIds.every((id) => citedEvidenceIds.includes(id)) ||
    stateEvidenceItems.length !== output.stateEvidenceItemIds.length ||
    !stateEvidenceItems.every((item) => STATE_EVIDENCE_KINDS.has(item.sourceKind)) ||
    !output.stateEvidenceItemIds.every((id) => citedEvidenceIds.includes(id)) ||
    !context.commandSatisfiesInvariants(command)
  ) {
    return null;
  }
  return immutableSnapshot(command);
};

const bundleFor = (
  bundle: ActorScopedEvidenceBundle,
  taskType: ModelTask["type"],
): ActorScopedEvidenceBundle =>
  immutableSnapshot({
    ...bundle,
    taskType,
    scope: { ...bundle.scope, taskType },
  });

const assertActorScopedContext = (
  context: ExpandedModelTaskContext,
  utterance: string,
): void => {
  const { evidenceBundle } = context;
  const scope: unknown = evidenceBundle.scope;
  if (
    !isActorScopedEvidenceBundleFromRetrieval(evidenceBundle, {
      utterance,
      scope: evidenceBundle.scope,
    }) ||
    !isRecord(scope) ||
    typeof scope.taskType !== "string" ||
    evidenceBundle.taskType !== scope.taskType ||
    scope.rulesetVersion !== context.rulesetVersion ||
    !isRecord(scope.actorScope) ||
    scope.actorScope.kind !== "Player" ||
    typeof scope.actorScope.playerCharacterId !== "string" ||
    scope.playerCharacterId !== scope.actorScope.playerCharacterId ||
    typeof scope.campaignId !== "string" ||
    scope.campaignId.trim() === "" ||
    evidenceBundle.items.some(
      (item) =>
        item.visibility !== "Player-visible" ||
        typeof item.citation === "undefined",
    )
  ) {
    throw new Error(
      "Expanded Model Tasks require one validated actor-scoped Evidence Bundle.",
    );
  }
};

const rejectedReason = (execution: ModelGatewayExecution): string =>
  execution.outcome.status === "failed"
    ? execution.outcome.reason
    : "The Model Task output failed strict validation.";

const recordExecution = (
  store: ModelCallRecordStore,
  execution: ModelGatewayExecution,
  validatedOutput: unknown | null,
  command: StructuredPlayInput | null = null,
): void =>
  store.append(
    modelCallRecordFrom({
      execution,
      validation:
        validatedOutput === null
          ? { status: "rejected", reason: rejectedReason(execution) }
          : { status: "accepted" },
      validatedOutput,
      command,
      acceptedEvents: [],
      fallbackOutcome: validatedOutput === null ? "safe-rejection" : "none",
    }),
  );

const succeededOutput = (execution: ModelGatewayExecution): unknown | null =>
  execution.outcome.status === "succeeded" ? execution.outcome.output : null;

const evidenceTraceFrom = (
  executions: readonly ModelGatewayExecution[],
  ruleIds: readonly string[],
): ModelTaskEvidenceTrace =>
  immutableSnapshot({
    modelCallIds: executions.map((execution) => execution.callId),
    evidenceBundleIds: [
      ...new Set(executions.map((execution) => execution.task.evidenceBundle.id)),
    ],
    evidenceItemIds: [
      ...new Set(
        executions.flatMap((execution) =>
          execution.task.evidenceBundle.items.map((item) => item.id),
        ),
      ),
    ],
    ruleIds: [...new Set(ruleIds)],
  });

const taskResult = ({
  classification,
  intent = null,
  ruleMatch = null,
  candidateCommand = null,
  executions,
  ruleIds = [],
}: {
  readonly classification: DiscourseClass | null;
  readonly intent?: IntentExtraction | null;
  readonly ruleMatch?: RuleMatchSuggestion | null;
  readonly candidateCommand?: StructuredPlayInput | null;
  readonly executions: readonly ModelGatewayExecution[];
  readonly ruleIds?: readonly string[];
}): ExpandedModelTaskResult => {
  const result = immutableSnapshot({
    classification,
    intent,
    ruleMatch,
    candidateCommand,
    evidenceTrace: evidenceTraceFrom(executions, ruleIds),
  });
  return result;
};

export const runExpandedModelTaskSet = async ({
  utterance,
  gateway,
  modelCallStore,
  context,
}: {
  readonly utterance: string;
  readonly gateway: ModelGateway;
  readonly modelCallStore: ModelCallRecordStore;
  readonly context: ExpandedModelTaskContext;
}): Promise<ExpandedModelTaskResult> => {
  assertActorScopedContext(context, utterance);
  const validatedResult = (
    input: Parameters<typeof taskResult>[0],
  ): ExpandedModelTaskResult => {
    const result = taskResult(input);
    validatedExpandedModelTaskResults.set(result, {
      utterance,
      evidenceBundle: context.evidenceBundle,
    });
    return result;
  };
  const classificationExecution = await gateway.execute(
    {
      type: "classify-discourse",
      input: { utterance },
      evidenceBundle: bundleFor(context.evidenceBundle, "classify-discourse"),
    },
    { isStructurallyValid: (output) => validateDiscourseClassification(output) !== null },
  );
  const classification = validateDiscourseClassification(
    succeededOutput(classificationExecution),
  );
  recordExecution(
    modelCallStore,
    classificationExecution,
    classification === null ? null : { classification },
  );
  if (classification === null) {
    return validatedResult({
      classification: null,
      executions: [classificationExecution],
    });
  }

  if (classification === "player-action") {
    const intentExecution = await gateway.execute(
      {
        type: "extract-intent",
        input: { utterance },
        evidenceBundle: bundleFor(context.evidenceBundle, "extract-intent"),
      },
      { isStructurallyValid: (output) => validateIntentExtraction(output, context) !== null },
    );
    const intent = validateIntentExtraction(succeededOutput(intentExecution), context);
    recordExecution(modelCallStore, intentExecution, intent);
    if (intent === null) {
      return validatedResult({
        classification,
        executions: [classificationExecution, intentExecution],
      });
    }
    const proposalEvidenceBundle = assembleStateProposalEvidence(
      bundleFor(context.evidenceBundle, "propose-state-change"),
      intent,
    );
    const proposalContext: StateProposalValidationContext = {
      ...context,
      evidenceBundle: proposalEvidenceBundle,
      validatedIntent: intent,
    };
    const proposalExecution = await gateway.execute(
      {
        type: "propose-state-change",
        input: { utterance, intent, rulesetVersion: context.rulesetVersion },
        evidenceBundle: proposalEvidenceBundle,
      },
      {
        isStructurallyValid: (output) =>
          validateStateProposal(output, proposalContext) !== null,
      },
    );
    const proposalOutput = succeededOutput(proposalExecution);
    const candidateCommand = validateStateProposal(
      proposalOutput,
      proposalContext,
    );
    recordExecution(
      modelCallStore,
      proposalExecution,
      candidateCommand === null ? null : proposalOutput,
      candidateCommand,
    );
    const proposalRuleIds =
      candidateCommand !== null && isRecord(proposalOutput)
        ? (proposalOutput.ruleEvidenceItemIds as readonly string[])
        : [];
    return validatedResult({
      classification,
      intent,
      candidateCommand,
      executions: [
        classificationExecution,
        intentExecution,
        proposalExecution,
      ],
      ruleIds: proposalRuleIds,
    });
  }

  if (classification === "rules-query") {
    const ruleExecution = await gateway.execute(
      {
        type: "suggest-rule-match",
        input: { utterance },
        evidenceBundle: bundleFor(context.evidenceBundle, "suggest-rule-match"),
      },
      {
        isStructurallyValid: (output) =>
          validateRuleMatchSuggestion(output, context.evidenceBundle) !== null,
      },
    );
    const ruleMatch = validateRuleMatchSuggestion(
      succeededOutput(ruleExecution),
      context.evidenceBundle,
    );
    recordExecution(modelCallStore, ruleExecution, ruleMatch);
    const ruleIds =
      ruleMatch?.status === "matched"
        ? [ruleMatch.ruleId]
        : ruleMatch?.status === "needs-adjudication"
          ? ruleMatch.candidateRuleIds
          : [];
    return validatedResult({
      classification,
      ruleMatch,
      executions: [classificationExecution, ruleExecution],
      ruleIds,
    });
  }

  return validatedResult({
    classification,
    executions: [classificationExecution],
  });
};
