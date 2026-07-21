import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeAdventureArchive } from "./adventure-archive.js";
import {
  createLocalAdventureRepository,
  type AdventureRepository,
  type OpenAdventure,
} from "./adventure-repository.js";
import { immutableSnapshot, isRecord } from "./model-boundary.js";
import {
  runNaturalLanguagePlay,
  type InterpretationModel,
} from "./natural-language-play.js";
import {
  createStructuredPlayApplication,
  type AcceptedResult,
  type CanonicalEvent,
  type StructuredPlayApplication,
  type StructuredPlayInput,
} from "./structured-play.js";
import type { StructuredPlayIO } from "./structured-play-runner.js";
import { TEN_SCENE_ADVENTURE } from "./ten-scene-adventure.js";
import { rootTimelineId } from "./timeline-graph.js";

export type SimulationRecoveryKind =
  | "structured-play-fallback"
  | "repository-restart"
  | "stale-write-retry"
  | "cancelled-pending-choice"
  | "invalid-command-retry"
  | "model-cancellation";

export type SimulationScenario =
  | "structured-invalid-command"
  | "natural-language-paraphrase"
  | "rules-query"
  | "table-chat"
  | "pending-choice"
  | "model-cancellation"
  | "model-timeout"
  | "malformed-model-output"
  | "model-failure"
  | "stale-write-and-restart";

export interface AdventureSimulationReport {
  readonly simulationId: "durable-adventure-100-turn-v1";
  readonly status: "passed" | "failed";
  readonly turns: { readonly attempted: number; readonly accepted: number };
  readonly randomStream: readonly number[];
  readonly commands: readonly {
    readonly turn: number;
    readonly mode: SimulationScenario;
    readonly command: string;
    readonly status: "accepted" | "recovered";
  }[];
  readonly events: readonly {
    readonly turn: number;
    readonly type: CanonicalEvent["type"];
    readonly sequence: number;
  }[];
  readonly projections: readonly {
    readonly turn: number;
    readonly digest: string;
  }[];
  readonly modelTasks: readonly {
    readonly turn: number;
    readonly outcome:
      | "accepted"
      | "cancelled"
      | "timeout"
      | "malformed"
      | "failed";
  }[];
  readonly recoveryActions: readonly {
    readonly turn: number;
    readonly kind: SimulationRecoveryKind;
  }[];
  readonly timelineCount: number;
  readonly invariants: {
    readonly replayDivergence: number;
    readonly duplicateEvents: number;
    readonly unauthorizedLeakage: number;
  };
  readonly failure: null | {
    readonly turn: number;
    readonly layer:
      | "controller"
      | "model"
      | "repository"
      | "event"
      | "projection"
      | "visibility";
    readonly message: string;
  };
}

const SIMULATION_ID = "durable-adventure-100-turn-v1" as const;
const ADVENTURE_ID = "adventure-simulation-v1";
const FIXED_RANDOM_SEED = 88_100;
const SENSITIVE_TABLE_CHAT = "OPENAI_API_KEY=simulation-only-secret";
const SCENARIOS: readonly SimulationScenario[] = [
  "structured-invalid-command",
  "natural-language-paraphrase",
  "rules-query",
  "table-chat",
  "pending-choice",
  "model-cancellation",
  "model-timeout",
  "malformed-model-output",
  "model-failure",
  "stale-write-and-restart",
];
const PLAYER_ACTION_PARAPHRASES = [
  "I shoulder the old vestibule door open.",
  "Can I lean into the sealed door until it gives?",
  "Mara studies the lock and tries to open the gallery entrance.",
  "Let's get through this stubborn vestibule door.",
  "I work the mechanism and push the doorway inward.",
  "Open that sealed door with Wits.",
  "I carefully coax the old gallery door loose.",
  "Could Mara find a clever way through the vestibule entrance?",
  "I inspect the seal, then try to release the door.",
  "Time to solve this door and enter the gallery.",
] as const;
const generatedId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalize = (value: unknown): unknown => {
  if (typeof value === "string") {
    if (generatedId.test(value)) return "<generated-id>";
    if (/^timeline-[0-9a-f-]{36}$/i.test(value))
      return "timeline-<generated-id>";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value))
      return "<timestamp>";
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]),
  );
};

