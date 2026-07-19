import { randomUUID } from "node:crypto";

import {
  committedRandomPosition,
  createSeededRandomSourceAtPosition,
  type RandomSource,
} from "./random-source.js";
import type {
  CanonicalEvent,
  TimelineCollectionView,
  TimelineStore,
  TimelineSummary,
} from "./structured-play.js";

export interface TimelineSnapshot {
  readonly id: string;
  readonly parentTimelineId: string | null;
  readonly branchEventPosition: number | null;
  readonly events: readonly CanonicalEvent[];
}

export interface TimelinePersistence {
  append(timelineId: string, event: CanonicalEvent): void;
  branch(
    timeline: TimelineSnapshot,
    activeTimelineId: string,
    timelines: readonly TimelineSnapshot[],
  ): void;
  select(
    activeTimelineId: string,
    timelines: readonly TimelineSnapshot[],
  ): void;
}

interface StoredTimeline extends TimelineSnapshot {
  readonly events: CanonicalEvent[];
  readonly randomSource: RandomSource;
}

export const createTimelineStore = ({
  seed,
  activeTimelineId: initialActiveTimelineId,
  snapshots,
  persistence,
}: {
  readonly seed: number;
  readonly activeTimelineId: string;
  readonly snapshots: readonly TimelineSnapshot[];
  readonly persistence?: TimelinePersistence;
}): TimelineStore => {
  const timelines = new Map<string, StoredTimeline>(
    snapshots.map((snapshot) => {
      const events: CanonicalEvent[] = structuredClone([...snapshot.events]);
      return [
        snapshot.id,
        {
          ...snapshot,
          events,
          randomSource: createSeededRandomSourceAtPosition(
            seed,
            committedRandomPosition(events),
          ),
        },
      ];
    }),
  );
  let activeTimelineId = initialActiveTimelineId;

  const active = (): StoredTimeline => timelines.get(activeTimelineId)!;
  const snapshot = (timeline: StoredTimeline): TimelineSnapshot => ({
    id: timeline.id,
    parentTimelineId: timeline.parentTimelineId,
    branchEventPosition: timeline.branchEventPosition,
    events: timeline.events,
  });
  const allSnapshots = (): readonly TimelineSnapshot[] =>
    [...timelines.values()].map(snapshot);
  const summary = (timeline: StoredTimeline): TimelineSummary => ({
    id: timeline.id,
    parentTimelineId: timeline.parentTimelineId,
    branchEventPosition: timeline.branchEventPosition,
    eventCount: timeline.events.length,
    randomPosition: timeline.randomSource.position(),
  });

  return {
    readAll: () => structuredClone(active().events),
    append: (event) => {
      persistence?.append(activeTimelineId, event);
      active().events.push(structuredClone(event));
    },
    rollDie: (sides) => active().randomSource.rollDie(sides),
    metadata: () => active().randomSource.metadata(),
    position: () => active().randomSource.position(),
    view: (): TimelineCollectionView => ({
      activeTimelineId,
      activeTimeline: summary(active()),
      timelines: [...timelines.values()].map(summary),
      acceptedEvents: active().events.map((event, index) => ({
        position: index + 1,
        type: event.type,
      })),
    }),
    readTimeline: (timelineId) => {
      const timeline = timelines.get(timelineId);
      if (timeline === undefined) throw new Error(`Unknown Timeline: ${timelineId}.`);
      return structuredClone(timeline.events);
    },
    branchTimeline: (eventPosition) => {
      const parent = active();
      if (
        !Number.isInteger(eventPosition) ||
        eventPosition < 1 ||
        eventPosition > parent.events.length
      ) {
        throw new RangeError("A Timeline branch requires an accepted event position.");
      }
      const events = parent.events.slice(0, eventPosition);
      const timeline: StoredTimeline = {
        id: `timeline-${randomUUID()}`,
        parentTimelineId: parent.id,
        branchEventPosition: eventPosition,
        events: structuredClone(events),
        randomSource: createSeededRandomSourceAtPosition(
          seed,
          committedRandomPosition(events),
        ),
      };
      persistence?.branch(
        snapshot(timeline),
        timeline.id,
        [...allSnapshots(), snapshot(timeline)],
      );
      timelines.set(timeline.id, timeline);
      activeTimelineId = timeline.id;
      return summary(timeline);
    },
    selectTimeline: (timelineId) => {
      if (!timelines.has(timelineId)) return false;
      persistence?.select(timelineId, allSnapshots());
      activeTimelineId = timelineId;
      return true;
    },
  };
};
