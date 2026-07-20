import type { EvidenceBundle, EvidenceItem } from "./evidence-bundle.js";
import {
  evidenceBundleId,
  selectRankedEvidence,
  type RankedEvidenceItem,
} from "./evidence-selection.js";
import { immutableSnapshot } from "./model-boundary.js";
import {
  assertApprovedExecutableRulesetPackage,
  type ExecutableRulesetPackage,
} from "./rule-publication.js";
import type {
  ApplicationView,
  CanonicalEvent,
  Scene,
} from "./structured-play.js";
import type {
  PlayerWorldKnowledgeActorScope,
  WorldKnowledgeEntry,
  WorldKnowledgeVisibility,
} from "./world-knowledge.js";
import {
  filterCanonicalEventsVisibleTo,
  projectWorldKnowledge,
} from "./world-knowledge.js";

export type RetrievalEntityKind =
  | "Player Character"
  | "Non-Player Character"
  | "Location";

export interface RetrievalEntity {
  readonly id: string;
  readonly kind: RetrievalEntityKind;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly pronouns?: readonly string[];
  readonly locationId?: string;
  readonly activeInScene?: Scene;
  readonly sourceReference: string;
  readonly visibility: WorldKnowledgeVisibility;
  readonly playerCharacterIds: readonly string[];
}

export interface RetrievalScope {
  readonly actorScope: PlayerWorldKnowledgeActorScope;
  readonly playerCharacterId: string;
  readonly campaignId: string;
  readonly taskType: EvidenceBundle["taskType"];
  readonly rulesetVersion: string;
}

export interface RetrievalCorpus {
  readonly campaignId: string;
  readonly entities: readonly RetrievalEntity[];
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly approvedRules: readonly ExecutableRulesetPackage[];
}

export interface ActorScopedRetrievalInput {
  readonly scope: RetrievalScope;
  readonly corpus: RetrievalCorpus;
  readonly utterance: string;
  readonly view: ApplicationView;
  readonly maxItems?: number;
}

export interface ActorScopedEvidenceItem extends EvidenceItem {
  readonly visibility: "Player-visible";
  readonly citation: string | null;
}

export interface ActorScopedEvidenceBundle
  extends Omit<EvidenceBundle, "items"> {
  readonly items: readonly ActorScopedEvidenceItem[];
}

export type RetrievalScopeErrorCode =
  | "INVALID_SCOPE"
  | "ACTOR_SCOPE_MISMATCH"
  | "CAMPAIGN_SCOPE_MISMATCH";

export class RetrievalScopeError extends Error {
  constructor(
    readonly code: RetrievalScopeErrorCode,
    message: string,
  ) {
    super(`${message} [${code}]`);
    this.name = "RetrievalScopeError";
  }
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const validateScope = ({ scope, corpus }: ActorScopedRetrievalInput): void => {
  if (
    !nonEmpty(scope.playerCharacterId) ||
    !nonEmpty(scope.campaignId) ||
    !nonEmpty(scope.rulesetVersion) ||
    !nonEmpty(scope.taskType)
  ) {
    throw new RetrievalScopeError(
      "INVALID_SCOPE",
      "Retrieval requires explicit Player Character, campaign, task, and ruleset-version scope.",
    );
  }
  if (scope.actorScope.playerCharacterId !== scope.playerCharacterId) {
    throw new RetrievalScopeError(
      "ACTOR_SCOPE_MISMATCH",
      "Retrieval actor scope does not identify the requested Player Character.",
    );
  }
  if (scope.campaignId !== corpus.campaignId) {
    throw new RetrievalScopeError(
      "CAMPAIGN_SCOPE_MISMATCH",
      "Retrieval corpus does not belong to the requested campaign.",
    );
  }
};

const normalized = (value: string): string =>
  value
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9:._-]+/g, " ")
    .trim();

const mentions = (utterance: string, reference: string): boolean => {
  const candidate = normalized(reference);
  if (candidate === "") return false;
  return ` ${normalized(utterance)} `.includes(` ${candidate} `);
};

const RELEVANCE_STOP_WORDS = new Set([
  "and",
  "are",
  "for",
  "from",
  "has",
  "have",
  "the",
  "this",
  "was",
  "were",
  "what",
  "when",
  "where",
  "with",
]);