const digest = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");

const scriptedIo = (
  answers: readonly string[],
): {
  readonly io: StructuredPlayIO;
  readonly output: readonly string[];
} => {
  const remaining = [...answers];
  const output: string[] = [];
  return {
    io: {
      read: async (prompt) => {
        output.push(prompt);
        const answer = remaining.shift();
        if (answer === undefined)
          throw new Error("Simulation input exhausted.");
        return answer;
      },
      write: (text) => output.push(text),
    },
    output,
  };
};

const applicationFor = (adventure: OpenAdventure): StructuredPlayApplication =>
  createStructuredPlayApplication({
    ...TEN_SCENE_ADVENTURE.structuredPlayOptions,
    timelineStore: adventure.timelineStore,
    conversationStore: adventure.conversationStore,
  });

const accept = (
  app: StructuredPlayApplication,
  input: StructuredPlayInput,
): AcceptedResult => {
  const result = app.submit(input);
  if (result.status === "rejected") throw new Error(result.message);
  return result;
};

const finishCheck = (app: StructuredPlayApplication): void => {
  const proposal = app.view().state.pendingCheckProposal;
  if (proposal === null) return;
  const revealed = accept(app, {
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });
  if (revealed.state.pendingChoice !== null) {
    accept(app, {
      type: "resolve-pending-check",
      pendingChoiceId: revealed.state.pendingChoice.id,
      choice: "decline",
    });
  }
};

const chooseAndFinish = (app: StructuredPlayApplication): void => {
  accept(app, { type: "choose-action", actionId: "open-vestibule-door" });
  finishCheck(app);
};

const createFixedAdventure = (repository: AdventureRepository): OpenAdventure =>
  repository.importArchive(
    serializeAdventureArchive({
      id: ADVENTURE_ID,
      name: "The Simulated Locked Manor",
      randomSeed: FIXED_RANDOM_SEED,
      activeTimelineId: rootTimelineId,
      timelines: [
        {
          id: rootTimelineId,
          parentTimelineId: null,
          branchEventPosition: null,
          randomPosition: 0,
          events: [],
        },
      ],
    }),
  );

const advanceToSimulationPosition = (app: StructuredPlayApplication): void => {
  accept(app, {
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  accept(app, { type: "begin-adventure" });
  for (const actionId of [
    "read-arrival-marker",
    "raise-gatehouse-latch",
    "cross-courtyard",
  ]) {
    accept(app, { type: "choose-action", actionId });
    finishCheck(app);
    const recommendation = app.view().state.pendingNarratorRecommendation;
    if (recommendation !== null) {
      accept(app, {
        type: "confirm-oracle-likelihood",
        recommendationId: recommendation.id,
        likelihood: recommendation.likelihood,
      });
    }
  }
  if (app.view().state.activeScene !== "vestibule") {
    throw new Error("Simulation setup did not reach the vestibule Scene.");
  }
};

const naturalLanguageTurn = async ({
  adventure,
  answers,
  interpreter,
  timeoutMs,
}: {
  readonly adventure: OpenAdventure;
  readonly answers: readonly string[];
  readonly interpreter: InterpretationModel;
  readonly timeoutMs?: number;
}): Promise<void> => {
  const script = scriptedIo(answers);
  await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    timelineStore: adventure.timelineStore,
    conversationStore: adventure.conversationStore,
    applicationOptions: TEN_SCENE_ADVENTURE.structuredPlayOptions,
    runToAdventureEnd: false,
    ...(timeoutMs === undefined ? {} : { interpretationTimeoutMs: timeoutMs }),
  });
};

const playerActionInterpreter = (): InterpretationModel => ({
  interpret: async () => ({
    status: "interpreted",
    classification: "player-action",
    capabilityId: "open-vestibule-door",
    referencedEntityIds: ["scene:vestibule"],
    arguments: {},
  }),
});

