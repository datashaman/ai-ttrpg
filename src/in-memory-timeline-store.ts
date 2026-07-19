import type { TimelineStore } from "./structured-play.js";
import { createTimelineStore } from "./timeline-store.js";

export const createInMemoryTimelineStore = ({
  seed,
  rootTimelineId = "timeline-main",
}: {
  readonly seed: number;
  readonly rootTimelineId?: string;
}): TimelineStore => {
  return createTimelineStore({
    seed,
    activeTimelineId: rootTimelineId,
    snapshots: [
      {
        id: rootTimelineId,
        parentTimelineId: null,
        branchEventPosition: null,
        events: [],
      },
    ],
  });
};
