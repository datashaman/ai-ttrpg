import type { CanonicalEvent, EstablishedFact } from "./structured-play.js";

export const DEFAULT_PLAYER_CHARACTER_ID = "player-character:primary";

export interface PlayerWorldKnowledgeActorScope {
  readonly kind: "Player";
  readonly playerCharacterId: string;
}

export interface GameMasterWorldKnowledgeActorScope {
  readonly kind: "Game Master";
}

export interface UnauthenticatedWorldKnowledgeActorScope {
  readonly kind: "Unauthenticated";
}

export type WorldKnowledgeActorScope =
  | PlayerWorldKnowledgeActorScope
  | GameMasterWorldKnowledgeActorScope
  | UnauthenticatedWorldKnowledgeActorScope;

export const playerWorldKnowledgeActorScope = (
  playerCharacterId: string,
): PlayerWorldKnowledgeActorScope =>
  Object.freeze({ kind: "Player", playerCharacterId });

export const DEFAULT_PLAYER_ACTOR_SCOPE =
  playerWorldKnowledgeActorScope(DEFAULT_PLAYER_CHARACTER_ID);

export const GAME_MASTER_ACTOR_SCOPE: GameMasterWorldKnowledgeActorScope =
  Object.freeze({ kind: "Game Master" });

export const UNAUTHENTICATED_ACTOR_SCOPE: UnauthenticatedWorldKnowledgeActorScope =
  Object.freeze({ kind: "Unauthenticated" });
export type WorldKnowledgeVisibility = "Player-visible" | "Game Master-only";
export interface PlayerCharacterKnowledgeScope {
  readonly kind: "Player Character";
  readonly playerCharacterId: string;
}

/** Format-v1 shorthand retained for the primary Player Character. */
export type KnowledgeScope =
  | PlayerCharacterKnowledgeScope
  | "Player Character"
  | "Game Master";
export type ProvenanceOriginKind =
  | "authored-content"
  | "imported-content"
  | "human-action"
  | "rule-outcome"
  | "validated-model-proposal";

export interface Provenance {
  readonly originKind: ProvenanceOriginKind;
  readonly sourceReference: string;
  readonly establishedByEventId: string;
}

