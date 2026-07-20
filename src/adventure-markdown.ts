import { createHash } from "node:crypto";

import { isCanonicalEventEnvelope } from "./canonical-event-validation.js";
import { canonicalHistoryRevision } from "./canonical-history-revision.js";
import { immutableSnapshot, isRecord } from "./model-boundary.js";
import type {
  CanonicalEvent,
  ReviewWorldKnowledgeReveal,
} from "./structured-play.js";
import {
  filterCanonicalEventsVisibleTo,
  isWorldKnowledgeEstablishedPayload,
  isWorldKnowledgeRelationshipEstablishedPayload,
  isPlayerCharacterRevealScope,
  projectWorldKnowledge,
  type WorldKnowledgeActorScope,
  type WorldKnowledgeFactEntry,
  type WorldKnowledgeRelationshipEntry,
} from "./world-knowledge.js";

export interface AdventureMarkdownDocument {
  readonly format: "ai-ttrpg-adventure-markdown-v1";
  readonly revision: string;
  readonly adventureId: string;
  readonly adventureName: string;
  readonly timelineId: string;
  readonly actorScope: WorldKnowledgeActorScope;
  readonly entities: readonly WorldKnowledgeFactEntry[];
  readonly relationships: readonly WorldKnowledgeRelationshipEntry[];
  readonly events: readonly CanonicalEvent[];
}

export interface RenderedAdventureMarkdown {
  readonly markdown: string;
  readonly document: AdventureMarkdownDocument;
}

export interface AdventureMarkdownRenderInput {
  readonly adventureId: string;
  readonly adventureName: string;
  readonly timelineId: string;
  readonly actorScope: WorldKnowledgeActorScope;
  readonly events: readonly CanonicalEvent[];
}

export type AdventureMarkdownConflictCode =
  | "stale"
  | "simultaneous"
  | "contradictory"
  | "malformed"
  | "unauthorized";

export type AdventureMarkdownReview =
  | { readonly status: "unchanged" }
  | {
      readonly status: "command";
      readonly command: ReviewWorldKnowledgeReveal;
    }
  | {
      readonly status: "conflict";
      readonly code: AdventureMarkdownConflictCode;
      readonly message: string;
    };

export interface AdventureMarkdownReviewInput {
  readonly base: AdventureMarkdownDocument;
  readonly editedMarkdown: string;
  readonly current: AdventureMarkdownRenderInput;
  readonly reviewerScope: WorldKnowledgeActorScope;
}

export class AdventureMarkdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdventureMarkdownError";
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean =>
  Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");

const isActorScope = (value: unknown): value is WorldKnowledgeActorScope => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "Player") {
    return (
      hasExactKeys(value, ["kind", "playerCharacterId"]) &&
      isNonEmptyString(value.playerCharacterId)
    );
  }
  return (
    (value.kind === "Game Master" || value.kind === "Unauthenticated") &&
    hasExactKeys(value, ["kind"])
  );
};

const isFactEntry = (value: unknown): value is WorldKnowledgeFactEntry => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "kind",
      "text",
      "provenance",
      "visibility",
      "knowledgeScope",
    ]) ||
    value.kind !== "Established Fact" ||
    !isRecord(value.provenance) ||
    !isNonEmptyString(value.provenance.establishedByEventId)
  ) {
    return false;
  }
  return isWorldKnowledgeEstablishedPayload({
    fact: { id: value.id, text: value.text },
    provenance: {
      originKind: value.provenance.originKind,
      sourceReference: value.provenance.sourceReference,
    },
    visibility: value.visibility,
    knowledgeScope: value.knowledgeScope,
  });
};

const isRelationshipEntry = (
  value: unknown,
): value is WorldKnowledgeRelationshipEntry => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "kind",
      "relationshipType",
      "sourceId",
      "targetId",
      "content",
      "requiredWorldKnowledgeIds",
      "provenance",
      "visibility",
      "knowledgeScope",
    ]) ||
    value.kind !== "Relationship" ||
    !isRecord(value.provenance) ||
    !isNonEmptyString(value.provenance.establishedByEventId)
  ) {
    return false;
  }
  return isWorldKnowledgeRelationshipEstablishedPayload({
    relationship: {
      id: value.id,
      type: value.relationshipType,
      sourceId: value.sourceId,
      targetId: value.targetId,
      content: value.content,
      requiredWorldKnowledgeIds: value.requiredWorldKnowledgeIds,
    },
    provenance: {
      originKind: value.provenance.originKind,
      sourceReference: value.provenance.sourceReference,
    },
    visibility: value.visibility,
    knowledgeScope: value.knowledgeScope,
  });
};