const significantTerms = (value: string): readonly string[] =>
  normalized(value)
    .split(" ")
    .filter((term) => term.length >= 3 && !RELEVANCE_STOP_WORDS.has(term));

const entityIsVisible = (
  entity: RetrievalEntity,
  playerCharacterId: string,
): boolean =>
  entity.visibility === "Player-visible" &&
  entity.playerCharacterIds.includes(playerCharacterId);

const entityIsExplicitlyLinked = (
  entity: RetrievalEntity,
  utterance: string,
): boolean =>
  [entity.id, entity.name, ...entity.aliases].some(
    (reference) => mentions(utterance, reference),
  );

const entityIsPronounLinked = (
  entity: RetrievalEntity,
  utterance: string,
  activeScene: Scene | null,
  recentEventContext: string,
): boolean =>
  (entity.activeInScene === activeScene ||
    [entity.id, entity.name, ...entity.aliases].some((reference) =>
      mentions(recentEventContext, reference),
    )) &&
  (entity.pronouns ?? []).some((pronoun) => mentions(utterance, pronoun));

const entityItem = (
  entity: RetrievalEntity,
  inclusionReason: string,
): ActorScopedEvidenceItem => ({
  id: `entity:${entity.id}`,
  sourceKind: "retrieved-entity",
  sourceReference: entity.sourceReference,
  content: JSON.stringify({
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    aliases: entity.aliases,
    ...(entity.pronouns === undefined ? {} : { pronouns: entity.pronouns }),
    ...(entity.locationId === undefined ? {} : { locationId: entity.locationId }),
  }),
  inclusionReason,
  visibility: "Player-visible",
  citation: entity.sourceReference,
});

const knowledgeContent = (entry: WorldKnowledgeEntry): string =>
  entry.kind === "Established Fact" ? entry.text : entry.content;

const knowledgeMatches = (
  utterance: string,
  entry: WorldKnowledgeEntry,
): boolean =>
  [
    entry.id,
    knowledgeContent(entry),
    ...(entry.kind === "Relationship"
      ? [entry.relationshipType, entry.sourceId, entry.targetId]
      : []),
  ].some((reference) =>
    significantTerms(reference)
      .some((term) => mentions(utterance, term)),
  );

const knowledgeItem = (
  entry: WorldKnowledgeEntry,
  inclusionReason: string,
): ActorScopedEvidenceItem => ({
  id: `${entry.kind === "Established Fact" ? "fact" : "relationship"}:${entry.id}`,
  sourceKind:
    entry.kind === "Established Fact" ? "established-fact" : "relationship",
  sourceReference: `world-knowledge:${entry.id}`,
  content: knowledgeContent(entry),
  inclusionReason,
  visibility: "Player-visible",
  citation: entry.provenance.sourceReference,
});

const ruleText = (rulesetPackage: ExecutableRulesetPackage): string =>
  [
    rulesetPackage.rule.name.value,
    rulesetPackage.rule.trigger.value,
    ...rulesetPackage.rule.prerequisites.value,
    ...rulesetPackage.rule.inputs.value,
    rulesetPackage.rule.procedure.value,
    ...rulesetPackage.rule.outcomes.value.flatMap(({ name, range }) => [name, range]),
  ].join(" ");

const approvedPackage = (
  candidate: ExecutableRulesetPackage,
): candidate is ExecutableRulesetPackage => {
  try {
    assertApprovedExecutableRulesetPackage(candidate);
    return true;
  } catch {
    return false;
  }
};

const ruleMatches = (
  utterance: string,
  referencedCapabilityKinds: readonly string[],
  referencedConditions: readonly string[],
  rulesetPackage: ExecutableRulesetPackage,
): boolean => {
  const ruleName = rulesetPackage.rule.name.value;
  if (
    mentions(utterance, rulesetPackage.rule.id) ||
    mentions(utterance, ruleName)
  ) {
    return true;
  }
  if (referencedCapabilityKinds.some((kind) => mentions(ruleName, kind))) {
    return true;
  }
  const relevantRuleText = [
    rulesetPackage.rule.trigger.value,
    ...rulesetPackage.rule.inputs.value,
    rulesetPackage.rule.procedure.value,
    ...rulesetPackage.rule.outcomes.value.flatMap(({ name, range }) => [name, range]),
  ].join(" ");
  const genericRuleTerms = new Set([
    "action",
    "character",
    "consequences",
    "goal",
    "meaningful",
    "player",
    "relevant",
  ]);
  const terminologyMatches = significantTerms(relevantRuleText)
    .filter((term) => !genericRuleTerms.has(term))
    .some((term) => mentions(utterance, term));
  const conditionMatches = referencedConditions.some((condition) =>
    mentions(ruleText(rulesetPackage), condition),
  );
  return terminologyMatches || conditionMatches;
};

