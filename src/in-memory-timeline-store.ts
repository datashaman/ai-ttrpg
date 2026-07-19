import type { TimelineStore } from "./structured-play.js";
import {
  createTimelineStore,
  type TimelineSnapshot,
} from "./timeline-store.js";
import { rootTimelineId } from "./timeline-graph.js";

export const createInMemoryTimelineStore = ({
  seed,
  rootTimelineId: configuredRootTimelineId = rootTimelineId,
  activeTimelineId = configuredRootTimelineId,
  snapshots = [
    {
      id: configuredRootTimelineId,
      parentTimelineId: null,
      branchEventPosition: null,
      events: [],
    },
  ],
}: {
  readonly seed: number;
  readonly rootTimelineId?: string;
  readonly activeTimelineId?: string;
  readonly snapshots?: readonly TimelineSnapshot[];
}): TimelineStore => {
  return createTimelineStore({
    seed,
    activeTimelineId,
    snapshots,
  });
};
