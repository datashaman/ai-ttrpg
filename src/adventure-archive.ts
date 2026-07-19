import { createHash } from "node:crypto";

import { committedRandomPosition } from "./random-source.js";
import type { CanonicalEvent } from "./structured-play.js";
import type { TimelineSnapshot } from "./timeline-store.js";
import {
  isTimelineId,
  TimelineGraphError,
  type TimelineGraphErrorCode,
  validateTimelineGraph,
} from "./timeline-graph.js";
import {
  canonicalEventRandomSeed,
  isCanonicalEventEnvelope,
} from "./canonical-event-validation.js";

export interface PortableTimeline extends TimelineSnapshot {
  readonly randomPosition: number;
}

export interface PortableAdventureRecord {
  readonly id: string;
  readonly name: string;
  readonly randomSeed: number;
  readonly activeTimelineId: string;
  readonly timelines: readonly PortableTimeline[];
}

interface AdventureArchiveDocument {
  readonly formatVersion: 1;
  readonly integrity: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly adventure: PortableAdventureRecord;
}

export type AdventureArchiveErrorCode =
  | "ARCHIVE_INVALID_DOCUMENT"
  | "ARCHIVE_UNSUPPORTED_VERSION"
  | "ARCHIVE_INTEGRITY_MISMATCH"
  | "ARCHIVE_INVALID_METADATA"
  | "ARCHIVE_INVALID_TIMELINE"
  | "ARCHIVE_UNSUPPORTED_EVENT_SCHEMA"
  | "ARCHIVE_MALFORMED_EVENT"
  | "ARCHIVE_DUPLICATE_EVENT"
  | "ARCHIVE_EVENT_SEQUENCE_GAP"
  | "ARCHIVE_EVENTS_OUT_OF_ORDER"
  | "ARCHIVE_INVALID_EVENT_HISTORY"
  | "ARCHIVE_RANDOM_POSITION_MISMATCH"
  | "ARCHIVE_RANDOM_SEED_MISMATCH"
  | "ARCHIVE_ACTIVE_TIMELINE_MISSING"
  | "ARCHIVE_TIMELINE_PARENT_MISSING"
  | "ARCHIVE_TIMELINE_CYCLE"
  | "ARCHIVE_INVALID_BRANCH_POSITION"
  | "ARCHIVE_TIMELINE_HISTORY_MISMATCH"
  | "ARCHIVE_INVALID_TIMELINE_GRAPH";

export interface AdventureArchiveErrorContext {
  readonly adventureId?: string | undefined;
  readonly timelineId?: string | undefined;
  readonly eventPosition?: number | undefined;
}

export class AdventureArchiveError extends Error {
  readonly code: AdventureArchiveErrorCode;
  readonly adventureId: string | undefined;
  readonly timelineId: string | undefined;
  readonly eventPosition: number | undefined;

