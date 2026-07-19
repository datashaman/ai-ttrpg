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
  | "DUPLICATE_KNOWLEDGE_ID"
  | "CONTRADICTORY_KNOWLEDGE_ID";

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

const entriesEstablishedBy = (
  event: CanonicalEvent,
): readonly WorldKnowledgeEntry[] => {
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

const normalizedEntries = (
  events: readonly CanonicalEvent[],
): readonly WorldKnowledgeEntry[] => {
  const entries = new Map<string, WorldKnowledgeEntry>();
  events
    .flatMap(entriesEstablishedBy)
    .forEach((entry) => insertUniqueEntry(entries, entry));
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
  const established = new Map(
    normalizedEntries(input.currentEvents).map((entry) => [entry.id, entry]),
  );
  input.proposedEvents
    .flatMap(entriesEstablishedBy)
    .forEach((entry) => insertUniqueEntry(established, entry));
};

export const projectWorldKnowledge = (
  query: WorldKnowledgeQuery,
): WorldKnowledgeProjection => {
  if (query.actorScope !== "Player" && query.actorScope !== "Game Master") {
    throw new WorldKnowledgeError(
      "INVALID_ACTOR_SCOPE",
      "World Knowledge requires an explicit Player or Game Master actor scope.",
    );
  }
  const entries = normalizedEntries(query.events).filter((entry) =>
    isVisibleTo(entry, query.actorScope),
  );
  return immutableSnapshot({ actorScope: query.actorScope, entries });
};
