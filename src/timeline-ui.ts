import {
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type CanonicalEvent,
  type GameState,
  type TimelineStore,
} from "./structured-play.js";
import {
  filterCanonicalEventsVisibleTo,
  projectWorldKnowledge,
  type WorldKnowledgeActorScope,
  type WorldKnowledgeVisibility,
} from "./world-knowledge.js";

export interface TimelineUiEvent {
  readonly id: string;
  readonly position: number;
  readonly type: CanonicalEvent["type"];
  readonly summary: string;
  readonly commandId: string;
  readonly commandType: string;
  readonly ruleReferences: readonly string[];
  readonly randomInputs: readonly number[];
  readonly visibility: WorldKnowledgeVisibility;
}

export interface TimelineUiProjection {
  readonly scene: string | null;
  readonly health: number | null;
  readonly resolve: number | null;
  readonly conditions: readonly string[];
  readonly clocks: readonly {
    readonly name: "Resistance" | "Danger";
    readonly current: number;
    readonly capacity: number;
  }[];
}

export interface TimelineUiEntry {
  readonly id: string;
  readonly parentTimelineId: string | null;
  readonly branchEventPosition: number | null;
  readonly eventCount: number;
  readonly randomPosition: number;
  readonly events: readonly TimelineUiEvent[];
  readonly projection: TimelineUiProjection;
  readonly worldKnowledge: readonly {
    readonly id: string;
    readonly kind: "Established Fact" | "Relationship";
    readonly content: string;
    readonly visibility: WorldKnowledgeVisibility;
    readonly sourceReference: string;
  }[];
}

export interface TimelineDifference<Value> {
  readonly value: Value;
  readonly attribution: string;
}

export interface TimelineComparison {
  readonly baselineTimelineId: string;
  readonly comparedTimelineId: string;
  readonly commands: readonly TimelineDifference<string>[];
  readonly events: {
    readonly added: readonly TimelineUiEvent[];
    readonly removed: readonly TimelineUiEvent[];
  };
  readonly worldKnowledge: {
    readonly added: TimelineUiEntry["worldKnowledge"];
    readonly removed: TimelineUiEntry["worldKnowledge"];
  };
  readonly resources: readonly TimelineDifference<string>[];
  readonly rules: readonly TimelineDifference<string>[];
  readonly randomInputs: readonly TimelineDifference<string>[];
  readonly randomPosition: TimelineDifference<string> | null;
  readonly projection: readonly TimelineDifference<string>[];
}

export interface TimelineWorkspaceView {
  readonly actor: "Player" | "Game Master";
  readonly activeTimelineId: string;
  readonly activeTimeline: TimelineUiEntry;
  readonly timelines: readonly TimelineUiEntry[];
  readonly comparison: TimelineComparison | null;
}

export type TimelineWorkspaceResult =
  | { readonly status: "accepted"; readonly message: string; readonly workspace: TimelineWorkspaceView }
  | { readonly status: "rejected"; readonly message: string; readonly workspace: TimelineWorkspaceView };

const eventSummary = (event: CanonicalEvent): string => {
  if (event.type === "WorldKnowledgeEstablished") return event.payload.fact.text;
  if (event.type === "SceneStarted") return `Scene started: ${event.payload.scene}.`;
  if (event.type === "SceneTransitioned") return `Scene changed from ${event.payload.from} to ${event.payload.to}.`;
  if (event.type === "CheckProposalCreated") return event.payload.proposal.goal;
  if (event.type === "CheckResolved") return `${event.payload.outcome}: ${event.payload.committedStake.summary}`;
  if (event.type === "OracleAnswered") return `${event.payload.trace.result.answer}: ${event.payload.establishedFact.text}`;
  return event.type.replaceAll(/([a-z])([A-Z])/g, "$1 $2");
};

const randomInputsFor = (event: CanonicalEvent): readonly number[] => {
  if (event.type === "CheckRollRevealed") return event.payload.pendingChoice.roll.random.inputs;
  if (event.type === "OracleAnswered") return event.payload.trace.random.inputs;
  return [];
};