  constructor(
    code: AdventureArchiveErrorCode,
    reason: string,
    context: AdventureArchiveErrorContext = {},
  ) {
    const location = [
      context.adventureId === undefined
        ? undefined
        : `Adventure "${context.adventureId}"`,
      context.timelineId === undefined
        ? undefined
        : `Timeline "${context.timelineId}"`,
      context.eventPosition === undefined
        ? undefined
        : `event ${context.eventPosition}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(", ");
    super(
      `Adventure archive${location === "" ? "" : ` (${location})`}: ${reason}. [${code}]`,
    );
    this.name = "AdventureArchiveError";
    this.code = code;
    this.adventureId = context.adventureId;
    this.timelineId = context.timelineId;
    this.eventPosition = context.eventPosition;
  }
}

const digest = (adventure: unknown): string =>
  createHash("sha256").update(JSON.stringify(adventure)).digest("hex");

export const serializeAdventureArchive = (
  adventure: PortableAdventureRecord,
): string => {
  const document: AdventureArchiveDocument = {
    formatVersion: 1,
    integrity: { algorithm: "sha256", digest: digest(adventure) },
    adventure,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const invalidArchive = (
  code: AdventureArchiveErrorCode,
  reason: string,
  context: AdventureArchiveErrorContext = {},
): never => {
  throw new AdventureArchiveError(code, reason, context);
};

const validateEventEnvelopes = (
  events: readonly unknown[],
  context: AdventureArchiveErrorContext,
): void => {
  const eventObjects = events.map((event, index) => {
    const eventContext = { ...context, eventPosition: index + 1 };
    if (!isObject(event)) {
      return invalidArchive(
        "ARCHIVE_MALFORMED_EVENT",
        "the canonical event envelope is malformed",
        eventContext,
      );
    }
    if (
      Number.isInteger(event.schemaVersion) &&
      event.schemaVersion !== 1
    ) {
      return invalidArchive(
        "ARCHIVE_UNSUPPORTED_EVENT_SCHEMA",
        `canonical event schema version ${String(event.schemaVersion)} is unsupported`,
        eventContext,
      );
    }
    if (
      typeof event.id !== "string" ||
      !Number.isInteger(event.sequence) ||
      (event.sequence as number) < 1
    ) {
      return invalidArchive(
        "ARCHIVE_MALFORMED_EVENT",
        "the canonical event envelope is malformed",
        eventContext,
      );
    }
    return event;
  });

  const ids = new Set<string>();
  const sequences = new Set<number>();
  eventObjects.forEach((event, index) => {
    const sequence = event.sequence as number;
    if (ids.has(event.id as string) || sequences.has(sequence)) {
      return invalidArchive(
        "ARCHIVE_DUPLICATE_EVENT",
        "the Timeline contains a duplicate canonical event",
        { ...context, eventPosition: index + 1 },
      );
    }
    ids.add(event.id as string);
    sequences.add(sequence);
  });

  const sequenceValues = eventObjects.map((event) => event.sequence as number);
  const mismatch = sequenceValues.findIndex(
    (sequence, index) => sequence !== index + 1,
  );
  if (mismatch !== -1) {
    const sorted = [...sequenceValues].sort((left, right) => left - right);
    const reordered = sorted.every((sequence, index) => sequence === index + 1);
    return invalidArchive(
      reordered
        ? "ARCHIVE_EVENTS_OUT_OF_ORDER"
        : "ARCHIVE_EVENT_SEQUENCE_GAP",
      reordered
        ? "the canonical events are out of order"
        : "the canonical event sequence contains a gap",
      { ...context, eventPosition: mismatch + 1 },
    );
  }

  eventObjects.forEach((event, index) => {
    if (!isCanonicalEventEnvelope(event, index + 1)) {
      return invalidArchive(
        "ARCHIVE_MALFORMED_EVENT",
        "the canonical event envelope or payload is malformed",
        { ...context, eventPosition: index + 1 },
      );
    }
  });
};

const timelineGraphArchiveCodes = {
  ACTIVE_TIMELINE_MISSING: "ARCHIVE_ACTIVE_TIMELINE_MISSING",
  DUPLICATE_TIMELINE: "ARCHIVE_INVALID_TIMELINE_GRAPH",
  INVALID_ROOT_TIMELINE: "ARCHIVE_INVALID_TIMELINE_GRAPH",
  TIMELINE_PARENT_MISSING: "ARCHIVE_TIMELINE_PARENT_MISSING",
  TIMELINE_CYCLE: "ARCHIVE_TIMELINE_CYCLE",
  INVALID_BRANCH_POSITION: "ARCHIVE_INVALID_BRANCH_POSITION",
  TIMELINE_HISTORY_MISMATCH: "ARCHIVE_TIMELINE_HISTORY_MISMATCH",
  TIMELINE_DISCONNECTED: "ARCHIVE_INVALID_TIMELINE_GRAPH",
} satisfies Record<TimelineGraphErrorCode, AdventureArchiveErrorCode>;

const validatePortableTimelineGraph = (
  activeTimelineId: string,
  timelines: readonly PortableTimeline[],
  adventureId: string | undefined,
): void => {
  try {
    validateTimelineGraph({ activeTimelineId, timelines });
  } catch (error) {
    if (!(error instanceof TimelineGraphError)) throw error;
    return invalidArchive(
      timelineGraphArchiveCodes[error.code],
      error.reason,
      {
        adventureId,
        timelineId: error.timelineId,
        eventPosition: error.eventPosition,
      },
    );
  }
};

const invalidHistoryPosition = (
  events: readonly unknown[],
  validateEvents: (
    events: readonly unknown[],
  ) => readonly CanonicalEvent[],
): number | undefined => {
  for (let index = 0; index < events.length; index += 1) {
    try {
      validateEvents(events.slice(0, index + 1));
    } catch {
      return index + 1;
    }
  }
  return undefined;
};

export const parseAdventureArchive = (
  serialized: string,
  validateEvents: (events: readonly unknown[]) => readonly CanonicalEvent[],
): PortableAdventureRecord => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return invalidArchive(
      "ARCHIVE_INVALID_DOCUMENT",
      "the document is incomplete or is not valid JSON",
    );
  }
  const rawAdventure = isObject(value) ? value.adventure : undefined;
  const adventureId =
    isObject(rawAdventure) && typeof rawAdventure.id === "string"
      ? rawAdventure.id
      : undefined;
  if (!isObject(value) || value.formatVersion !== 1) {
    return invalidArchive(
      "ARCHIVE_UNSUPPORTED_VERSION",
      "the format version is unsupported",
      { adventureId },
    );
  }
  const integrity = value.integrity;
  if (
    !isObject(integrity) ||
    integrity.algorithm !== "sha256" ||
    typeof integrity.digest !== "string" ||
    !isObject(rawAdventure) ||
    digest(rawAdventure) !== integrity.digest
  ) {
    return invalidArchive(
      "ARCHIVE_INTEGRITY_MISMATCH",
      "the integrity check failed",
      { adventureId },
    );
  }
  if (
    typeof rawAdventure.id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(rawAdventure.id) ||
    typeof rawAdventure.name !== "string" ||
    rawAdventure.name.trim() === "" ||
    !Number.isInteger(rawAdventure.randomSeed) ||
    (rawAdventure.randomSeed as number) < 0 ||
    (rawAdventure.randomSeed as number) > 0xffff_ffff ||
    typeof rawAdventure.activeTimelineId !== "string" ||
    !Array.isArray(rawAdventure.timelines)
  ) {
    return invalidArchive(
      "ARCHIVE_INVALID_METADATA",
      "the Adventure metadata is invalid",
      { adventureId },
    );
  }

  const timelines: PortableTimeline[] = rawAdventure.timelines.map(
    (candidate): PortableTimeline => {
      if (
        !isObject(candidate) ||
        typeof candidate.id !== "string" ||
        !isTimelineId(candidate.id) ||
        (candidate.parentTimelineId !== null &&
          (typeof candidate.parentTimelineId !== "string" ||
            !isTimelineId(candidate.parentTimelineId))) ||
        (candidate.branchEventPosition !== null &&
          !Number.isInteger(candidate.branchEventPosition)) ||
        !Number.isInteger(candidate.randomPosition) ||
        (candidate.randomPosition as number) < 0 ||
        !Array.isArray(candidate.events)
      ) {
        return invalidArchive(
          "ARCHIVE_INVALID_TIMELINE",
          "a Timeline is invalid",
          {
            adventureId,
            timelineId:
              isObject(candidate) && typeof candidate.id === "string"
                ? candidate.id
                : undefined,
          },
        );
      }
      let events: readonly CanonicalEvent[];
      const timelineContext = { adventureId, timelineId: candidate.id };
      validateEventEnvelopes(candidate.events, timelineContext);
      try {
        events = validateEvents(candidate.events);
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message.replace(/[.]$/, "")
            : "the canonical event history cannot be replayed";
        return invalidArchive(
          "ARCHIVE_INVALID_EVENT_HISTORY",
          reason,
          {
            ...timelineContext,
            eventPosition: invalidHistoryPosition(
              candidate.events,
              validateEvents,
            ),
          },
        );
      }
      if (committedRandomPosition(events) !== candidate.randomPosition) {
        return invalidArchive(
          "ARCHIVE_RANDOM_POSITION_MISMATCH",
          "a Timeline random-stream position is invalid",
          { adventureId, timelineId: candidate.id },
        );
      }
      return {
        id: candidate.id,
        parentTimelineId: candidate.parentTimelineId,
        branchEventPosition: candidate.branchEventPosition as number | null,
        randomPosition: candidate.randomPosition,
        events,
      };
    },
  );

  for (const timeline of timelines) {
    const eventIndex = timeline.events.findIndex((event) => {
      const seed = canonicalEventRandomSeed(event);
      return seed !== undefined && seed !== rawAdventure.randomSeed;
    });
    if (eventIndex !== -1) {
      return invalidArchive(
        "ARCHIVE_RANDOM_SEED_MISMATCH",
        "a canonical random trace has the wrong seed",
        {
          adventureId,
          timelineId: timeline.id,
          eventPosition: eventIndex + 1,
        },
      );
    }
  }

  validatePortableTimelineGraph(
    rawAdventure.activeTimelineId,
    timelines,
    adventureId,
  );

  return {
    id: rawAdventure.id,
    name: rawAdventure.name,
    randomSeed: rawAdventure.randomSeed as number,
    activeTimelineId: rawAdventure.activeTimelineId,
    timelines,
  };
};
