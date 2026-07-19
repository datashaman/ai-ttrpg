import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { CanonicalEvent, TimelineStore } from "./structured-play.js";
import { acceptEventBatch } from "./event-batch.js";
import {
  createTimelineStore,
  type TimelineSnapshot,
} from "./timeline-store.js";
import {
  isTimelineId,
  rootTimelineId,
  validateTimelineGraph,
} from "./timeline-graph.js";

interface TimelineMetadata {
  readonly id: string;
  readonly parentTimelineId: string | null;
  readonly branchEventPosition: number | null;
}

interface TimelineGraph {
  readonly activeTimelineId: string;
  readonly timelines: readonly TimelineMetadata[];
}

const graphFile = "timelines.json";
const childDirectory = "timelines";

const rootGraph = (): TimelineGraph => ({
  activeTimelineId: rootTimelineId,
  timelines: [
    {
      id: rootTimelineId,
      parentTimelineId: null,
      branchEventPosition: null,
    },
  ],
});

const eventFile = (directory: string, timelineId: string): string =>
  timelineId === rootTimelineId
    ? join(directory, "events.jsonl")
    : join(directory, childDirectory, `${timelineId}.events.jsonl`);

const writeGraph = (directory: string, graph: TimelineGraph): void =>
  writeFileSync(
    join(directory, graphFile),
    `${JSON.stringify(graph, null, 2)}\n`,
    "utf8",
  );

export const initializeDurableTimelineStorage = (directory: string): void => {
  mkdirSync(join(directory, childDirectory), { recursive: true });
  writeGraph(directory, rootGraph());
};

export const writeDurableTimelineStorage = (
  directory: string,
  activeTimelineId: string,
  timelines: readonly TimelineSnapshot[],
): void => {
  mkdirSync(join(directory, childDirectory), { recursive: true });
  for (const timeline of timelines) {
    writeFileSync(
      eventFile(directory, timeline.id),
      serializedEvents(timeline.events),
      "utf8",
    );
  }
  writeGraph(directory, {
    activeTimelineId,
    timelines: timelines.map(
      ({ id, parentTimelineId, branchEventPosition }) => ({
        id,
        parentTimelineId,
        branchEventPosition,
      }),
    ),
  });
};

const isTimelineMetadata = (value: unknown): value is TimelineMetadata =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "id") === "string" &&
  isTimelineId(Reflect.get(value, "id") as string) &&
  (Reflect.get(value, "parentTimelineId") === null ||
    (typeof Reflect.get(value, "parentTimelineId") === "string" &&
      isTimelineId(Reflect.get(value, "parentTimelineId") as string))) &&
  (Reflect.get(value, "branchEventPosition") === null ||
    (Number.isInteger(Reflect.get(value, "branchEventPosition")) &&
      (Reflect.get(value, "branchEventPosition") as number) >= 1));

const readGraph = (directory: string): TimelineGraph => {
  const path = join(directory, graphFile);
  if (!existsSync(path)) return rootGraph();
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    typeof Reflect.get(value, "activeTimelineId") !== "string" ||
    !Array.isArray(Reflect.get(value, "timelines")) ||
    !(Reflect.get(value, "timelines") as unknown[]).every(isTimelineMetadata)
  ) {
    throw new Error("Invalid Timeline graph.");
  }
  const graph = value as TimelineGraph;
  return graph;
};

const serializedEvents = (events: readonly CanonicalEvent[]): string =>
  events.length === 0
    ? ""
    : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;

const replaceEventsAtomically = (
  path: string,
  events: readonly CanonicalEvent[],
): void => {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, serializedEvents(events), "utf8");
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }
};

export const createDurableTimelineStore = ({
  directory,
  seed,
  parseEvents,
}: {
  readonly directory: string;
  readonly seed: number;
  readonly parseEvents: (serialized: string) => CanonicalEvent[];
}): TimelineStore => {
  mkdirSync(join(directory, childDirectory), { recursive: true });
  const graph = readGraph(directory);
  const snapshots: TimelineSnapshot[] = graph.timelines.map((metadata) => ({
    ...metadata,
    events: parseEvents(
      readFileSync(eventFile(directory, metadata.id), "utf8"),
    ),
  }));
  validateTimelineGraph({
    activeTimelineId: graph.activeTimelineId,
    timelines: snapshots,
  });
  const metadata = (timeline: TimelineSnapshot): TimelineMetadata => ({
    id: timeline.id,
    parentTimelineId: timeline.parentTimelineId,
    branchEventPosition: timeline.branchEventPosition,
  });
  return createTimelineStore({
    seed,
    activeTimelineId: graph.activeTimelineId,
    snapshots,
    persistence: {
      appendBatch: (timelineId, request) => {
        const path = eventFile(directory, timelineId);
        const history = parseEvents(readFileSync(path, "utf8"));
        return acceptEventBatch(history, request, (events) =>
          replaceEventsAtomically(path, events),
        );
      },
      branch: (timeline, activeTimelineId, timelineSnapshots) => {
        writeFileSync(
          eventFile(directory, timeline.id),
          serializedEvents(timeline.events),
          "utf8",
        );
        writeGraph(directory, {
          activeTimelineId,
          timelines: timelineSnapshots.map(metadata),
        });
      },
      select: (activeTimelineId, timelineSnapshots) =>
        writeGraph(directory, {
          activeTimelineId,
          timelines: timelineSnapshots.map(metadata),
        }),
    },
  });
};