const areCanonicalEvents = (value: unknown): value is readonly CanonicalEvent[] => {
  if (!Array.isArray(value)) return false;
  let previousSequence = 0;
  return value.every((event) => {
    if (
      !isRecord(event) ||
      !Number.isInteger(event.sequence) ||
      (event.sequence as number) <= previousSequence
    ) {
      return false;
    }
    previousSequence = event.sequence as number;
    return isCanonicalEventEnvelope(event, previousSequence);
  });
};

const isAdventureMarkdownDocument = (
  value: unknown,
): value is AdventureMarkdownDocument =>
  isRecord(value) &&
  hasExactKeys(value, [
    "format",
    "revision",
    "adventureId",
    "adventureName",
    "timelineId",
    "actorScope",
    "entities",
    "relationships",
    "events",
  ]) &&
  value.format === "ai-ttrpg-adventure-markdown-v1" &&
  typeof value.revision === "string" &&
  /^[0-9a-f]{64}$/.test(value.revision) &&
  isNonEmptyString(value.adventureId) &&
  isNonEmptyString(value.adventureName) &&
  isNonEmptyString(value.timelineId) &&
  isActorScope(value.actorScope) &&
  Array.isArray(value.entities) &&
  value.entities.every(isFactEntry) &&
  Array.isArray(value.relationships) &&
  value.relationships.every(isRelationshipEntry) &&
  areCanonicalEvents(value.events);

const revisionFor = (
  document: Omit<AdventureMarkdownDocument, "revision">,
): string =>
  createHash("sha256").update(JSON.stringify(document)).digest("hex");

const proseFor = (document: AdventureMarkdownDocument): string => {
  const facts = document.entities
    .map((entry) => `- **${entry.id}**: ${entry.text}`)
    .join("\n");
  const relationships = document.relationships
    .map(
      (entry) =>
        `- **${entry.id}**: ${entry.content} (${entry.sourceId} ${entry.relationshipType} ${entry.targetId})`,
    )
    .join("\n");
  return [
    `# ${document.adventureName} World Knowledge`,
    "",
    "## Established Facts",
    "",
    facts || "_None._",
    "",
    "## Relationships",
    "",
    relationships || "_None._",
    "",
  ].join("\n");
};

const markdownFor = (document: AdventureMarkdownDocument): string =>
  `---\n${JSON.stringify(document, null, 2)}\n---\n\n${proseFor(document)}`;

export const renderAdventureMarkdown = (
  input: AdventureMarkdownRenderInput,
): RenderedAdventureMarkdown => {
  const projection = projectWorldKnowledge({
    actorScope: input.actorScope,
    events: input.events,
  });
  const withoutRevision = {
    format: "ai-ttrpg-adventure-markdown-v1" as const,
    adventureId: input.adventureId,
    adventureName: input.adventureName,
    timelineId: input.timelineId,
    actorScope: input.actorScope,
    entities: projection.entries.filter(
      (entry): entry is WorldKnowledgeFactEntry =>
        entry.kind === "Established Fact",
    ),
    relationships: projection.entries.filter(
      (entry): entry is WorldKnowledgeRelationshipEntry =>
        entry.kind === "Relationship",
    ),
    events: filterCanonicalEventsVisibleTo({
      actorScope: input.actorScope,
      events: input.events,
    }),
  };
  const document: AdventureMarkdownDocument = {
    ...withoutRevision,
    revision: revisionFor(withoutRevision),
  };
  return immutableSnapshot({
    document,
    markdown: markdownFor(document),
  });
};

export const parseAdventureMarkdown = (
  markdown: string,
): AdventureMarkdownDocument => {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown);
  if (match === null) {
    throw new AdventureMarkdownError(
      "Adventure Markdown requires structured frontmatter.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch {
    throw new AdventureMarkdownError(
      "Adventure Markdown frontmatter is malformed.",
    );
  }
  if (!isAdventureMarkdownDocument(parsed)) {
    throw new AdventureMarkdownError(
      "Adventure Markdown frontmatter has an unsupported structure.",
    );
  }
  return immutableSnapshot(parsed);
};

