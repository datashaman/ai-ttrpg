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

export type TimelineGraphErrorCode =
  | "ACTIVE_TIMELINE_MISSING"
  | "DUPLICATE_TIMELINE"
  | "INVALID_ROOT_TIMELINE"
  | "TIMELINE_PARENT_MISSING"
  | "TIMELINE_CYCLE"
  | "INVALID_BRANCH_POSITION"
  | "TIMELINE_HISTORY_MISMATCH"
  | "TIMELINE_DISCONNECTED";

export class TimelineGraphError extends Error {
  readonly code: TimelineGraphErrorCode;
  readonly reason: string;
  readonly timelineId: string | undefined;
  readonly eventPosition: number | undefined;

  constructor(
    code: TimelineGraphErrorCode,
    reason: string,
    context: {
      readonly timelineId?: string | undefined;
      readonly eventPosition?: number | undefined;
    } = {},
  ) {
    super(`Invalid Timeline graph: ${reason}.`);
    this.name = "TimelineGraphError";
    this.code = code;
    this.reason = reason;
    this.timelineId = context.timelineId;
    this.eventPosition = context.eventPosition;
  }
}

const invalidTimelineGraph = (
  code: TimelineGraphErrorCode,
  reason: string,
  context: {
    readonly timelineId?: string | undefined;
    readonly eventPosition?: number | undefined;
  } = {},
): never => {
  throw new TimelineGraphError(code, reason, context);
};

export const validateTimelineGraph = ({
  activeTimelineId,
  timelines,
}: {
  readonly activeTimelineId: string;
  readonly timelines: readonly TimelineGraphEntry[];
}): void => {
  const byId = new Map(timelines.map((timeline) => [timeline.id, timeline]));
  if (!byId.has(activeTimelineId)) {
    return invalidTimelineGraph(
      "ACTIVE_TIMELINE_MISSING",
      `active Timeline "${activeTimelineId}" is missing`,
      { timelineId: activeTimelineId },
    );
  }
  if (byId.size !== timelines.length) {
    return invalidTimelineGraph(
      "DUPLICATE_TIMELINE",
      "Timeline identities are duplicated",
    );
  }
  const root = byId.get(rootTimelineId);
  if (
    timelines.length === 0 ||
    root === undefined ||
    root.parentTimelineId !== null ||
    root.branchEventPosition !== null
  ) {
    return invalidTimelineGraph(
      "INVALID_ROOT_TIMELINE",
      "the root Timeline is missing or invalid",
      {
        timelineId: root?.id,
        eventPosition: root?.branchEventPosition ?? undefined,
      },
    );
  }

  for (const timeline of timelines) {
    if (timeline.id === root.id) continue;
    const context = { timelineId: timeline.id };
    const ancestors = new Set<string>();
    let ancestor: TimelineGraphEntry = timeline;
    while (ancestor.parentTimelineId !== null) {
      if (ancestors.has(ancestor.id)) {
        return invalidTimelineGraph(
          "TIMELINE_CYCLE",
          "Timeline ancestry contains a cycle",
          context,
        );
      }
      ancestors.add(ancestor.id);
      const parent = byId.get(ancestor.parentTimelineId);
      if (parent === undefined) {
        return invalidTimelineGraph(
          "TIMELINE_PARENT_MISSING",
          `parent Timeline "${ancestor.parentTimelineId}" is missing`,
          context,
        );
      }
      ancestor = parent;
    }
    if (ancestor !== root) {
      return invalidTimelineGraph(
        "TIMELINE_DISCONNECTED",
        "Timeline ancestry does not reach the root Timeline",
        context,
      );
    }

    const parent = byId.get(timeline.parentTimelineId!);
    const position = timeline.branchEventPosition;
    if (
      parent === undefined ||
      position === null ||
      position < 1 ||
      position > parent.events.length
    ) {
      return invalidTimelineGraph(
        "INVALID_BRANCH_POSITION",
        "the Timeline branch position is invalid",
        { ...context, eventPosition: position ?? undefined },
      );
    }
    if (
      JSON.stringify(timeline.events.slice(0, position)) !==
      JSON.stringify(parent.events.slice(0, position))
    ) {
      return invalidTimelineGraph(
        "TIMELINE_HISTORY_MISMATCH",
        "the Timeline does not inherit its parent's history at the branch position",
        { ...context, eventPosition: position },
      );
    }
  }
};