const ruleItem = (
  rulesetPackage: ExecutableRulesetPackage,
): ActorScopedEvidenceItem => {
  const citations = [
    ...rulesetPackage.rule.name.citations,
    ...rulesetPackage.rule.trigger.citations,
    ...rulesetPackage.rule.prerequisites.citations,
    ...rulesetPackage.rule.inputs.citations,
    ...rulesetPackage.rule.procedure.citations,
    ...rulesetPackage.rule.outcomes.citations,
  ].filter(
    (passage, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.documentId === passage.documentId &&
          candidate.documentVersion === passage.documentVersion &&
          candidate.passageAnchor === passage.passageAnchor,
      ) === index,
  );
  return {
    id: `rule:${rulesetPackage.rule.id}@${rulesetPackage.manifest.version}`,
    sourceKind: "authority-rule",
    sourceReference: `rule-package:${rulesetPackage.manifest.id}@${rulesetPackage.manifest.version}:${rulesetPackage.checksum}`,
    content: ruleText(rulesetPackage),
    inclusionReason:
      "This exact approved rule version matches the utterance's capability, trigger, terminology, Conditions, or rules question.",
    visibility: "Player-visible",
    citation: citations
      .map(
        (passage) =>
          `${passage.documentId}@${passage.documentVersion}#${passage.passageAnchor}`,
      )
      .join(","),
  };
};

const eventContent = (event: CanonicalEvent): string =>
  JSON.stringify({ type: event.type, payload: event.payload });

const eventItem = (
  event: CanonicalEvent,
  causal: boolean,
): ActorScopedEvidenceItem => ({
  id: `event:${event.id}`,
  sourceKind: "accepted-event",
  sourceReference: `adventure-event:${event.id}`,
  content: eventContent(event),
  inclusionReason: causal
    ? "This visible accepted event is causally relevant to an entity or action named in the Player utterance."
    : "This visible accepted event is within the bounded recent Timeline context.",
  visibility: "Player-visible",
  citation: `adventure-event:${event.id}`,
});

