import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  createStructuredPlayApplication,
  type CanonicalEvent,
  type EventStore,
} from "./structured-play.js";

export interface AdventureIdentity {
  readonly id: string;
  readonly name: string;
}

export interface AdventureSummary extends AdventureIdentity {
  readonly eventCount: number;
}

export interface OpenAdventure extends AdventureIdentity {
  readonly eventStore: EventStore;
  close(): void;
}

export interface AdventureRepository {
  create(name: string): OpenAdventure;
  list(): readonly AdventureSummary[];
  open(id: string): OpenAdventure;
}

interface AdventureRecord extends AdventureIdentity {
  readonly events: CanonicalEvent[];
}

type AdventureMetadata = AdventureIdentity;

const adventureName = (name: string): string => {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error("An Adventure requires a name.");
  }
  return normalized;
};

const openAdventure = (
  record: AdventureRecord,
  appendEvent: (event: CanonicalEvent) => void,
): OpenAdventure => {
  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error(`Adventure "${record.id}" is closed.`);
  };
  return {
    id: record.id,
    name: record.name,
    eventStore: {
      readAll: () => {
        ensureOpen();
        return structuredClone(record.events);
      },
      append: (event) => {
        ensureOpen();
        appendEvent(structuredClone(event));
      },
    },
    close: () => {
      closed = true;
    },
  };
};

export const createInMemoryAdventureRepository = (): AdventureRepository => {
  const records = new Map<string, AdventureRecord>();

  const open = (id: string): OpenAdventure => {
    const record = records.get(id);
    if (record === undefined) {
      throw new Error(`Adventure "${id}" is unavailable.`);
    }
    return openAdventure(record, (event) => record.events.push(event));
  };

  return {
    create: (name) => {
      const record: AdventureRecord = {
        id: randomUUID(),
        name: adventureName(name),
        events: [],
      };
      records.set(record.id, record);
      return open(record.id);
    },
    list: () =>
      [...records.values()].map(({ id, name, events }) => ({
        id,
        name,
        eventCount: events.length,
      })),
    open,
  };
};

const metadataFile = "adventure.json";
const eventsFile = "events.jsonl";

const canonicalEventTypes: ReadonlySet<CanonicalEvent["type"]> = new Set([
  "PlayerCharacterConfigured",
  "SceneStarted",
  "SceneTransitioned",
  "ConfrontationStarted",
  "FreeActionCompleted",
  "AdventureEnded",
  "CheckProposalCreated",
  "CheckProposalReplaced",
  "CheckProposalWithdrawn",
  "CheckRollRevealed",
  "CheckResolved",
  "ConfrontationEnded",
  "FieldKitUsed",
  "NarratorLikelihoodRecommended",
  "OracleAnswered",
]);

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const hasString = (value: object, property: string): boolean =>
  typeof Reflect.get(value, property) === "string";

const isScene = (value: unknown): boolean =>
  value === "arrival" ||
  value === "discovery" ||
  value === "confrontation" ||
  value === "consequence";

const isEstablishedFact = (value: unknown): value is object =>
  isObject(value) && hasString(value, "id") && hasString(value, "text");

const isAdventureEnding = (value: unknown): boolean =>
  isEstablishedFact(value) &&
  ["favourable", "adverse", "unresolved"].includes(
    Reflect.get(value, "kind") as string,
  );

const isPlayerCharacter = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  const traits = Reflect.get(value, "traits");
  const inventory = Reflect.get(value, "inventory");
  return (
    hasString(value, "name") &&
    hasString(value, "pronouns") &&
    hasString(value, "motivation") &&
    isObject(traits) &&
    ["Might", "Wits", "Presence"].every((trait) =>
      [0, 1, 2].includes(Reflect.get(traits, trait) as number),
    ) &&
    [0, 1, 2, 3].includes(Reflect.get(value, "health") as number) &&
    [0, 1, 2, 3].includes(Reflect.get(value, "resolve") as number) &&
    Array.isArray(inventory)
  );
};