const ruleReferencesFor = (event: CanonicalEvent): readonly string[] => {
  if (event.type === "CheckRollRevealed") {
    const rule = event.payload.pendingChoice.roll.rule;
    return [`${rule.id}@${rule.version}`];
  }
  if (event.type === "CheckResolved") {
    const rule = event.payload.trace.rule;
    return [`${rule.id}@${rule.version}`];
  }
  if (event.type === "OracleAnswered") {
    const rule = event.payload.trace.rule;
    return [`${rule.id}@${rule.version}`];
  }
  return [];
};

const projectionFor = (state: GameState): TimelineUiProjection => ({
  scene: state.activeScene,
  health: state.playerCharacter?.health ?? null,
  resolve: state.playerCharacter?.resolve ?? null,
  conditions: state.conditions,
  clocks: state.confrontation === null
    ? []
    : [
        { name: "Resistance", current: state.confrontation.resistanceClock.current, capacity: state.confrontation.resistanceClock.capacity },
        { name: "Danger", current: state.confrontation.dangerClock.current, capacity: state.confrontation.dangerClock.capacity },
      ],
});

const difference = (
  baseline: TimelineUiEntry,
  compared: TimelineUiEntry,
): TimelineComparison => {
  const baselineIds = new Set(baseline.events.map(({ id }) => id));
  const comparedIds = new Set(compared.events.map(({ id }) => id));
  const added = compared.events.filter(({ id }) => !baselineIds.has(id));
  const removed = baseline.events.filter(({ id }) => !comparedIds.has(id));
  const divergent = [...removed, ...added];
  const baselineKnowledgeIds = new Set(baseline.worldKnowledge.map(({ id }) => id));
  const comparedKnowledgeIds = new Set(compared.worldKnowledge.map(({ id }) => id));
  const values = (items: readonly string[], attribution: string) =>
    [...new Set(items)].map((value) => ({ value, attribution }));
  const projection: TimelineDifference<string>[] = [];
  for (const key of ["scene", "health", "resolve", "conditions", "clocks"] as const) {
    const before = JSON.stringify(baseline.projection[key]);
    const after = JSON.stringify(compared.projection[key]);
    if (before !== after) projection.push({
      value: `${key}: ${before} → ${after}`,
      attribution: "Projected from the divergent canonical events.",
    });
  }
  const resources = projection.filter(({ value }) =>
    value.startsWith("health:") || value.startsWith("resolve:"),
  );
  return {
    baselineTimelineId: baseline.id,
    comparedTimelineId: compared.id,
    commands: values(
      divergent.map(({ commandId, commandType }) => `${commandType} · ${commandId}`),
      "Canonical causation group shared by the divergent events.",
    ),
    events: { added, removed },
    worldKnowledge: {
      added: compared.worldKnowledge.filter(({ id }) => !baselineKnowledgeIds.has(id)),
      removed: baseline.worldKnowledge.filter(({ id }) => !comparedKnowledgeIds.has(id)),
    },
    resources,
    rules: values(divergent.flatMap(({ ruleReferences }) => ruleReferences), "Approved rule reference in a canonical event."),
    randomInputs: values(divergent.flatMap(({ randomInputs }) => randomInputs.map(String)), "Recorded random input in a canonical event."),
    randomPosition: baseline.randomPosition === compared.randomPosition
      ? null
      : {
          value: `${baseline.randomPosition} → ${compared.randomPosition}`,
          attribution: "Committed position in the inherited random stream.",
        },
    projection,
  };
};

