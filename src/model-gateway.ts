import { randomUUID } from "node:crypto";

import type { EvidenceBundle } from "./evidence-bundle.js";
import { immutableSnapshot } from "./model-boundary.js";
import type { CanonicalEvent, StructuredPlayInput } from "./structured-play.js";

export interface InterpretationModelTask {
  readonly type: "interpret-player-input";
  readonly input: {
    readonly utterance: string;
  };
  readonly evidenceBundle: EvidenceBundle;
}

export type ModelTask = InterpretationModelTask;

export interface ModelProvider {
  readonly provider: string;
  readonly model: string;
  invoke(task: ModelTask): Promise<unknown>;
}

export interface ModelGatewayExecution {
  readonly callId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly task: ModelTask;
  readonly output: unknown;
}

export interface ModelGateway {
  execute(task: ModelTask): Promise<ModelGatewayExecution>;
}

export const createModelGateway = ({
  provider,
  promptVersion = "interpret-player-input-v1",
}: {
  readonly provider: ModelProvider;
  readonly promptVersion?: string;
}): ModelGateway => ({
  execute: async (task) => {
    const started = Date.now();
    const taskSnapshot = immutableSnapshot(task);
    const output = await provider.invoke(taskSnapshot);
    const completed = Date.now();
    return immutableSnapshot({
      callId: randomUUID(),
      provider: provider.provider,
      model: provider.model,
      promptVersion,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date(completed).toISOString(),
      durationMs: Math.max(0, completed - started),
      task: taskSnapshot,
      output,
    });
  },
});

export const createScriptedModelProvider = ({
  model,
  responses,
}: {
  readonly model: string;
  readonly responses: Readonly<Record<string, unknown>>;
}): ModelProvider => {
  const script = immutableSnapshot(responses);
  return {
    provider: "scripted",
    model,
    invoke: async (task) => {
      const response = script[task.input.utterance];
      if (response === undefined) {
        throw new Error("No scripted model response exists for that task input.");
      }
      return immutableSnapshot(response);
    },
  };
};

export interface ModelCallRecord {
  readonly id: string;
  readonly taskType: ModelTask["type"];
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly evidenceBundleId: string;
  readonly evidenceItemIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly validation:
    | { readonly status: "accepted" }
    | { readonly status: "rejected"; readonly reason: string };
  readonly validatedOutput: unknown | null;
  readonly command: StructuredPlayInput | null;
  readonly acceptedEventIds: readonly CanonicalEvent["id"][];
}

export interface ModelCallRecordStore {
  append(record: ModelCallRecord): void;
  readAll(): readonly ModelCallRecord[];
}

export const createInMemoryModelCallRecordStore = (): ModelCallRecordStore => {
  const records: ModelCallRecord[] = [];
  return {
    append: (record) => records.push(immutableSnapshot(record)),
    readAll: () => immutableSnapshot(records),
  };
};

export const modelCallRecordFrom = ({
  execution,
  validation,
  validatedOutput,
  command,
  acceptedEvents,
}: {
  readonly execution: ModelGatewayExecution;
  readonly validation: ModelCallRecord["validation"];
  readonly validatedOutput: unknown | null;
  readonly command: StructuredPlayInput | null;
  readonly acceptedEvents: readonly CanonicalEvent[];
}): ModelCallRecord =>
  immutableSnapshot({
    id: execution.callId,
    taskType: execution.task.type,
    provider: execution.provider,
    model: execution.model,
    promptVersion: execution.promptVersion,
    evidenceBundleId: execution.task.evidenceBundle.id,
    evidenceItemIds: execution.task.evidenceBundle.items.map((item) => item.id),
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    durationMs: execution.durationMs,
    validation,
    validatedOutput,
    command,
    acceptedEventIds: acceptedEvents.map((event) => event.id),
  });
