import { randomUUID } from "node:crypto";

import type { EvidenceBundle } from "./evidence-bundle.js";
import { immutableSnapshot, invokeWithinTimeout } from "./model-boundary.js";
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
  invoke(task: ModelTask): Promise<ModelProviderResult>;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ModelProviderResult {
  readonly output: unknown;
  readonly usage: ModelUsage | null;
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
  readonly outcome:
    | {
        readonly status: "succeeded";
        readonly output: unknown;
        readonly usage: ModelUsage | null;
      }
    | {
        readonly status: "failed";
        readonly reason: string;
      };
  readonly retryCount: 0;
}

export interface ModelGateway {
  execute(
    task: ModelTask,
    options?: { readonly timeoutMs?: number },
  ): Promise<ModelGatewayExecution>;
}

export const createModelGateway = ({
  provider,
  promptVersion = "interpret-player-input-v1",
}: {
  readonly provider: ModelProvider;
  readonly promptVersion?: string;
}): ModelGateway => ({
  execute: async (task, options) => {
    const started = Date.now();
    const taskSnapshot = immutableSnapshot(task);
    let outcome: ModelGatewayExecution["outcome"];
    try {
      const result = (await invokeWithinTimeout(
        () => provider.invoke(taskSnapshot),
        options?.timeoutMs ?? 5_000,
      )) as ModelProviderResult;
      outcome = {
        status: "succeeded",
        output: result.output,
        usage: result.usage,
      };
    } catch (error) {
      outcome = {
        status: "failed",
        reason: error instanceof Error ? error.message : "Model invocation failed.",
      };
    }
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
      outcome,
      retryCount: 0 as const,
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
      return immutableSnapshot({ output: response, usage: null });
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
  readonly evidenceBundleHash: string;
  readonly evidenceReferences: readonly {
    readonly itemId: string;
    readonly sourceKind: EvidenceBundle["items"][number]["sourceKind"];
    readonly sourceReference: string;
  }[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly usage: ModelUsage | null;
  readonly retryCount: number;
  readonly fallbackOutcome: "none" | "safe-rejection";
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
  fallbackOutcome,
}: {
  readonly execution: ModelGatewayExecution;
  readonly validation: ModelCallRecord["validation"];
  readonly validatedOutput: unknown | null;
  readonly command: StructuredPlayInput | null;
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly fallbackOutcome: ModelCallRecord["fallbackOutcome"];
}): ModelCallRecord =>
  immutableSnapshot({
    id: execution.callId,
    taskType: execution.task.type,
    provider: execution.provider,
    model: execution.model,
    promptVersion: execution.promptVersion,
    evidenceBundleId: execution.task.evidenceBundle.id,
    evidenceBundleHash: execution.task.evidenceBundle.id.replace(/^evidence:/, ""),
    evidenceReferences: execution.task.evidenceBundle.items.map((item) => ({
      itemId: item.id,
      sourceKind: item.sourceKind,
      sourceReference: item.sourceReference,
    })),
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    durationMs: execution.durationMs,
    usage:
      execution.outcome.status === "succeeded"
        ? execution.outcome.usage
        : null,
    retryCount: execution.retryCount,
    fallbackOutcome,
    validation,
    validatedOutput,
    command,
    acceptedEventIds: acceptedEvents.map((event) => event.id),
  });
