import type { CanonicalEvent, EstablishedFact } from "./structured-play.js";

export type WorldKnowledgeActorScope = "Player" | "Game Master";
export type WorldKnowledgeVisibility = "Player-visible" | "Game Master-only";
export type KnowledgeScope = "Player Character" | "Game Master";
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

export interface WorldKnowledgeEntry {
  readonly id: string;
  readonly kind: "Established Fact";
  readonly text: string;
  readonly provenance: Provenance;
  readonly visibility: WorldKnowledgeVisibility;
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export interface WorldKnowledgeEstablishedPayload {
  readonly fact: EstablishedFact;
  readonly provenance: Omit<Provenance, "establishedByEventId">;
  readonly visibility: WorldKnowledgeVisibility;
  readonly knowledgeScope: readonly KnowledgeScope[];
}

export interface WorldKnowledgeRevealedPayload {
  readonly worldKnowledgeId: string;
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

export const isWorldKnowledgeEstablishedPayload = (
  value: unknown,
): value is WorldKnowledgeEstablishedPayload => {
  if (!isRecord(value)) return false;
  const fact = value.fact;
  const provenance = value.provenance;
  const knowledgeScope = value.knowledgeScope;
  const validOriginKinds: readonly ProvenanceOriginKind[] = [
    "authored-content",
    "imported-content",
    "human-action",
    "rule-outcome",
    "validated-model-proposal",
  ];
  const validKnowledgeScopes: readonly KnowledgeScope[] = [
    "Player Character",
    "Game Master",
  ];
  return (
    isRecord(fact) &&
    isNonEmptyString(fact.id) &&
    isNonEmptyString(fact.text) &&
    isRecord(provenance) &&
    validOriginKinds.includes(provenance.originKind as ProvenanceOriginKind) &&
    isNonEmptyString(provenance.sourceReference) &&
    (value.visibility === "Player-visible" ||
      value.visibility === "Game Master-only") &&
    Array.isArray(knowledgeScope) &&
    knowledgeScope.length > 0 &&
    knowledgeScope.every((scope) =>
      validKnowledgeScopes.includes(scope as KnowledgeScope),
    ) &&
    new Set(knowledgeScope).size === knowledgeScope.length
  );
};

export const isWorldKnowledgeRevealedPayload = (
  value: unknown,
): value is WorldKnowledgeRevealedPayload =>
  isRecord(value) &&
  isNonEmptyString(value.worldKnowledgeId) &&
  isPlayerCharacterRevealScope(value.knowledgeScope);

export const isPlayerCharacterRevealScope = (
  value: unknown,
): value is readonly ["Game Master", "Player Character"] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value[0] === "Game Master" &&
  value[1] === "Player Character";

const authoredEntryEstablishedBy = (
  event: Extract<CanonicalEvent, { readonly type: "WorldKnowledgeEstablished" }>,
): WorldKnowledgeEntry => {
  const payload: unknown = event.payload;
  if (!isWorldKnowledgeEstablishedPayload(payload)) {
    throw new WorldKnowledgeError(
      "INVALID_KNOWLEDGE_ENTRY",
      "World Knowledge metadata is invalid.",
    );
  }
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

const entriesEstablishedBy = (
  event: CanonicalEvent,
): readonly WorldKnowledgeEntry[] => {
  if (event.type === "WorldKnowledgeEstablished") {
    return [authoredEntryEstablishedBy(event)];
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
    entriesEstablishedBy(event).forEach((entry) =>
      insertUniqueEntry(entries, entry),
    );
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
    entries.set(existing.id, {
      ...existing,
      visibility: "Player-visible",
      knowledgeScope: event.payload.knowledgeScope,
    });
  });
  return [...entries.values()];
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
  const contradictory = existing.text !== entry.text;
  throw new WorldKnowledgeError(
    contradictory
      ? "CONTRADICTORY_KNOWLEDGE_ID"
      : "DUPLICATE_KNOWLEDGE_ID",
    contradictory
      ? `World Knowledge ID "${entry.id}" has contradictory Established Fact text.`
      : `World Knowledge ID "${entry.id}" is already established.`,
  );
};

const isVisibleTo = (
  entry: WorldKnowledgeEntry,
  actorScope: WorldKnowledgeActorScope,
): boolean =>
  actorScope === "Game Master" || entry.visibility === "Player-visible";

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
  const entries = replayWorldKnowledgeEntries(query.events).filter((entry) =>
    isVisibleTo(entry, query.actorScope),
  );
  return immutableSnapshot({ actorScope: query.actorScope, entries });
};

const assertWorldKnowledgeActorScope = (
  actorScope: WorldKnowledgeActorScope,
): void => {
  if (actorScope === "Player" || actorScope === "Game Master") return;
  throw new WorldKnowledgeError(
    "INVALID_ACTOR_SCOPE",
    "World Knowledge requires an explicit Player or Game Master actor scope.",
  );
};

export const filterCanonicalEventsVisibleTo = (
  query: WorldKnowledgeQuery,
): readonly CanonicalEvent[] => {
  assertWorldKnowledgeActorScope(query.actorScope);
  return query.events.filter(
    (event) =>
      event.type !== "WorldKnowledgeEstablished" ||
      query.actorScope === "Game Master" ||
      event.payload.visibility === "Player-visible",
  );
};