export interface WorldKnowledgeFactEntry {
  readonly id: string;
  readonly kind: "Established Fact";
  readonly text: string;
  readonly provenance: Provenance;
  readonly visibility: WorldKnowledgeVisibility;
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export interface WorldKnowledgeRelationshipEntry {
  readonly id: string;
  readonly kind: "Relationship";
  readonly relationshipType: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly content: string;
  readonly requiredWorldKnowledgeIds: readonly string[];
  readonly provenance: Provenance;
  readonly visibility: WorldKnowledgeVisibility;
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export type WorldKnowledgeEntry =
  | WorldKnowledgeFactEntry
  | WorldKnowledgeRelationshipEntry;

export interface WorldKnowledgeFactEstablishedPayload {
  readonly fact: EstablishedFact;
  readonly provenance: Omit<Provenance, "establishedByEventId">;
  readonly visibility: WorldKnowledgeVisibility;
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export interface WorldKnowledgeEstablishedPayload
  extends WorldKnowledgeFactEstablishedPayload {
  readonly endpointFacts?: readonly WorldKnowledgeFactEstablishedPayload[];
  readonly relationships?: readonly WorldKnowledgeRelationshipEstablishedPayload[];
}

export interface WorldKnowledgeRevealedPayload {
  readonly worldKnowledgeId: string;
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export interface WorldKnowledgeRelationshipEstablishedPayload {
  readonly relationship: {
    readonly id: string;
    readonly type: string;
    readonly sourceId: string;
    readonly targetId: string;
    readonly content: string;
    readonly requiredWorldKnowledgeIds: readonly string[];
  };
  readonly provenance: Omit<Provenance, "establishedByEventId">;
  readonly visibility: WorldKnowledgeVisibility;
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export interface WorldKnowledgeProjection {
  readonly actorScope: WorldKnowledgeActorScope;
  readonly entries: readonly WorldKnowledgeEntry[];
}

export interface WorldKnowledgeQuery {
  readonly actorScope: WorldKnowledgeActorScope;
  readonly events: readonly CanonicalEvent[];
}

export interface WorldKnowledgeAppendValidation {
  readonly currentEvents: readonly CanonicalEvent[];
  readonly proposedEvents: readonly CanonicalEvent[];
}

export type WorldKnowledgeErrorCode =
  | "INVALID_ACTOR_SCOPE"
  | "INVALID_KNOWLEDGE_ENTRY"
  | "DUPLICATE_KNOWLEDGE_ID"
  | "CONTRADICTORY_KNOWLEDGE_ID"
  | "RELATIONSHIP_ENDPOINT_NOT_FOUND"
  | "RELATIONSHIP_KNOWLEDGE_NOT_FOUND"
  | "RELATIONSHIP_VISIBILITY_EXCEEDED"
  | "INVALID_REVEAL"
  | "KNOWLEDGE_NOT_FOUND"
  | "KNOWLEDGE_ALREADY_REVEALED";

export class WorldKnowledgeError extends Error {
  readonly code: WorldKnowledgeErrorCode;

  constructor(code: WorldKnowledgeErrorCode, reason: string) {
    super(`${reason} [${code}]`);
    this.name = "WorldKnowledgeError";
    this.code = code;
  }
}

const immutableSnapshot = <Value>(value: Value): Value => {
  const snapshot = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null) return;
    Object.freeze(candidate);
    Object.values(candidate).forEach(freeze);
  };
  freeze(snapshot);
  return snapshot;
};

const knowledgeEntry = (
  fact: EstablishedFact,
  event: CanonicalEvent,
  originKind: ProvenanceOriginKind,
  sourceReference: string,
): WorldKnowledgeEntry => ({
  id: fact.id,
  kind: "Established Fact",
  text: fact.text,
  provenance: {
    originKind,
    sourceReference,
    establishedByEventId: event.id,
  },
  visibility: "Player-visible",
  knowledgeScope: ["Player Character"],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const PROVENANCE_ORIGIN_KINDS: readonly ProvenanceOriginKind[] = [
  "authored-content",
  "imported-content",
  "human-action",
  "rule-outcome",
  "validated-model-proposal",
];
const isPlayerCharacterKnowledgeScope = (
  value: unknown,
): value is PlayerCharacterKnowledgeScope =>
  isRecord(value) &&
  value.kind === "Player Character" &&
  isNonEmptyString(value.playerCharacterId);

const isKnowledgeScopeItem = (value: unknown): value is KnowledgeScope =>
  value === "Player Character" ||
  value === "Game Master" ||
  isPlayerCharacterKnowledgeScope(value);

const knowledgeScopeKey = (scope: KnowledgeScope): string =>
  typeof scope === "string"
    ? scope
    : `${scope.kind}:${scope.playerCharacterId}`;

const isProvenanceDefinition = (
  value: unknown,
): value is Omit<Provenance, "establishedByEventId"> =>
  isRecord(value) &&
  PROVENANCE_ORIGIN_KINDS.includes(
    value.originKind as ProvenanceOriginKind,
  ) &&
  isNonEmptyString(value.sourceReference);

const isWorldKnowledgeVisibility = (
  value: unknown,
): value is WorldKnowledgeVisibility =>
  value === "Player-visible" || value === "Game Master-only";

const isKnowledgeScope = (
  value: unknown,
): value is readonly KnowledgeScope[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(isKnowledgeScopeItem) &&
  new Set(value.map(knowledgeScopeKey)).size === value.length;

const hasPlayerCharacterKnowledgeScope = (
  knowledgeScope: readonly KnowledgeScope[],
): boolean =>
  knowledgeScope.some(
    (scope) =>
      scope === "Player Character" || isPlayerCharacterKnowledgeScope(scope),
  );

const isKnownByPlayerCharacter = (
  knowledgeScope: readonly KnowledgeScope[],
  playerCharacterId: string,
): boolean =>
  knowledgeScope.some(
    (scope) =>
      (scope === "Player Character" &&
        playerCharacterId === DEFAULT_PLAYER_CHARACTER_ID) ||
      (isPlayerCharacterKnowledgeScope(scope) &&
        scope.playerCharacterId === playerCharacterId),
  );

const isVisibilityCompatibleWithKnowledgeScope = (
  visibility: WorldKnowledgeVisibility,
  knowledgeScope: readonly KnowledgeScope[],
): boolean =>
  visibility === "Player-visible"
    ? hasPlayerCharacterKnowledgeScope(knowledgeScope)
    : !hasPlayerCharacterKnowledgeScope(knowledgeScope);

const isWorldKnowledgeFactEstablishedPayload = (
  value: unknown,
): value is WorldKnowledgeFactEstablishedPayload => {
  if (!isRecord(value)) return false;
  const fact = value.fact;
  const provenance = value.provenance;
  const knowledgeScope = value.knowledgeScope;
  return (
    isRecord(fact) &&
    isNonEmptyString(fact.id) &&
    isNonEmptyString(fact.text) &&
    isProvenanceDefinition(provenance) &&
    isWorldKnowledgeVisibility(value.visibility) &&
    isKnowledgeScope(knowledgeScope) &&
    isVisibilityCompatibleWithKnowledgeScope(value.visibility, knowledgeScope)
  );
};

export const isWorldKnowledgeEstablishedPayload = (
  value: unknown,
): value is WorldKnowledgeEstablishedPayload => {
  if (!isRecord(value) || !isWorldKnowledgeFactEstablishedPayload(value)) {
    return false;
  }
  return (
    (value.endpointFacts === undefined ||
      (Array.isArray(value.endpointFacts) &&
        value.endpointFacts.every(isWorldKnowledgeFactEstablishedPayload))) &&
    (value.relationships === undefined ||
      (Array.isArray(value.relationships) &&
        value.relationships.every(
          isWorldKnowledgeRelationshipEstablishedPayload,
        )))
  );
};

export const isWorldKnowledgeRevealedPayload = (
  value: unknown,
): value is WorldKnowledgeRevealedPayload =>
  isRecord(value) &&
  isNonEmptyString(value.worldKnowledgeId) &&
  isPlayerCharacterRevealScope(value.knowledgeScope);

export const isWorldKnowledgeRelationshipEstablishedPayload = (
  value: unknown,
): value is WorldKnowledgeRelationshipEstablishedPayload => {
  if (!isRecord(value)) return false;
  const relationship = value.relationship;
  const provenance = value.provenance;
  const knowledgeScope = value.knowledgeScope;
  if (!isRecord(relationship) || !isRecord(provenance)) return false;
  return (
    isNonEmptyString(relationship.id) &&
    isNonEmptyString(relationship.type) &&
    isNonEmptyString(relationship.sourceId) &&
    isNonEmptyString(relationship.targetId) &&
    isNonEmptyString(relationship.content) &&
    Array.isArray(relationship.requiredWorldKnowledgeIds) &&
    relationship.requiredWorldKnowledgeIds.length > 0 &&
    relationship.requiredWorldKnowledgeIds.every(isNonEmptyString) &&
    new Set(relationship.requiredWorldKnowledgeIds).size ===
      relationship.requiredWorldKnowledgeIds.length &&
    isProvenanceDefinition(provenance) &&
    isWorldKnowledgeVisibility(value.visibility) &&
    isKnowledgeScope(knowledgeScope) &&
    isVisibilityCompatibleWithKnowledgeScope(value.visibility, knowledgeScope)
  );
};

export const isPlayerCharacterRevealScope = (
  value: unknown,
): value is readonly [
  "Game Master",
  PlayerCharacterKnowledgeScope | "Player Character",
] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value[0] === "Game Master" &&
  (value[1] === "Player Character" ||
    isPlayerCharacterKnowledgeScope(value[1]));

const authoredFactEstablishedBy = (
  payload: WorldKnowledgeFactEstablishedPayload,
  event: CanonicalEvent,
): WorldKnowledgeEntry => {
  return {
    id: payload.fact.id,
    kind: "Established Fact",
    text: payload.fact.text,
    provenance: {
      ...payload.provenance,
      establishedByEventId: event.id,
    },
    visibility: payload.visibility,
    knowledgeScope: payload.knowledgeScope,
  };
};

const authoredRelationshipEstablishedBy = (
  payload: WorldKnowledgeRelationshipEstablishedPayload,
  event: CanonicalEvent,
): WorldKnowledgeRelationshipEntry => ({
  id: payload.relationship.id,
  kind: "Relationship",
  relationshipType: payload.relationship.type,
  sourceId: payload.relationship.sourceId,
  targetId: payload.relationship.targetId,
  content: payload.relationship.content,
  requiredWorldKnowledgeIds: payload.relationship.requiredWorldKnowledgeIds,
  provenance: {
    ...payload.provenance,
    establishedByEventId: event.id,
  },
  visibility: payload.visibility,
  knowledgeScope: payload.knowledgeScope,
});

const entriesEstablishedBy = (
  event: CanonicalEvent,
): readonly WorldKnowledgeEntry[] => {
  if (event.type === "WorldKnowledgeEstablished") {
    const payload = event.payload;
    if (!isWorldKnowledgeEstablishedPayload(payload)) {
      throw new WorldKnowledgeError(
        "INVALID_KNOWLEDGE_ENTRY",
        "World Knowledge metadata is invalid.",
      );
    }
    return [
      authoredFactEstablishedBy(payload, event),
      ...(payload.endpointFacts ?? []).map((fact) =>
        authoredFactEstablishedBy(fact, event),
      ),
      ...(payload.relationships ?? []).map((relationship) =>
        authoredRelationshipEstablishedBy(relationship, event),
      ),
    ];
  }
  if (event.type === "FreeActionCompleted") {
    return [
      knowledgeEntry(
        event.payload.establishedFact,
        event,
        "authored-content",
        `free-action:${event.payload.actionId}`,
      ),
    ];
  }
  if (event.type === "CheckResolved") {
    const sourceReference =
      `check-action:${event.payload.actionId}:${event.payload.outcome}`;
    return event.payload.committedStake.consequences.flatMap((consequence) =>
      consequence.type === "establish-fact"
        ? [
            knowledgeEntry(
              consequence.fact,
              event,
              "rule-outcome",
              sourceReference,
            ),
          ]
        : [],
    );
  }
  if (event.type === "ConfrontationEnded") {
    return [
      knowledgeEntry(
        event.payload.ending.establishedFact,
        event,
        "rule-outcome",
        `confrontation:${event.payload.confrontationId}:${event.payload.ending.reason}`,
      ),
    ];
  }
  if (event.type === "OracleAnswered") {
    const sourceReference =
      `oracle:${event.payload.trace.proposition.id}:${event.payload.trace.result.answer}`;
    const exceptionalFact =
      event.payload.trace.result.exceptionalConsequence?.establishedFact;
    return [
      knowledgeEntry(
        event.payload.establishedFact,
        event,
        "rule-outcome",
        sourceReference,
      ),
      ...(exceptionalFact === undefined
        ? []
        : [
            knowledgeEntry(
              exceptionalFact,
              event,
              "rule-outcome",
              sourceReference,
            ),
          ]),
    ];
  }
  return [];
};

const replayWorldKnowledgeEntries = (
  events: readonly CanonicalEvent[],
): readonly WorldKnowledgeEntry[] => {
  const entries = new Map<string, WorldKnowledgeEntry>();
  events.forEach((event) => {
    entriesEstablishedBy(event).forEach((entry) => {
      if (entry.kind === "Relationship") {
        validateRelationshipKnowledge(entry, entries);
      }
      insertUniqueEntry(entries, entry);
    });
    if (event.type !== "WorldKnowledgeRevealed") return;
    if (!isWorldKnowledgeRevealedPayload(event.payload)) {
      throw new WorldKnowledgeError(
        "INVALID_REVEAL",
        "World Knowledge Reveal metadata is invalid.",
      );
    }
    const existing = entries.get(event.payload.worldKnowledgeId);
    if (existing === undefined) {
      throw new WorldKnowledgeError(
        "KNOWLEDGE_NOT_FOUND",
        "World Knowledge Reveal target does not exist.",
      );
    }
    if (existing.visibility === "Player-visible") {
      throw new WorldKnowledgeError(
        "KNOWLEDGE_ALREADY_REVEALED",
        "World Knowledge is already Player-visible.",
      );
    }
    if (existing.kind === "Relationship") {
      existing.requiredWorldKnowledgeIds.forEach((knowledgeId) => {
        const required = entries.get(knowledgeId);
        if (
          required === undefined ||
          required.kind !== "Established Fact" ||
          required.visibility !== "Player-visible"
        ) {
          throw new WorldKnowledgeError(
            "RELATIONSHIP_VISIBILITY_EXCEEDED",
            "World Knowledge Relationship cannot become visible before its required knowledge.",
          );
        }
      });
      [existing.sourceId, existing.targetId].forEach((endpointId) => {
        const endpoint = entries.get(endpointId)!;
        entries.set(endpointId, {
          ...endpoint,
          visibility: "Player-visible",
          knowledgeScope: event.payload.knowledgeScope,
        });
      });
    }
    entries.set(existing.id, {
      ...existing,
      visibility: "Player-visible",
      knowledgeScope: event.payload.knowledgeScope,
    });
  });
  return [...entries.values()];
};

const validateRelationshipKnowledge = (
  relationship: WorldKnowledgeRelationshipEntry,
  entries: ReadonlyMap<string, WorldKnowledgeEntry>,
): void => {
  const endpoints = [
    entries.get(relationship.sourceId),
    entries.get(relationship.targetId),
  ];
  if (
    endpoints.some(
      (entry) => entry === undefined || entry.kind !== "Established Fact",
    )
  ) {
    throw new WorldKnowledgeError(
      "RELATIONSHIP_ENDPOINT_NOT_FOUND",
      "World Knowledge Relationship endpoint does not exist.",
    );
  }
  const requiredEntries = relationship.requiredWorldKnowledgeIds.map(
    (knowledgeId) => entries.get(knowledgeId),
  );
  if (
    requiredEntries.some(
      (entry) => entry === undefined || entry.kind !== "Established Fact",
    )
  ) {
    throw new WorldKnowledgeError(
      "RELATIONSHIP_KNOWLEDGE_NOT_FOUND",
      "World Knowledge Relationship requires an existing Established Fact.",
    );
  }
  if (
    relationship.visibility === "Player-visible" &&
    [...endpoints, ...requiredEntries].some(
      (entry) => entry!.visibility !== "Player-visible",
    )
  ) {
    throw new WorldKnowledgeError(
      "RELATIONSHIP_VISIBILITY_EXCEEDED",
      "World Knowledge Relationship visibility exceeds its required knowledge.",
    );
  }
};

const insertUniqueEntry = (
  entries: Map<string, WorldKnowledgeEntry>,
  entry: WorldKnowledgeEntry,
): void => {
  const existing = entries.get(entry.id);
  if (existing === undefined) {
    entries.set(entry.id, entry);
    return;
  }
  const contradictory =
    existing.kind !== entry.kind ||
    (existing.kind === "Established Fact" &&
      entry.kind === "Established Fact" &&
      existing.text !== entry.text) ||
    (existing.kind === "Relationship" &&
      entry.kind === "Relationship" &&
      (existing.relationshipType !== entry.relationshipType ||
        existing.sourceId !== entry.sourceId ||
        existing.targetId !== entry.targetId ||
        existing.content !== entry.content ||
        JSON.stringify(existing.requiredWorldKnowledgeIds) !==
          JSON.stringify(entry.requiredWorldKnowledgeIds)));
  throw new WorldKnowledgeError(
    contradictory
      ? "CONTRADICTORY_KNOWLEDGE_ID"
      : "DUPLICATE_KNOWLEDGE_ID",
    contradictory
      ? `World Knowledge ID "${entry.id}" has a contradictory definition.`
      : `World Knowledge ID "${entry.id}" is already established.`,
  );
};

const isVisibleTo = (
  entry: WorldKnowledgeEntry,
  actorScope: WorldKnowledgeActorScope,
): boolean =>
  actorScope.kind === "Game Master" ||
  (actorScope.kind === "Player" &&
    entry.visibility === "Player-visible" &&
    isKnownByPlayerCharacter(
      entry.knowledgeScope,
      actorScope.playerCharacterId,
    ));

export const validateWorldKnowledgeAppend = (
  input: WorldKnowledgeAppendValidation,
): void => {
  replayWorldKnowledgeEntries([
    ...input.currentEvents,
    ...input.proposedEvents,
  ]);
};

export const projectWorldKnowledge = (
  query: WorldKnowledgeQuery,
): WorldKnowledgeProjection => {
  assertWorldKnowledgeActorScope(query.actorScope);
  const entries = replayWorldKnowledgeEntries(
    filterCanonicalEventsForActor(query, true),
  ).filter((entry) => isVisibleTo(entry, query.actorScope));
  return immutableSnapshot({ actorScope: query.actorScope, entries });
};

const assertWorldKnowledgeActorScope = (
  actorScope: WorldKnowledgeActorScope,
): void => {
  if (
    isRecord(actorScope) &&
    (actorScope.kind === "Game Master" ||
      actorScope.kind === "Unauthenticated" ||
      (actorScope.kind === "Player" &&
        isNonEmptyString(actorScope.playerCharacterId)))
  ) {
    return;
  }
  throw new WorldKnowledgeError(
    "INVALID_ACTOR_SCOPE",
    "World Knowledge requires an explicit actor scope and Player Character identity for a Player.",
  );
};

const filterCanonicalEventsForActor = (
  query: WorldKnowledgeQuery,
  includeRevealedSources: boolean,
): readonly CanonicalEvent[] => {
  assertWorldKnowledgeActorScope(query.actorScope);
  if (query.actorScope.kind === "Game Master") return query.events;
  if (query.actorScope.kind === "Unauthenticated") return [];
  const playerCharacterId = query.actorScope.playerCharacterId;
  const revealedIds = new Set(
    includeRevealedSources
      ? query.events.flatMap((event) =>
          event.type === "WorldKnowledgeRevealed" &&
          isKnownByPlayerCharacter(
            event.payload.knowledgeScope,
            playerCharacterId,
          )
            ? [event.payload.worldKnowledgeId]
            : [],
        )
      : [],
  );
  const revealedRelationshipEndpointIds = new Set(
    query.events.flatMap((event) =>
      event.type === "WorldKnowledgeEstablished"
        ? (event.payload.relationships ?? []).flatMap(({ relationship }) =>
            revealedIds.has(relationship.id)
              ? [relationship.sourceId, relationship.targetId]
              : [],
          )
        : [],
    ),
  );
  const payloadIsVisible = (
    payload: WorldKnowledgeFactEstablishedPayload,
  ): boolean =>
    (payload.visibility === "Player-visible" &&
      isKnownByPlayerCharacter(
        payload.knowledgeScope,
        playerCharacterId,
      )) ||
    revealedIds.has(payload.fact.id) ||
    revealedRelationshipEndpointIds.has(payload.fact.id);
  return query.events.reduce<CanonicalEvent[]>((visibleEvents, event) => {
    if (event.type === "WorldKnowledgeRevealed") {
      if (
        isKnownByPlayerCharacter(
          event.payload.knowledgeScope,
          playerCharacterId,
        )
      ) {
        visibleEvents.push(event);
      }
      return visibleEvents;
    }
    if (event.type !== "WorldKnowledgeEstablished") {
      if (playerCharacterId === DEFAULT_PLAYER_CHARACTER_ID) {
        visibleEvents.push(event);
      }
      return visibleEvents;
    }
    if (
      !payloadIsVisible(event.payload)
    ) {
      return visibleEvents;
    }
    const visibleRelationships = (event.payload.relationships ?? []).filter(
      (relationship) =>
        (relationship.visibility === "Player-visible" &&
          isKnownByPlayerCharacter(
            relationship.knowledgeScope,
            playerCharacterId,
          )) ||
        revealedIds.has(relationship.relationship.id),
    );
    visibleEvents.push(
      ({
        ...event,
        payload: {
          ...event.payload,
          ...(event.payload.endpointFacts === undefined
            ? {}
            : {
                endpointFacts: event.payload.endpointFacts.filter(
                  (fact) =>
                    payloadIsVisible(fact),
                ),
              }),
          ...(event.payload.relationships === undefined
            ? {}
            : { relationships: visibleRelationships }),
        },
      }) as CanonicalEvent,
    );
    return visibleEvents;
  }, []);
};

export const filterCanonicalEventsVisibleTo = (
  query: WorldKnowledgeQuery,
): readonly CanonicalEvent[] => filterCanonicalEventsForActor(query, false);
