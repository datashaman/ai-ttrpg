import { randomInt, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  type BatchEventStore,
  type CanonicalEvent,
  type EventStore,
  type RandomSource,
  type TimelineStore,
} from "./structured-play.js";
import {
  createDurableTimelineStore,
  initializeDurableTimelineStorage,
  writeDurableTimelineStorage,
} from "./durable-timeline-store.js";
import {
  parseAdventureArchive,
  serializeAdventureArchive,
  type PortableAdventureRecord,
} from "./adventure-archive.js";
import { isCanonicalEventEnvelope } from "./canonical-event-validation.js";

export interface AdventureIdentity {
  readonly id: string;
  readonly name: string;
}

export interface AdventureSummary extends AdventureIdentity {
  readonly eventCount: number;
}

export interface OpenAdventure extends AdventureIdentity {
  readonly eventStore: BatchEventStore;
  readonly randomSource: RandomSource;
  readonly timelineStore: TimelineStore;
  close(): void;
}

export interface AdventureRepository {
  create(name: string): OpenAdventure;
  list(): readonly AdventureSummary[];
  open(id: string): OpenAdventure;
  exportArchive(id: string): string;
  importArchive(serialized: string): OpenAdventure;
}

interface InMemoryAdventureRecord extends AdventureIdentity {
  readonly randomSeed: number;
  readonly timelineStore: TimelineStore;
}

interface AdventureMetadata extends AdventureIdentity {
  readonly randomSeed: number;
}

interface LocalAdventureRecord extends AdventureMetadata {
  readonly events: CanonicalEvent[];
}

const adventureName = (name: string): string => {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error("An Adventure requires a name.");
  }
  return normalized;
};

const openAdventure = (
  identity: AdventureIdentity,
  store: TimelineStore,
): OpenAdventure => {
  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error(`Adventure "${identity.id}" is closed.`);
  };
  const timelineStore: TimelineStore = {
    readAll: () => {
      ensureOpen();
      return store.readAll();
    },
    append: (event) => {
      ensureOpen();
      store.append(event);
    },
    appendBatch: (request) => {
      ensureOpen();
      return store.appendBatch(request);
    },
    rollDie: (sides) => {
      ensureOpen();
      return store.rollDie(sides);
    },
    metadata: () => {
      ensureOpen();
      return store.metadata();
    },
    position: () => {
      ensureOpen();
      return store.position();
    },
    view: () => {
      ensureOpen();
      return store.view();
    },
    readTimeline: (timelineId) => {
      ensureOpen();
      return store.readTimeline(timelineId);
    },
    branchTimeline: (eventPosition) => {
      ensureOpen();
      return store.branchTimeline(eventPosition);
    },
    selectTimeline: (timelineId) => {
      ensureOpen();
      return store.selectTimeline(timelineId);
    },
  };
  return {
    id: identity.id,
    name: identity.name,
    eventStore: timelineStore,
    randomSource: timelineStore,
    timelineStore,
    close: () => {
      closed = true;
    },
  };
};

const portableRecord = (
  identity: AdventureIdentity,
  randomSeed: number,
  timelineStore: TimelineStore,
): PortableAdventureRecord => {
  const view = timelineStore.view();
  return {
    ...identity,
    randomSeed,
    activeTimelineId: view.activeTimelineId,
    timelines: view.timelines.map((timeline) => ({
      id: timeline.id,
      parentTimelineId: timeline.parentTimelineId,
      branchEventPosition: timeline.branchEventPosition,
      randomPosition: timeline.randomPosition,
      events: timelineStore.readTimeline(timeline.id),
    })),
  };
};

export const createInMemoryAdventureRepository = (): AdventureRepository => {
  const records = new Map<string, InMemoryAdventureRecord>();

  const open = (id: string): OpenAdventure => {
    const record = records.get(id);
    if (record === undefined) {
      throw new Error(`Adventure "${id}" is unavailable.`);
    }
    return openAdventure(record, record.timelineStore);
  };

  return {
    create: (name) => {
      const randomSeed = randomInt(0x1_0000_0000);
      const record: InMemoryAdventureRecord = {
        id: randomUUID(),
        name: adventureName(name),
        randomSeed,
        timelineStore: createInMemoryTimelineStore({
          seed: randomSeed,
        }),
      };
      records.set(record.id, record);
      return open(record.id);
    },
    list: () =>
      [...records.values()].map(({ id, name, timelineStore }) => ({
        id,
        name,
        eventCount: timelineStore.view().activeTimeline.eventCount,
      })),
    open,
    exportArchive: (id) => {
      const record = records.get(id);
      if (record === undefined) {
        throw new Error(`Adventure "${id}" is unavailable.`);
      }
      return serializeAdventureArchive(
        portableRecord(record, record.randomSeed, record.timelineStore),
      );
    },
    importArchive: (serialized) => {
      const archive = parseAdventureArchive(serialized, validateArchivedEvents);
      if (records.has(archive.id)) {
        throw new Error(
          `Adventure "${archive.id}" already exists; import did not overwrite it.`,
        );
      }
      const record: InMemoryAdventureRecord = {
        id: archive.id,
        name: archive.name,
        randomSeed: archive.randomSeed,
        timelineStore: createInMemoryTimelineStore({
          seed: archive.randomSeed,
          activeTimelineId: archive.activeTimelineId,
          snapshots: archive.timelines,
        }),
      };
      records.set(record.id, record);
      return open(record.id);
    },
  };
};