export const assembleActorScopedEvidence = (
  input: ActorScopedRetrievalInput,
): ActorScopedEvidenceBundle => {
  validateScope(input);
  const candidates: RankedEvidenceItem<ActorScopedEvidenceItem>[] = [];
  const add = (item: ActorScopedEvidenceItem, priority: number): void => {
    candidates.push({ item, priority, order: candidates.length });
  };
  const visibleEvents = filterCanonicalEventsVisibleTo({
    actorScope: input.scope.actorScope,
    events: input.corpus.acceptedEvents,
  });
  const recentEventContext = [...visibleEvents]
    .reverse()
    .slice(0, 8)
    .map(eventContent)
    .join(" ");

  const visibleEntities = input.corpus.entities.filter((entity) =>
    entityIsVisible(entity, input.scope.playerCharacterId),
  );
  const explicitEntities = visibleEntities.filter((entity) =>
    entityIsExplicitlyLinked(entity, input.utterance),
  );
  const explicitLocationIds = new Set(
    explicitEntities
      .filter((entity) => entity.kind === "Location")
      .map((entity) => entity.id),
  );
  const asksForActiveParticipants = /\b(?:here|present|participants?)\b/i.test(
    input.utterance,
  );
  visibleEntities
    .filter(
      (entity) =>
        explicitEntities.includes(entity) ||
        entityIsPronounLinked(
          entity,
          input.utterance,
          input.view.state.activeScene,
          recentEventContext,
        ) ||
        (entity.locationId !== undefined &&
          explicitLocationIds.has(entity.locationId)) ||
        (asksForActiveParticipants &&
          entity.activeInScene === input.view.state.activeScene),
    )
    .forEach((entity) => {
      const reason = explicitEntities.includes(entity)
        ? "The Player utterance directly identifies this visible campaign entity."
        : entity.locationId !== undefined &&
            explicitLocationIds.has(entity.locationId)
          ? "This visible participant is located at the referenced Location."
          : asksForActiveParticipants &&
              entity.activeInScene === input.view.state.activeScene
            ? "This visible participant is active in the current Scene."
            : "A pronoun in the Player utterance resolves to this visible active or recent referent.";
      add(entityItem(entity, reason), 2);
    });

  // ADR-0005: projection performs Visibility and Knowledge Scope filtering
  // before any candidate enters retrieval ranking or budgeting.
  const visibleKnowledge = projectWorldKnowledge({
    actorScope: input.scope.actorScope,
    events: input.corpus.acceptedEvents,
  }).entries;
  const directlyMatched = visibleKnowledge.filter((entry) =>
    knowledgeMatches(input.utterance, entry),
  );
  const relatedIds = new Set(
    directlyMatched.flatMap((entry) =>
      entry.kind === "Relationship"
        ? [
            entry.sourceId,
            entry.targetId,
            ...entry.requiredWorldKnowledgeIds,
          ]
        : [],
    ),
  );
  directlyMatched
    .filter((entry) => entry.kind === "Relationship")
    .forEach((entry) =>
      add(
        knowledgeItem(
          entry,
          "This visible typed World Knowledge Relationship directly matches the Player utterance.",
        ),
        0,
      ),
    );
  visibleKnowledge
    .filter(
      (entry) =>
        entry.kind === "Established Fact" &&
        (relatedIds.has(entry.id) || directlyMatched.includes(entry)),
    )
    .forEach((entry) =>
      add(
        knowledgeItem(
          entry,
          relatedIds.has(entry.id)
            ? "This visible Established Fact is an endpoint or prerequisite of a retrieved typed relationship."
            : "This visible Established Fact directly matches the Player utterance.",
        ),
        1,
      ),
    );

  input.corpus.approvedRules
    .filter(
      (rulesetPackage) =>
        rulesetPackage.manifest.version === input.scope.rulesetVersion,
    )
    .filter(approvedPackage)
    .filter((rulesetPackage) => {
      const referencedCapabilities = input.view.availableActions.filter(
        (capability) =>
          mentions(input.utterance, capability.id) ||
          mentions(input.utterance, capability.label),
      );
      const referencedConditions = input.view.state.conditions.filter(
        (condition) => mentions(input.utterance, condition),
      );
      return ruleMatches(
        input.utterance,
        referencedCapabilities.map(({ kind }) => kind),
        referencedConditions,
        rulesetPackage,
      );
    })
    .forEach((rulesetPackage) => add(ruleItem(rulesetPackage), 0));

  const lexicalEvents = visibleEvents.filter((event) =>
    significantTerms(eventContent(event))
      .filter((term) => term.length >= 4)
      .some((term) => mentions(input.utterance, term)),
  );
  const causalEventIds = new Set(lexicalEvents.map(({ id }) => id));
  const causalReferences = new Set(
    lexicalEvents.flatMap(({ correlationId, causationId }) => [
      correlationId,
      causationId,
    ]),
  );
  let expanded = true;
  while (expanded) {
    expanded = false;
    visibleEvents.forEach((event) => {
      if (causalEventIds.has(event.id)) return;
      if (
        causalReferences.has(event.id) ||
        causalReferences.has(event.correlationId) ||
        causalReferences.has(event.causationId) ||
        causalEventIds.has(event.causationId)
      ) {
        causalEventIds.add(event.id);
        causalReferences.add(event.correlationId);
        causalReferences.add(event.causationId);
        expanded = true;
      }
    });
  }
  const causalEvents = visibleEvents.filter((event) =>
    causalEventIds.has(event.id),
  );
  causalEvents.forEach((event) => add(eventItem(event, true), 3));
  if (/\b(?:he|her|him|it|recently|she|that|them|they|this|before|happened)\b/i.test(input.utterance)) {
    [...visibleEvents]
      .reverse()
      .slice(0, 3)
      .forEach((event, newestFirstIndex) =>
        add(eventItem(event, false), 10 + newestFirstIndex),
      );
  }

  const maxItems = Math.max(1, input.maxItems ?? 64);
  const items = selectRankedEvidence(candidates, maxItems, true);

  return immutableSnapshot({
    id: evidenceBundleId(items),
    taskType: input.scope.taskType,
    items,
  });
};