const observeModelFailure = async ({
  adventure,
  interpreter,
  timeoutMs,
}: {
  readonly adventure: OpenAdventure;
  readonly interpreter: InterpretationModel;
  readonly timeoutMs?: number;
}): Promise<StructuredPlayApplication> => {
  await naturalLanguageTurn({
    adventure,
    answers: ["Open the door"],
    interpreter,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return applicationFor(adventure);
};

const replayDigest = (adventure: OpenAdventure): string =>
  digest(applicationFor(adventure).view().state);

export const runDurableAdventureSimulation = async ({
  injectRepositoryFailureAtTurn,
}: {
  readonly injectRepositoryFailureAtTurn?: number;
} = {}): Promise<AdventureSimulationReport> => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-simulation-"));
  let repository = createLocalAdventureRepository(directory);
  let adventure = createFixedAdventure(repository);
  let app = applicationFor(adventure);
  const commands: Array<AdventureSimulationReport["commands"][number]> = [];
  const events: Array<AdventureSimulationReport["events"][number]> = [];
  const projections: Array<AdventureSimulationReport["projections"][number]> =
    [];
  const modelTasks: Array<AdventureSimulationReport["modelTasks"][number]> = [];
  const recoveryActions: Array<
    AdventureSimulationReport["recoveryActions"][number]
  > = [];
  const randomStream: number[] = [];
  let replayDivergence = 0;
  let firstReplayDivergenceTurn: number | null = null;
  let firstDuplicateEventTurn: number | null = null;
  let accepted = 0;
  let currentTurn = 0;
  let currentLayer: NonNullable<AdventureSimulationReport["failure"]>["layer"] =
    "controller";
  let controllerFailure: AdventureSimulationReport["failure"] = null;

  try {
    try {
      advanceToSimulationPosition(app);
      const branchPosition = app.view().timeline!.activeTimeline.eventCount;

      for (let turn = 1; turn <= 100; turn += 1) {
        currentTurn = turn;
        currentLayer = "event";
        if (app.view().timeline!.activeTimeline.eventCount > branchPosition) {
          accept(app, {
            type: "branch-timeline",
            eventPosition: branchPosition,
          });
        }
        if (
          app.view().state.activeScene !== "vestibule" ||
          app.view().state.pendingCheckProposal !== null ||
          app.view().state.pendingChoice !== null
        ) {
          throw new Error(
            `Turn ${turn} did not restore the simulation position: ${JSON.stringify(normalize(app.view().state))}`,
          );
        }
        const eventsBefore = adventure.timelineStore.readAll().length;
        const mode = SCENARIOS[turn % SCENARIOS.length]!;
        let command = "choose-action:open-vestibule-door";
        let status: "accepted" | "recovered" = "accepted";

        if (mode === "structured-invalid-command") {
          currentLayer = "event";
          const invalid = app.submit({
            type: "choose-action",
            actionId: "invent-an-unavailable-action",
          });
          if (
            invalid.status !== "rejected" ||
            invalid.code !== "action-unavailable"
          ) {
            throw new Error(
              "Invalid simulated command was not safely rejected.",
            );
          }
          chooseAndFinish(app);
          recoveryActions.push({ turn, kind: "invalid-command-retry" });
          command = "structured-play:invalid-command";
          status = "recovered";
        } else if (mode === "natural-language-paraphrase") {
          currentLayer = "model";
          const paraphrase = PLAYER_ACTION_PARAPHRASES[Math.floor(turn / 10)]!;
          await naturalLanguageTurn({
            adventure,
            answers: [paraphrase, "c", "d"],
            interpreter: playerActionInterpreter(),
          });
          app = applicationFor(adventure);
          command = `natural-language:${paraphrase}`;
          modelTasks.push({ turn, outcome: "accepted" });
        } else if (mode === "rules-query") {
          currentLayer = "model";
          await naturalLanguageTurn({
            adventure,
            answers: ["Which Check rule applies here?"],
            interpreter: {
              interpret: async () => ({
                status: "interpreted",
                classification: "rules-query",
                referencedEntityIds: ["scene:vestibule"],
              }),
            },
          });
          app = applicationFor(adventure);
          command = "natural-language:rules-query";
          modelTasks.push({ turn, outcome: "accepted" });
        } else if (mode === "table-chat") {
          currentLayer = "model";
          await naturalLanguageTurn({
            adventure,
            answers: [SENSITIVE_TABLE_CHAT],
            interpreter: {
              interpret: async () => ({
                status: "interpreted",
                classification: "table-chat",
                referencedEntityIds: [],
              }),
            },
          });
          app = applicationFor(adventure);
          command = "natural-language:table-chat";
          modelTasks.push({ turn, outcome: "accepted" });
        } else if (mode === "pending-choice") {
          currentLayer = "event";
          accept(app, {
            type: "choose-action",
            actionId: "open-vestibule-door",
          });
          const proposal = app.view().state.pendingCheckProposal!;
          accept(app, {
            type: "confirm-check-proposal",
            proposalId: proposal.id,
          });
          const choice = app.view().state.pendingChoice!;
          accept(app, {
            type: "resolve-pending-check",
            pendingChoiceId: choice.id,
            choice: "decline",
          });
          command = "structured-play:pending-choice";
        } else if (mode === "model-cancellation") {
          currentLayer = "model";
          await naturalLanguageTurn({
            adventure,
            answers: ["Open the door"],
            interpreter: {
              interpret: async () => {
                const cancelled = new Error("model task cancelled");
                cancelled.name = "AbortError";
                throw cancelled;
              },
            },
          });
          app = applicationFor(adventure);
          modelTasks.push({ turn, outcome: "cancelled" });
          recoveryActions.push({ turn, kind: "model-cancellation" });
          currentLayer = "event";
          accept(app, {
            type: "choose-action",
            actionId: "open-vestibule-door",
          });
          const proposal = app.view().state.pendingCheckProposal!;
          accept(app, {
            type: "confirm-check-proposal",
            proposalId: proposal.id,
          });
          accept(app, {
            type: "branch-timeline",
            eventPosition: branchPosition,
          });
          recoveryActions.push({ turn, kind: "cancelled-pending-choice" });
          command = "game-master-checkpoint:cancel-pending-choice";
          status = "recovered";
        } else if (mode === "model-timeout") {
          currentLayer = "model";
          app = await observeModelFailure({
            adventure,
            interpreter: { interpret: () => new Promise(() => undefined) },
            timeoutMs: 1,
          });
          currentLayer = "event";
          chooseAndFinish(app);
          modelTasks.push({ turn, outcome: "timeout" });
          recoveryActions.push({ turn, kind: "structured-play-fallback" });
          command = "model-task:timeout";
          status = "recovered";
        } else if (mode === "malformed-model-output") {
          currentLayer = "model";
          app = await observeModelFailure({
            adventure,
            interpreter: { interpret: async () => ({ malformed: true }) },
          });
          currentLayer = "event";
          chooseAndFinish(app);
          modelTasks.push({ turn, outcome: "malformed" });
          recoveryActions.push({ turn, kind: "structured-play-fallback" });
          command = "model-task:malformed-output";
          status = "recovered";
        } else if (mode === "model-failure") {
          currentLayer = "model";
          app = await observeModelFailure({
            adventure,
            interpreter: {
              interpret: async () => {
                throw new Error("provider unavailable");
              },
            },
          });
          currentLayer = "event";
          chooseAndFinish(app);
          modelTasks.push({ turn, outcome: "failed" });
          recoveryActions.push({ turn, kind: "structured-play-fallback" });
          command = "model-task:provider-failure";
          status = "recovered";
        } else {
          currentLayer = "repository";
          const staleAdventure = repository.open(ADVENTURE_ID);
          const staleApp = applicationFor(staleAdventure);
          currentLayer = "event";
          accept(app, {
            type: "choose-action",
            actionId: "open-vestibule-door",
          });
          const staleResult = staleApp.submit({
            type: "choose-action",
            actionId: "open-vestibule-door",
          });
          if (
            staleResult.status !== "rejected" ||
            staleResult.code !== "write-conflict"
          ) {
            throw new Error("Injected stale write was not safely rejected.");
          }
          if (injectRepositoryFailureAtTurn === turn) {
            currentLayer = "repository";
            staleAdventure.close();
            staleAdventure.timelineStore.readAll();
          }
          currentLayer = "repository";
          staleAdventure.close();
          currentLayer = "event";
          finishCheck(app);
          recoveryActions.push({ turn, kind: "stale-write-retry" });
          currentLayer = "repository";
          adventure.close();
          repository = createLocalAdventureRepository(directory);
          adventure = repository.open(ADVENTURE_ID);
          app = applicationFor(adventure);
          recoveryActions.push({ turn, kind: "repository-restart" });
          command = "controller:stale-write-and-restart";
          status = "recovered";
        }

        currentLayer = "event";
        const newEvents = adventure.timelineStore.readAll().slice(eventsBefore);
        for (const event of newEvents) {
          events.push({ turn, type: event.type, sequence: event.sequence });
          if (event.type === "CheckRollRevealed") {
            randomStream.push(
              ...event.payload.pendingChoice.roll.random.inputs,
            );
          } else if (event.type === "OracleAnswered") {
            randomStream.push(...event.payload.trace.random.inputs);
          }
        }
        commands.push({ turn, mode, command, status });
        currentLayer = "projection";
        projections.push({ turn, digest: digest(app.view().state) });
        if (replayDigest(adventure) !== digest(app.view().state)) {
          replayDivergence += 1;
          firstReplayDivergenceTurn ??= turn;
        }
        const activeEventIds = adventure.timelineStore
          .readAll()
          .map(({ id }) => id);
        if (activeEventIds.length !== new Set(activeEventIds).size) {
          firstDuplicateEventTurn ??= turn;
        }
        accepted += 1;
      }
    } catch (error) {
      controllerFailure = {
        turn: currentTurn,
        layer: currentLayer,
        message:
          error instanceof Error
            ? error.message
            : "Unknown controller failure.",
      };
    }

    const timelines = adventure.timelineStore.view().timelines;
    let duplicateEvents = 0;
    for (const timeline of timelines) {
      const ids = adventure.timelineStore
        .readTimeline(timeline.id)
        .map(({ id }) => id);
      duplicateEvents += ids.length - new Set(ids).size;
    }
    const archive = repository.exportArchive(ADVENTURE_ID);
    const unauthorizedLeakage = archive.includes(SENSITIVE_TABLE_CHAT) ? 1 : 0;
    const invariants = {
      replayDivergence,
      duplicateEvents,
      unauthorizedLeakage,
    };
    const invariantFailures: NonNullable<
      AdventureSimulationReport["failure"]
    >[] = [];
    if (replayDivergence !== 0) {
      invariantFailures.push({
        turn: firstReplayDivergenceTurn ?? 1,
        layer: "projection",
        message: `replayDivergence was ${replayDivergence}.`,
      });
    }
    if (duplicateEvents !== 0) {
      invariantFailures.push({
        turn: firstDuplicateEventTurn ?? 1,
        layer: "event",
        message: `duplicateEvents was ${duplicateEvents}.`,
      });
    }
    if (unauthorizedLeakage !== 0) {
      invariantFailures.push({
        turn: commands.find(({ mode }) => mode === "table-chat")?.turn ?? 1,
        layer: "visibility",
        message: `unauthorizedLeakage was ${unauthorizedLeakage}.`,
      });
    }
    const invariantFailure =
      invariantFailures.sort((left, right) => left.turn - right.turn)[0] ??
      null;
    const failure = controllerFailure ?? invariantFailure;
    return immutableSnapshot({
      simulationId: SIMULATION_ID,
      status:
        failure === null && accepted === 100
          ? ("passed" as const)
          : ("failed" as const),
      turns: { attempted: 100, accepted },
      randomStream,
      commands,
      events,
      projections,
      modelTasks,
      recoveryActions,
      timelineCount: timelines.length,
      invariants,
      failure,
    });
  } finally {
    try {
      adventure.close();
    } catch {
      /* already closed during a failed restart */
    }
    rmSync(directory, { recursive: true, force: true });
  }
};
