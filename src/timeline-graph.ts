import type { CanonicalEvent } from "./structured-play.js";

export interface TimelineGraphEntry {
  readonly id: string;
  readonly parentTimelineId: string | null;
  readonly branchEventPosition: number | null;
  readonly events: readonly CanonicalEvent[];
}

export const rootTimelineId = "timeline-main";

export const isTimelineId = (value: string): boolean =>
  /^timeline-[a-zA-Z0-9-]+$/.test(value);

export const validateTimelineGraph = ({
  activeTimelineId,
  timelines,
}: {
  readonly activeTimelineId: string;
  readonly timelines: readonly TimelineGraphEntry[];
}): void => {
  const byId = new Map(timelines.map((timeline) => [timeline.id, timeline]));
  const root = byId.get(rootTimelineId);
  if (
    timelines.length === 0 ||
    byId.size !== timelines.length ||
    root === undefined ||
    root.parentTimelineId !== null ||
    root.branchEventPosition !== null ||
    !byId.has(activeTimelineId)
  ) {
    throw new Error("Invalid Timeline graph.");
  }

  for (const timeline of timelines) {
    if (timeline.id === root.id) continue;
    const parent =
      timeline.parentTimelineId === null
        ? undefined
        : byId.get(timeline.parentTimelineId);
    const position = timeline.branchEventPosition;
    if (
      parent === undefined ||
      position === null ||
      position > parent.events.length ||
      JSON.stringify(timeline.events.slice(0, position)) !==
        JSON.stringify(parent.events.slice(0, position))
    ) {
      throw new Error("Invalid Timeline graph.");
    }

    const ancestors = new Set([timeline.id]);
    let ancestor: TimelineGraphEntry | undefined = parent;
    while (ancestor !== undefined && ancestor.parentTimelineId !== null) {
      if (ancestors.has(ancestor.id)) {
        throw new Error("Invalid Timeline graph.");
      }
      ancestors.add(ancestor.id);
      ancestor = byId.get(ancestor.parentTimelineId);
    }
    if (ancestor !== root) {
      throw new Error("Invalid Timeline graph.");
    }
  }
};
