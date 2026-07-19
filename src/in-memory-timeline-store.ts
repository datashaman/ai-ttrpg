import { randomUUID } from "node:crypto";

import {
  committedRandomPosition,
  createSeededRandomSource,
  createSeededRandomSourceAtPosition,
  type RandomSource,
} from "./random-source.js";
import type {
  CanonicalEvent,
  TimelineCollectionView,
  TimelineStore,
  TimelineSummary,
} from "./structured-play.js";

interface StoredTimeline {
  readonly id: string;
  readonly parentTimelineId: string | null;
  readonly branchEventPosition: number | null;
  readonly events: CanonicalEvent[];
  readonly randomSource: RandomSource;
}

export const createInMemoryTimelineStore = ({
  seed,
  rootTimelineId = "timeline-main",
}: {
  readonly seed: number;
  readonly rootTimelineId?: string;
}): TimelineStore => {
  const timelines = new Map<string, StoredTimeline>();
  timelines.set(rootTimelineId, {
    id: rootTimelineId,
    parentTimelineId: null,
    branchEventPosition: null,
    events: [],
    randomSource: createSeededRandomSource(seed),
  });
  let activeTimelineId = rootTimelineId;

  const active = (): StoredTimeline => timelines.get(activeTimelineId)!;
  const summary = (timeline: StoredTimeline): TimelineSummary => ({
    id: timeline.id,
    parentTimelineId: timeline.parentTimelineId,
    branchEventPosition: timeline.branchEventPosition,
    eventCount: timeline.events.length,
    randomPosition: timeline.randomSource.position(),
  });

  return {
    readAll: () => [...active().events],
    append: (event) => active().events.push(event),
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
      return [...timeline.events];
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
        events: [...events],
        randomSource: createSeededRandomSourceAtPosition(
          seed,
          committedRandomPosition(events),
        ),
      };
      timelines.set(timeline.id, timeline);
      activeTimelineId = timeline.id;
      return summary(timeline);
    },
    selectTimeline: (timelineId) => {
      if (!timelines.has(timelineId)) return false;
      activeTimelineId = timelineId;
      return true;
    },
  };
};