const metadataFile = "adventure.json";
const eventsFile = "events.jsonl";

const isMetadata = (value: unknown): value is AdventureMetadata =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "id") === "string" &&
  typeof Reflect.get(value, "name") === "string" &&
  Number.isInteger(Reflect.get(value, "randomSeed")) &&
  (Reflect.get(value, "randomSeed") as number) >= 0 &&
  (Reflect.get(value, "randomSeed") as number) <= 0xffff_ffff;

const parseEvents = (serializedEvents: string): CanonicalEvent[] => {
  const parsedEvents: unknown[] = serializedEvents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));
  if (
    !parsedEvents.every((event, index) =>
      isCanonicalEventEnvelope(event, index + 1),
    )
  ) {
    throw new Error("Invalid canonical event history.");
  }
  const events: CanonicalEvent[] = parsedEvents;
  createStructuredPlayApplication({
    eventStore: {
      readAll: () => events,
      append: () => {
        throw new Error("Replay validation cannot append events.");
      },
    },
  }).view();
  return events;
};

const validateArchivedEvents = (
  events: readonly unknown[],
): readonly CanonicalEvent[] =>
  parseEvents(
    events.length === 0
      ? ""
      : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );

const readRecord = (rootDirectory: string, id: string): LocalAdventureRecord => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id)) {
    throw new Error(`Adventure "${id}" is unavailable.`);
  }
  const directory = join(rootDirectory, id);
  if (!existsSync(directory)) {
    throw new Error(`Adventure "${id}" is unavailable.`);
  }

  try {
    const metadata: unknown = JSON.parse(
      readFileSync(join(directory, metadataFile), "utf8"),
    );
    if (!isMetadata(metadata) || metadata.id !== id) throw new Error();
    const events = parseEvents(readFileSync(join(directory, eventsFile), "utf8"));
    return {
      id: metadata.id,
      name: metadata.name,
      events,
      randomSeed: metadata.randomSeed,
    };
  } catch {
    throw new Error(`Adventure "${id}" could not be read.`);
  }
};

export const createLocalAdventureRepository = (
  rootDirectory: string,
): AdventureRepository => {
  mkdirSync(rootDirectory, { recursive: true });

  const open = (id: string): OpenAdventure => {
    const record = readRecord(rootDirectory, id);
    const directory = join(rootDirectory, id);
    try {
      const timelineStore = createDurableTimelineStore({
        directory,
        seed: record.randomSeed,
        parseEvents,
      });
      return openAdventure(record, timelineStore);
    } catch {
      throw new Error(`Adventure "${id}" could not be read.`);
    }
  };

  return {
    create: (name) => {
      const metadata: AdventureMetadata = {
        id: randomUUID(),
        name: adventureName(name),
        randomSeed: randomInt(0x1_0000_0000),
      };
      const directory = join(rootDirectory, metadata.id);
      mkdirSync(directory);
      writeFileSync(
        join(directory, metadataFile),
        `${JSON.stringify(metadata, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(join(directory, eventsFile), "", "utf8");
      initializeDurableTimelineStorage(directory);
      return open(metadata.id);
    },
    list: () =>
      readdirSync(rootDirectory, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && !entry.name.startsWith("."),
        )
        .map((entry) => readRecord(rootDirectory, entry.name))
        .map((record) => {
          const timelineStore = createDurableTimelineStore({
            directory: join(rootDirectory, record.id),
            seed: record.randomSeed,
            parseEvents,
          });
          return {
            id: record.id,
            name: record.name,
            eventCount: timelineStore.view().activeTimeline.eventCount,
          };
        }),
    open,
    exportArchive: (id) => {
      const record = readRecord(rootDirectory, id);
      const timelineStore = createDurableTimelineStore({
        directory: join(rootDirectory, record.id),
        seed: record.randomSeed,
        parseEvents,
      });
      return serializeAdventureArchive(
        portableRecord(record, record.randomSeed, timelineStore),
      );
    },
    importArchive: (serialized) => {
      const archive = parseAdventureArchive(serialized, validateArchivedEvents);
      const directory = join(rootDirectory, archive.id);
      if (existsSync(directory)) {
        throw new Error(
          `Adventure "${archive.id}" already exists; import did not overwrite it.`,
        );
      }
      const temporaryDirectory = join(
        rootDirectory,
        `.${archive.id}.${randomUUID()}.import`,
      );
      try {
        mkdirSync(temporaryDirectory);
        const metadata: AdventureMetadata = {
          id: archive.id,
          name: archive.name,
          randomSeed: archive.randomSeed,
        };
        writeFileSync(
          join(temporaryDirectory, metadataFile),
          `${JSON.stringify(metadata, null, 2)}\n`,
          "utf8",
        );
        writeDurableTimelineStorage(
          temporaryDirectory,
          archive.activeTimelineId,
          archive.timelines,
        );
        renameSync(temporaryDirectory, directory);
      } catch (error) {
        rmSync(temporaryDirectory, { recursive: true, force: true });
        throw error;
      }
      return open(archive.id);
    },
  };
};