export const createTimelineWorkspace = ({
  timelineStore,
  actorScope,
}: {
  readonly timelineStore: TimelineStore;
  readonly actorScope: WorldKnowledgeActorScope;
}) => {
  const entryFor = (timelineId: string): TimelineUiEntry => {
    const collection = timelineStore.view();
    const summary = collection.timelines.find(({ id }) => id === timelineId);
    if (summary === undefined) throw new Error(`Unknown Timeline: ${timelineId}.`);
    const events = timelineStore.readTimeline(timelineId);
    const playerVisibleIds = new Set(filterCanonicalEventsVisibleTo({
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      events,
    }).map(({ id }) => id));
    const visibleEvents = filterCanonicalEventsVisibleTo({ actorScope, events });
    const snapshots = collection.timelines.map((candidate) => ({
      id: candidate.id,
      parentTimelineId: candidate.parentTimelineId,
      branchEventPosition: candidate.branchEventPosition,
      events: timelineStore.readTimeline(candidate.id),
    }));
    const projectedStore = createInMemoryTimelineStore({
      seed: 0,
      activeTimelineId: timelineId,
      snapshots,
    });
    const projected = createStructuredPlayApplication({
      timelineStore: projectedStore,
      actorScope: actorScope.kind === "Player" ? actorScope : DEFAULT_PLAYER_ACTOR_SCOPE,
    });
    const branchEventPosition = summary.parentTimelineId === null || summary.branchEventPosition === null
      ? null
      : filterCanonicalEventsVisibleTo({
          actorScope,
          events: timelineStore.readTimeline(summary.parentTimelineId).slice(0, summary.branchEventPosition),
        }).length;
    return {
      ...summary,
      branchEventPosition,
      eventCount: visibleEvents.length,
      events: visibleEvents.map((event, index) => ({
        id: event.id,
        position: index + 1,
        type: event.type,
        summary: eventSummary(event),
        commandId: event.causationId,
        commandType: event.commandType ?? "legacy-unattributed",
        ruleReferences: ruleReferencesFor(event),
        randomInputs: randomInputsFor(event),
        visibility: playerVisibleIds.has(event.id) ? "Player-visible" : "Game Master-only",
      })),
      projection: projectionFor(projected.view().state),
      worldKnowledge: projectWorldKnowledge({ actorScope, events }).entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        content: entry.kind === "Established Fact" ? entry.text : entry.content,
        visibility: entry.visibility,
        sourceReference: entry.provenance.sourceReference,
      })),
    };
  };

  const view = (baselineTimelineId?: string): TimelineWorkspaceView => {
    const collection = timelineStore.view();
    const timelines = collection.timelines.map(({ id }) => entryFor(id));
    const activeTimeline = timelines.find(({ id }) => id === collection.activeTimelineId)!;
    const baseline = baselineTimelineId === undefined
      ? null
      : timelines.find(({ id }) => id === baselineTimelineId) ?? null;
    return {
      actor: actorScope.kind === "Game Master" ? "Game Master" : "Player",
      activeTimelineId: collection.activeTimelineId,
      activeTimeline,
      timelines,
      comparison: baseline === null || baseline.id === activeTimeline.id
        ? null
        : difference(baseline, activeTimeline),
    };
  };

  return {
    view,
    branch(eventPosition: number, baselineTimelineId?: string): TimelineWorkspaceResult {
      const before = view(baselineTimelineId);
      try {
        if (!Number.isInteger(eventPosition) || eventPosition < 1) {
          throw new RangeError("Invalid actor-visible position.");
        }
        const sourceTimelineId = timelineStore.view().activeTimelineId;
        const sourceEvents = timelineStore.readTimeline(sourceTimelineId);
        const visibleEvent = filterCanonicalEventsVisibleTo({ actorScope, events: sourceEvents })
          .at(eventPosition - 1);
        if (visibleEvent === undefined) throw new RangeError("Invalid actor-visible position.");
        const canonicalPosition = sourceEvents.findIndex(({ id }) => id === visibleEvent.id) + 1;
        timelineStore.branchTimeline(canonicalPosition);
        return {
          status: "accepted",
          message: `Created a new Timeline from ${sourceTimelineId} at event ${eventPosition}.`,
          workspace: view(sourceTimelineId),
        };
      } catch {
        return { status: "rejected", message: "Choose an accepted event position on the active Timeline.", workspace: before };
      }
    },
    select(timelineId: string, baselineTimelineId?: string): TimelineWorkspaceResult {
      if (!timelineStore.selectTimeline(timelineId)) {
        return { status: "rejected", message: "That Timeline is not available.", workspace: view(baselineTimelineId) };
      }
      return {
        status: "accepted",
        message: `Selected ${timelineId}.`,
        workspace: view(baselineTimelineId),
      };
    },
  };
};
