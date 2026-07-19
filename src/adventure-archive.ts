import { createHash } from "node:crypto";

import { committedRandomPosition } from "./random-source.js";
import type { CanonicalEvent } from "./structured-play.js";
import type { TimelineSnapshot } from "./timeline-store.js";
import {
  isTimelineId,
  validateTimelineGraph,
} from "./timeline-graph.js";
import { canonicalEventRandomSeed } from "./canonical-event-validation.js";

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

const invalidArchive = (reason: string): never => {
  throw new Error(`Invalid Adventure archive: ${reason}.`);
};

export const parseAdventureArchive = (
  serialized: string,
  validateEvents: (events: readonly unknown[]) => readonly CanonicalEvent[],
): PortableAdventureRecord => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return invalidArchive("the document is not valid JSON");
  }
  if (!isObject(value) || value.formatVersion !== 1) {
    return invalidArchive("the format version is unsupported");
  }
  const integrity = value.integrity;
  const rawAdventure = value.adventure;
  if (
    !isObject(integrity) ||
    integrity.algorithm !== "sha256" ||
    typeof integrity.digest !== "string" ||
    !isObject(rawAdventure) ||
    digest(rawAdventure) !== integrity.digest
  ) {
    return invalidArchive("the integrity check failed");
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
    return invalidArchive("the Adventure metadata is invalid");
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
          (!Number.isInteger(candidate.branchEventPosition) ||
            (candidate.branchEventPosition as number) < 1)) ||
        !Number.isInteger(candidate.randomPosition) ||
        (candidate.randomPosition as number) < 0 ||
        !Array.isArray(candidate.events)
      ) {
        return invalidArchive("a Timeline is invalid");
      }
      let events: readonly CanonicalEvent[];
      try {
        events = validateEvents(candidate.events);
      } catch {
        return invalidArchive("a Timeline contains invalid canonical events");
      }
      if (committedRandomPosition(events) !== candidate.randomPosition) {
        return invalidArchive("a Timeline random-stream position is invalid");
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

  if (
    timelines.some((timeline) =>
      timeline.events.some((event) => {
        const seed = canonicalEventRandomSeed(event);
        return seed !== undefined && seed !== rawAdventure.randomSeed;
      }),
    )
  ) {
    return invalidArchive("a canonical random trace has the wrong seed");
  }

  try {
    validateTimelineGraph({
      activeTimelineId: rawAdventure.activeTimelineId,
      timelines,
    });
  } catch {
    return invalidArchive("the Timeline graph is invalid");
  }

  return {
    id: rawAdventure.id,
    name: rawAdventure.name,
    randomSeed: rawAdventure.randomSeed as number,
    activeTimelineId: rawAdventure.activeTimelineId,
    timelines,
  };
};