const conflict = (
  code: AdventureMarkdownConflictCode,
  message: string,
): AdventureMarkdownReview =>
  immutableSnapshot({ status: "conflict" as const, code, message });

const changedEntities = (
  base: AdventureMarkdownDocument,
  edited: AdventureMarkdownDocument,
):
  | readonly {
      readonly before: WorldKnowledgeFactEntry;
      readonly after: WorldKnowledgeFactEntry;
    }[]
  | null => {
  if (base.entities.length !== edited.entities.length) return null;
  const baseIds = new Set(base.entities.map(({ id }) => id));
  const editedIds = new Set(edited.entities.map(({ id }) => id));
  if (
    baseIds.size !== base.entities.length ||
    editedIds.size !== edited.entities.length ||
    [...baseIds].some((id) => !editedIds.has(id))
  ) {
    return null;
  }
  const editedById = new Map(edited.entities.map((entry) => [entry.id, entry]));
  return base.entities.flatMap((before) => {
    const after = editedById.get(before.id);
    return after !== undefined && JSON.stringify(after) !== JSON.stringify(before)
      ? [{ before, after }]
      : [];
  });
};

const isRevealOnlyEdit = (
  before: WorldKnowledgeFactEntry,
  after: WorldKnowledgeFactEntry,
): boolean => {
  const withoutRevealFields = (entry: WorldKnowledgeFactEntry) => ({
    ...entry,
    visibility: undefined,
    knowledgeScope: undefined,
  });
  return (
    before.visibility === "Game Master-only" &&
    after.visibility === "Player-visible" &&
    isPlayerCharacterRevealScope(after.knowledgeScope) &&
    JSON.stringify(withoutRevealFields(before)) ===
      JSON.stringify(withoutRevealFields(after))
  );
};

export const reviewAdventureMarkdownEdit = (
  input: AdventureMarkdownReviewInput,
): AdventureMarkdownReview => {
  let edited: AdventureMarkdownDocument;
  try {
    edited = parseAdventureMarkdown(input.editedMarkdown);
  } catch {
    return conflict(
      "malformed",
      "The edited Adventure Markdown is malformed.",
    );
  }
  if (
    JSON.stringify(edited) === JSON.stringify(input.base) &&
    input.editedMarkdown === markdownFor(input.base)
  ) {
    return immutableSnapshot({ status: "unchanged" as const });
  }
  if (input.reviewerScope.kind !== "Game Master") {
    return conflict(
      "unauthorized",
      "Only the Game Master may review an external World Knowledge edit.",
    );
  }
  if (edited.revision !== input.base.revision) {
    return conflict("stale", "The edited Adventure Markdown is stale.");
  }
  const current = renderAdventureMarkdown(input.current).document;
  if (current.revision !== input.base.revision) {
    return conflict(
      "simultaneous",
      "Canonical Adventure state changed while the Markdown was edited.",
    );
  }
  const changes = changedEntities(input.base, edited);
  const unchangedDocumentFields =
    input.base.adventureId === edited.adventureId &&
    input.base.adventureName === edited.adventureName &&
    input.base.timelineId === edited.timelineId &&
    JSON.stringify(input.base.actorScope) === JSON.stringify(edited.actorScope) &&
    JSON.stringify(input.base.relationships) ===
      JSON.stringify(edited.relationships) &&
    JSON.stringify(input.base.events) === JSON.stringify(edited.events);
  if (
    changes === null ||
    changes.length !== 1 ||
    !unchangedDocumentFields ||
    !isRevealOnlyEdit(changes[0]!.before, changes[0]!.after)
  ) {
    return conflict(
      "contradictory",
      "The edit contradicts canonical Adventure state or changes unsupported fields.",
    );
  }
  return immutableSnapshot({
    status: "command" as const,
    command: {
      type: "review-world-knowledge-reveal" as const,
      reviewerScope: { kind: "Game Master" as const },
      worldKnowledgeId: changes[0]!.before.id,
      knowledgeScope: changes[0]!.after.knowledgeScope,
      sourceRevision: input.base.revision,
      expectedEventCount: input.current.events.length,
      expectedHistoryRevision: canonicalHistoryRevision(input.current.events),
    },
  });
};
