import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { immutableSnapshot } from "./model-boundary.js";
import type {
  ModelCallRecord,
  ModelCallRecordStore,
} from "./model-gateway.js";

const taskTypes = new Set([
  "interpret-player-input",
  "explain-rules",
  "narrate-committed-outcome",
]);
const fallbackOutcomes = new Set([
  "none",
  "safe-rejection",
  "deterministic-rules",
  "deterministic-narration",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isModelCallRecord = (value: unknown): value is ModelCallRecord => {
  if (!isObject(value)) return false;
  const validation = value.validation;
  const usage = value.usage;
  return (
    typeof value.id === "string" &&
    typeof value.taskType === "string" &&
    taskTypes.has(value.taskType) &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    typeof value.promptVersion === "string" &&
    typeof value.evidenceBundleId === "string" &&
    typeof value.evidenceBundleHash === "string" &&
    Array.isArray(value.evidenceReferences) &&
    value.evidenceReferences.every(
      (reference) =>
        isObject(reference) &&
        typeof reference.itemId === "string" &&
        typeof reference.sourceKind === "string" &&
        typeof reference.sourceReference === "string" &&
        typeof reference.contentHash === "string",
    ) &&
    typeof value.startedAt === "string" &&
    typeof value.completedAt === "string" &&
    typeof value.durationMs === "number" &&
    value.durationMs >= 0 &&
    (usage === null ||
      (isObject(usage) &&
        Number.isInteger(usage.inputTokens) &&
        Number.isInteger(usage.outputTokens) &&
        Number.isInteger(usage.totalTokens))) &&
    Number.isInteger(value.retryCount) &&
    typeof value.fallbackOutcome === "string" &&
    fallbackOutcomes.has(value.fallbackOutcome) &&
    isObject(validation) &&
    (validation.status === "accepted" ||
      (validation.status === "rejected" &&
        typeof validation.reason === "string")) &&
    (value.command === null || isObject(value.command)) &&
    isStringArray(value.acceptedEventIds) &&
    isStringArray(value.correlationIds)
  );
};

const parsedRecord = (line: string): ModelCallRecord | null => {
  try {
    const value: unknown = JSON.parse(line);
    return isModelCallRecord(value) ? value : null;
  } catch {
    return null;
  }
};

export const initializeDurableModelCallRecordStorage = (path: string): void =>
  writeFileSync(path, "", "utf8");

export const createDurableModelCallRecordStore = (
  path: string,
): ModelCallRecordStore => ({
  append: (record) => {
    if (!isModelCallRecord(record)) {
      throw new Error("Invalid Model Call Record.");
    }
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  },
  readAll: () => {
    if (!existsSync(path)) return [];
    let serialized: string;
    try {
      serialized = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    const records = serialized
      .split("\n")
      .filter((line) => line.length > 0)
      .map(parsedRecord)
      .filter((record): record is ModelCallRecord => record !== null);
    return immutableSnapshot(records);
  },
});
