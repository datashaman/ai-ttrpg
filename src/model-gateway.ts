import { randomUUID } from "node:crypto";

import type { EvidenceBundle } from "./evidence-bundle.js";
import {
  immutableSnapshot,
  invokeWithinTimeout,
  ModelTimeoutError,
} from "./model-boundary.js";
import type { CanonicalEvent, StructuredPlayInput } from "./structured-play.js";

export interface InterpretationModelTask {
  readonly type: "interpret-player-input";
  readonly input: {
    readonly utterance: string;
    readonly repairOf?: unknown;
  };
  readonly evidenceBundle: EvidenceBundle;
}

export interface RulesExplanationModelTask {
  readonly type: "explain-rules";
  readonly input: {
    readonly utterance: string;
    readonly repairOf?: unknown;
  };
  readonly evidenceBundle: EvidenceBundle;
}

export interface NarrationModelTask {
  readonly type: "narrate-committed-outcome";
  readonly input: {
    readonly deterministicSummary: string;
    readonly repairOf?: unknown;
  };
  readonly evidenceBundle: EvidenceBundle;
}

export type ModelTask =
  | InterpretationModelTask
  | RulesExplanationModelTask
  | NarrationModelTask;

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

export type ModelFailureCode =
  | "unavailable"
  | "timeout"
  | "unauthenticated"
  | "rate-limited"
  | "over-budget";

export class ModelProviderError extends Error {
  constructor(
    readonly code: Exclude<ModelFailureCode, "timeout">,
    message: string,
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
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
        readonly code: ModelFailureCode;
        readonly reason: string;
        readonly usage: ModelUsage | null;
      };
  readonly retryCount: 0 | 1;
}

export interface ModelGateway {
  execute(
    task: ModelTask,
    options?: {
      readonly timeoutMs?: number;
      readonly isStructurallyValid?: (output: unknown) => boolean;
    },
  ): Promise<ModelGatewayExecution>;
}

const repairTaskFrom = (
  task: ModelTask,
  repairOf: unknown,
): ModelTask => {
  if (task.type === "narrate-committed-outcome") {
    return immutableSnapshot({
      ...task,
      input: { ...task.input, repairOf },
    });
  }
  return immutableSnapshot({
    ...task,
    input: { ...task.input, repairOf },
  });
};

export const createModelGateway = ({
  provider,
  promptVersion,
}: {
  readonly provider: ModelProvider;
  readonly promptVersion?: string;
}): ModelGateway => ({
  execute: async (task, options) => {
    const started = Date.now();
    const taskPromptVersion =
      promptVersion ??
      (task.type === "interpret-player-input"
        ? "interpret-player-input-v1"
        : task.type === "explain-rules"
          ? "explain-rules-v1"
          : "narrate-committed-outcome-v1");
    const taskSnapshot = immutableSnapshot(task);
    let outcome: ModelGatewayExecution["outcome"];
    let retryCount: 0 | 1 = 0;
    let usage: ModelUsage | null = null;
    const addUsage = (next: ModelUsage | null): void => {
      if (next === null) return;
      usage =
        usage === null
          ? next
          : {
              inputTokens: usage.inputTokens + next.inputTokens,
              outputTokens: usage.outputTokens + next.outputTokens,
              totalTokens: usage.totalTokens + next.totalTokens,
            };
    };
    try {
      let result = (await invokeWithinTimeout(
        () => provider.invoke(taskSnapshot),
        options?.timeoutMs ?? 5_000,
      )) as ModelProviderResult;
      addUsage(result.usage);
      if (
        options?.isStructurallyValid !== undefined &&
        !options.isStructurallyValid(result.output)
      ) {
        retryCount = 1;
        const repairTask = repairTaskFrom(taskSnapshot, result.output);
        result = (await invokeWithinTimeout(
          () => provider.invoke(repairTask),
          options.timeoutMs ?? 5_000,
        )) as ModelProviderResult;
        addUsage(result.usage);
      }
      outcome = {
        status: "succeeded",
        output: result.output,
        usage,
      };
    } catch (error) {
      outcome = {
        status: "failed",
        code:
          error instanceof ModelProviderError
            ? error.code
            : error instanceof ModelTimeoutError
              ? "timeout"
              : "unavailable",
        reason: error instanceof Error ? error.message : "Model invocation failed.",
        usage,
      };
    }
    const completed = Date.now();
    return immutableSnapshot({
      callId: randomUUID(),
      provider: provider.provider,
      model: provider.model,
      promptVersion: taskPromptVersion,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date(completed).toISOString(),
      durationMs: Math.max(0, completed - started),
      task: taskSnapshot,
      outcome,
      retryCount,
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
      const taskInput =
        task.type === "narrate-committed-outcome"
          ? task.input.deterministicSummary
          : task.input.utterance;
      const response =
        script[`${task.type}:${taskInput}`] ?? script[taskInput];
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
  readonly fallbackOutcome:
    | "none"
    | "safe-rejection"
    | "deterministic-rules"
    | "deterministic-narration";
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
    usage: execution.outcome.usage,
    retryCount: execution.retryCount,
    fallbackOutcome,
    validation,
    validatedOutput,
    command,
    acceptedEventIds: acceptedEvents.map((event) => event.id),
  });