const isCanonicalEventPayload = (
  type: CanonicalEvent["type"],
  payload: unknown,
): boolean => {
  if (!isObject(payload)) return false;
  switch (type) {
    case "PlayerCharacterConfigured":
      return isPlayerCharacter(payload);
    case "SceneStarted":
      return isScene(Reflect.get(payload, "scene"));
    case "SceneTransitioned":
      return (
        isScene(Reflect.get(payload, "from")) &&
        isScene(Reflect.get(payload, "to"))
      );
    case "ConfrontationStarted":
      return isObject(Reflect.get(payload, "definition"));
    case "FreeActionCompleted":
      return (
        hasString(payload, "actionId") &&
        isEstablishedFact(Reflect.get(payload, "establishedFact"))
      );
    case "AdventureEnded":
      return (
        isScene(Reflect.get(payload, "from")) &&
        isAdventureEnding(Reflect.get(payload, "ending"))
      );
    case "CheckProposalCreated":
      return isObject(Reflect.get(payload, "proposal"));
    case "CheckProposalReplaced":
      return (
        hasString(payload, "supersededProposalId") &&
        isObject(Reflect.get(payload, "proposal")) &&
        ["correction", "revised-action"].includes(
          Reflect.get(payload, "reason") as string,
        )
      );
    case "CheckProposalWithdrawn":
      return hasString(payload, "proposalId");
    case "CheckRollRevealed":
      return isObject(Reflect.get(payload, "pendingChoice"));
    case "CheckResolved":
      return (
        hasString(payload, "proposalId") &&
        hasString(payload, "actionId") &&
        hasString(payload, "pendingChoiceId") &&
        isObject(Reflect.get(payload, "committedStake")) &&
        isObject(Reflect.get(payload, "trace"))
      );
    case "ConfrontationEnded":
      return (
        hasString(payload, "confrontationId") &&
        isObject(Reflect.get(payload, "ending")) &&
        Array.isArray(Reflect.get(payload, "effects")) &&
        (Reflect.get(payload, "nextScene") === null ||
          Reflect.get(payload, "nextScene") === "consequence")
      );
    case "FieldKitUsed":
      return (
        Reflect.get(payload, "item") === "Field Kit" &&
        Reflect.get(payload, "removalReason") === "consumption" &&
        ["Health", "Resolve"].includes(Reflect.get(payload, "resource") as string) &&
        Reflect.get(payload, "restored") === 1 &&
        [0, 1, 2, 3].includes(Reflect.get(payload, "resultingValue") as number)
      );
    case "NarratorLikelihoodRecommended":
      return isObject(Reflect.get(payload, "recommendation"));
    case "OracleAnswered":
      return (
        hasString(payload, "recommendationId") &&
        isEstablishedFact(Reflect.get(payload, "establishedFact")) &&
        isObject(Reflect.get(payload, "trace"))
      );
  }
};

const isCanonicalEventEnvelope = (
  value: unknown,
  expectedSequence: number,
): value is CanonicalEvent => {
  if (!isObject(value)) return false;
  const type = Reflect.get(value, "type") as CanonicalEvent["type"];
  const payload = Reflect.get(value, "payload");
  return (
    hasString(value, "id") &&
    Reflect.get(value, "streamId") === "adventure" &&
    Reflect.get(value, "sequence") === expectedSequence &&
    canonicalEventTypes.has(type) &&
    Reflect.get(value, "schemaVersion") === 1 &&
    hasString(value, "timestamp") &&
    Reflect.get(value, "origin") === "structured-play" &&
    hasString(value, "correlationId") &&
    hasString(value, "causationId") &&
    isCanonicalEventPayload(type, payload)
  );
};

const isMetadata = (value: unknown): value is AdventureMetadata =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "id") === "string" &&
  typeof Reflect.get(value, "name") === "string";

const readRecord = (rootDirectory: string, id: string): AdventureRecord => {
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
    const serializedEvents = readFileSync(join(directory, eventsFile), "utf8");
    const parsedEvents: unknown[] = serializedEvents
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): unknown => JSON.parse(line));
    if (
      !parsedEvents.every((event, index) =>
        isCanonicalEventEnvelope(event, index + 1),
      )
    ) {
      throw new Error();
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
    return { id: metadata.id, name: metadata.name, events };
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
    const eventPath = join(rootDirectory, id, eventsFile);
    return openAdventure(record, (event) => {
      appendFileSync(eventPath, `${JSON.stringify(event)}\n`, "utf8");
      record.events.push(event);
    });
  };

  return {
    create: (name) => {
      const metadata: AdventureMetadata = {
        id: randomUUID(),
        name: adventureName(name),
      };
      const directory = join(rootDirectory, metadata.id);
      mkdirSync(directory);
      writeFileSync(
        join(directory, metadataFile),
        `${JSON.stringify(metadata, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(join(directory, eventsFile), "", "utf8");
      return open(metadata.id);
    },
    list: () =>
      readdirSync(rootDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => readRecord(rootDirectory, entry.name))
        .map(({ id, name, events }) => ({
          id,
          name,
          eventCount: events.length,
        })),
    open,
  };
};
