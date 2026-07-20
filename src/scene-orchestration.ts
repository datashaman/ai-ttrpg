import { createHash } from "node:crypto";

import {
  canonicalJson,
  immutableSnapshot,
} from "./model-boundary.js";
import type { ModelTaskEvidenceTrace } from "./expanded-model-tasks.js";
import {
  projectSceneLifecycle,
  type SceneLifecycle,
} from "./scene-lifecycle.js";
import {
  isCommittedSceneOutcome,
  sceneModelInputIsValidated,
  validatesSceneNarration,
  type SceneNarrationRequest,
  type ScenePresentation,
  type ValidatedSceneModelInput,
} from "./scene-presentation.js";
import type {
  ApplicationView,
  CanonicalEvent,
  EventStore,
  Scene,
  StructuredPlayApplication,
  StructuredPlayInput,
} from "./structured-play.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type PlayerWorldKnowledgeActorScope,
} from "./world-knowledge.js";

export {
  SCENE_LIFECYCLE_TRANSITIONS,
  type SceneExit,
  type SceneLifecycle,
  type SceneLifecycleStatus,
} from "./scene-lifecycle.js";
export type {
  SceneNarrationOutput,
  SceneNarrationRequest,
  ScenePresentation,
  ValidatedSceneModelInput,
} from "./scene-presentation.js";

export type SceneActor =
  | { readonly kind: "Player"; readonly playerCharacterId: string }
  | { readonly kind: "Game Master" };

export interface SceneOrchestrationView {
  readonly lifecycle: SceneLifecycle;
  readonly application: ApplicationView;
}

export type SceneOrchestrationErrorCode =
  | "ACTOR_NOT_AUTHORIZED"
  | "GAME_MASTER_REJECTED"
  | "INVALID_CLASSIFIED_INPUT"
  | "INVALID_GAME_MASTER_REVIEW"
  | "IDEMPOTENCY_CONFLICT"
  | "PRESENTATION_NOT_FOUND"
  | "PROPOSAL_NOT_FOUND";

export interface SceneCommandProposal {
  readonly id: string;
  readonly utterance: string;
  readonly candidateCommand: StructuredPlayInput | null;
  readonly evidenceTrace: ModelTaskEvidenceTrace;
  readonly checkpointReason:
    | "requested"
    | "ambiguous-input"
    | "invalid-proposal"
    | "rule-conflict";
}

export interface GameMasterCommandRecord {
  readonly idempotencyKey: string;
  readonly actor: { readonly kind: "Game Master" };
  readonly proposalId: string;
  readonly decision: "approve" | "edit" | "reject" | "override";
  readonly candidateCommand: StructuredPlayInput | null;
  readonly submittedCommand: StructuredPlayInput | null;
  readonly outcome: "accepted" | "rejected";
  readonly eventIds: readonly string[];
}

export type SceneOrchestrationResult =
  | {
      readonly status: "accepted";
      readonly message: string;
      readonly lifecycle: SceneLifecycle;
      readonly committedEvents: readonly CanonicalEvent[];
      readonly presentation: ScenePresentation | null;
    }
  | {
      readonly status: "approval-required";
      readonly message: string;
      readonly lifecycle: SceneLifecycle;
      readonly committedEvents: readonly [];
      readonly presentation: null;
      readonly proposal: SceneCommandProposal;
    }
  | {
      readonly status: "rejected";
      readonly code: SceneOrchestrationErrorCode | string;
      readonly message: string;
      readonly lifecycle: SceneLifecycle;
      readonly committedEvents: readonly [];
      readonly presentation: null;
    };

interface IdempotencyEntry {
  readonly fingerprint: string;
  readonly result: SceneOrchestrationResult;
}

export interface SceneOrchestrationRecordStore {
  read(idempotencyKey: string): IdempotencyEntry | null;
  write(idempotencyKey: string, entry: IdempotencyEntry): void;
  proposal(proposalId: string): SceneCommandProposal | null;
  saveProposal(proposal: SceneCommandProposal): void;
  saveDecision(record: GameMasterCommandRecord): void;
  decisions(): readonly GameMasterCommandRecord[];
  presentation(outcomeEventId: string): SceneNarrationRequest | null;
  savePresentation(
    outcomeEventId: string,
    request: SceneNarrationRequest,
  ): void;
}

export const createInMemorySceneOrchestrationRecordStore =
  (): SceneOrchestrationRecordStore => {
    const entries = new Map<string, IdempotencyEntry>();
    const proposals = new Map<string, SceneCommandProposal>();
    const decisionRecords: GameMasterCommandRecord[] = [];
    const presentations = new Map<string, SceneNarrationRequest>();
    return {
      read: (idempotencyKey) => entries.get(idempotencyKey) ?? null,
      write: (idempotencyKey, entry) => entries.set(idempotencyKey, entry),
      proposal: (proposalId) => proposals.get(proposalId) ?? null,
      saveProposal: (proposal) => proposals.set(proposal.id, proposal),
      saveDecision: (record) => decisionRecords.push(record),
      decisions: () => [...decisionRecords],
      presentation: (outcomeEventId) =>
        presentations.get(outcomeEventId) ?? null,
      savePresentation: (outcomeEventId, request) =>
        presentations.set(outcomeEventId, request),
    };
  };

const fingerprint = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

const playerCommandIsAuthorized = (
  actor: SceneActor,
  command: StructuredPlayInput,
  actorScope: PlayerWorldKnowledgeActorScope,
): boolean =>
  actor.kind === "Player" &&
  actor.playerCharacterId === actorScope.playerCharacterId &&
  command.type !== "review-world-knowledge-reveal";

export interface SceneOrchestrator {
  view(): SceneOrchestrationView;
  submit(input: {
    readonly idempotencyKey: string;
    readonly actor: SceneActor;
    readonly command: StructuredPlayInput;
    readonly presentation?: ValidatedSceneModelInput;
  }): Promise<SceneOrchestrationResult>;
  submitClassifiedInput(input: {
    readonly idempotencyKey: string;
    readonly actor: SceneActor;
    readonly modelInput: ValidatedSceneModelInput;
    readonly requireGameMasterApproval?: boolean;
  }): Promise<SceneOrchestrationResult>;
  review(input: {
    readonly idempotencyKey: string;
    readonly actor: SceneActor;
    readonly proposalId: string;
    readonly decision: "approve" | "edit" | "reject" | "override";
    readonly command?: StructuredPlayInput;
  }): Promise<SceneOrchestrationResult>;
  regeneratePresentation(input: {
    readonly idempotencyKey: string;
    readonly actor: SceneActor;
    readonly outcomeEventId: string;
  }): Promise<SceneOrchestrationResult>;
}

export const createSceneOrchestrator = ({
  scene,
  application,
  eventStore,
  narrate,
  recordStore = createInMemorySceneOrchestrationRecordStore(),
  actorScope = DEFAULT_PLAYER_ACTOR_SCOPE,
}: {
  readonly scene: Scene;
  readonly application: StructuredPlayApplication;
  readonly eventStore: EventStore;
  readonly narrate: (request: SceneNarrationRequest) => Promise<unknown>;
  readonly recordStore?: SceneOrchestrationRecordStore;
  readonly actorScope?: PlayerWorldKnowledgeActorScope;
}): SceneOrchestrator => {
  const lifecycle = (): SceneLifecycle =>
    projectSceneLifecycle({
      scene,
      events: eventStore.readAll(),
      application: application.view(),
    });

  const reject = (
    code: SceneOrchestrationErrorCode | string,
    message: string,
  ): SceneOrchestrationResult => ({
    status: "rejected",
    code,
    message,
    lifecycle: lifecycle(),
    committedEvents: [],
    presentation: null,
  });

  const execute = async ({
    idempotencyKey,
    actor,
    command,
    presentation,
    gameMasterAuthorized = false,
    fingerprintOverride,
  }: {
    readonly idempotencyKey: string;
    readonly actor: SceneActor;
    readonly command: StructuredPlayInput;
    readonly presentation?: ValidatedSceneModelInput;
    readonly gameMasterAuthorized?: boolean;
    readonly fingerprintOverride?: string;
  }): Promise<SceneOrchestrationResult> => {
    const requestFingerprint =
      fingerprintOverride ?? fingerprint({ actor, command, presentation });
    const recorded = recordStore.read(idempotencyKey);
    if (recorded !== null) {
      return recorded.fingerprint === requestFingerprint
        ? recorded.result
        : reject(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key was already used for a different Scene command.",
          );
    }
    if (
      !playerCommandIsAuthorized(actor, command, actorScope) &&
      !(gameMasterAuthorized && actor.kind === "Game Master")
    ) {
      const result = reject(
        "ACTOR_NOT_AUTHORIZED",
        "That actor is not authorized to submit this Scene command.",
      );
      recordStore.write(idempotencyKey, {
        fingerprint: requestFingerprint,
        result,
      });
      return result;
    }
    const applicationResult = application.submit(command);
    if (applicationResult.status === "rejected") {
      const result = reject(applicationResult.code, applicationResult.message);
      recordStore.write(idempotencyKey, {
        fingerprint: requestFingerprint,
        result,
      });
      return result;
    }
    let rendered: ScenePresentation | null = null;
    if (
      presentation !== undefined &&
      sceneModelInputIsValidated(presentation, actorScope) &&
      applicationResult.appendedEvents.some(isCommittedSceneOutcome)
    ) {
      const request = immutableSnapshot({
        ...presentation,
        committedEvents: applicationResult.appendedEvents,
        state: applicationResult.state,
        deterministicSummary: applicationResult.message,
      });
      const outcomeEvent = applicationResult.appendedEvents.find(
        isCommittedSceneOutcome,
      )!;
      recordStore.savePresentation(outcomeEvent.id, request);
      let output: unknown = null;
      try {
        output = await narrate(request);
      } catch {
        // A committed outcome always retains its deterministic presentation.
      }
      rendered = validatesSceneNarration(output, request)
        ? immutableSnapshot({
            source: "model" as const,
            text: output.text,
            evidenceTrace: presentation.modelResult.evidenceTrace,
          })
        : immutableSnapshot({
            source: "deterministic-fallback" as const,
            text: applicationResult.message,
            evidenceTrace: presentation.modelResult.evidenceTrace,
          });
    }
    const result: SceneOrchestrationResult = immutableSnapshot({
      status: "accepted" as const,
      message: applicationResult.message,
      lifecycle: lifecycle(),
      committedEvents: applicationResult.appendedEvents,
      presentation: rendered,
    });
    recordStore.write(idempotencyKey, {
      fingerprint: requestFingerprint,
      result,
    });
    return result;
  };

  return {
    view: () => ({ lifecycle: lifecycle(), application: application.view() }),
    submit: execute,
    submitClassifiedInput: async (input) => {
      const requestFingerprint = fingerprint(input);
      const recorded = recordStore.read(input.idempotencyKey);
      if (recorded !== null) {
        return recorded.fingerprint === requestFingerprint
          ? recorded.result
          : reject(
              "IDEMPOTENCY_CONFLICT",
              "The idempotency key was already used for different classified input.",
            );
      }
      const recordResult = (
        result: SceneOrchestrationResult,
      ): SceneOrchestrationResult => {
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
        return result;
      };
      if (
        input.actor.kind !== "Player" ||
        input.actor.playerCharacterId !== actorScope.playerCharacterId
      ) {
        return recordResult(
          reject(
            "ACTOR_NOT_AUTHORIZED",
            "Only the scoped Player can submit classified Scene input.",
          ),
        );
      }
      if (!sceneModelInputIsValidated(input.modelInput, actorScope)) {
        return recordResult(
          reject(
            "INVALID_CLASSIFIED_INPUT",
            "Classified Scene input must come from the validated actor-scoped Model Task boundary.",
          ),
        );
      }

      const { modelResult, utterance } = input.modelInput;
      const candidateCommand = modelResult.candidateCommand;
      const candidateIsAvailable =
        candidateCommand?.type === "choose-action" &&
        application
          .view()
          .availableActions.some(
            (action) => action.id === candidateCommand.actionId,
          );
      const checkpointReason: SceneCommandProposal["checkpointReason"] | null =
        modelResult.classification === null
          ? "ambiguous-input"
          : modelResult.ruleMatch?.status === "needs-adjudication"
            ? "rule-conflict"
            : modelResult.classification === "rules-query" &&
                modelResult.ruleMatch === null
              ? "rule-conflict"
            : modelResult.classification === "player-action" &&
                (!candidateIsAvailable || candidateCommand === null)
              ? "invalid-proposal"
              : input.requireGameMasterApproval === true
                ? "requested"
                : null;
      if (checkpointReason !== null) {
        const proposal: SceneCommandProposal = immutableSnapshot({
          id: `scene-proposal:${fingerprint({
            utterance,
            candidateCommand,
            evidenceTrace: modelResult.evidenceTrace,
            checkpointReason,
          })}`,
          utterance,
          candidateCommand,
          evidenceTrace: modelResult.evidenceTrace,
          checkpointReason,
        });
        recordStore.saveProposal(proposal);
        return recordResult(
          immutableSnapshot({
            status: "approval-required" as const,
            message: `The classified input requires Game Master review: ${checkpointReason}.`,
            lifecycle: lifecycle(),
            committedEvents: [],
            presentation: null,
            proposal,
          }),
        );
      }
      if (
        modelResult.classification !== "player-action" ||
        candidateCommand === null
      ) {
        return recordResult(
          immutableSnapshot({
            status: "accepted" as const,
            message:
              "The classified input does not authorize a gameplay command.",
            lifecycle: lifecycle(),
            committedEvents: [],
            presentation: null,
          }),
        );
      }
      return execute({
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
        command: candidateCommand,
        fingerprintOverride: requestFingerprint,
      });
    },
    review: async (input) => {
      const requestFingerprint = fingerprint(input);
      const recorded = recordStore.read(input.idempotencyKey);
      if (recorded !== null) {
        return recorded.fingerprint === requestFingerprint
          ? recorded.result
          : reject(
              "IDEMPOTENCY_CONFLICT",
              "The idempotency key was already used for a different Game Master review.",
            );
      }
      if (input.actor.kind !== "Game Master") {
        const result = reject(
          "ACTOR_NOT_AUTHORIZED",
          "Only the Game Master can review a Scene command proposal.",
        );
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
        return result;
      }
      const proposal = recordStore.proposal(input.proposalId);
      if (proposal === null) {
        const result = reject(
          "PROPOSAL_NOT_FOUND",
          "That Scene command proposal is not available for review.",
        );
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
        return result;
      }
      const submittedCommand =
        input.decision === "approve"
          ? proposal.candidateCommand
          : input.decision === "reject"
            ? null
            : input.command ?? null;
      if (
        (input.decision === "approve" && input.command !== undefined) ||
        (input.decision === "approve" && submittedCommand === null) ||
        ((input.decision === "edit" || input.decision === "override") &&
          submittedCommand === null) ||
        (input.decision === "edit" &&
          proposal.candidateCommand !== null &&
          submittedCommand?.type !== proposal.candidateCommand.type)
      ) {
        const result = reject(
          "INVALID_GAME_MASTER_REVIEW",
          "The Game Master review does not match its decision type.",
        );
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
        return result;
      }
      const result =
        input.decision === "reject"
          ? reject(
              "GAME_MASTER_REJECTED",
              "The Game Master rejected the candidate Scene command.",
            )
          : await execute({
              idempotencyKey: input.idempotencyKey,
              actor: input.actor,
              command: submittedCommand!,
              gameMasterAuthorized: true,
            });
      if (input.decision === "reject") {
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
      } else {
        // execute fingerprints the command-shaped request; replace it with the
        // public review fingerprint so exact review retries remain idempotent.
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
      }
      recordStore.saveDecision(
        immutableSnapshot({
          idempotencyKey: input.idempotencyKey,
          actor: input.actor,
          proposalId: proposal.id,
          decision: input.decision,
          candidateCommand: proposal.candidateCommand,
          submittedCommand,
          outcome: result.status === "accepted" ? "accepted" : "rejected",
          eventIds: result.committedEvents.map((event) => event.id),
        }),
      );
      return result;
    },
    regeneratePresentation: async (input) => {
      const requestFingerprint = fingerprint(input);
      const recorded = recordStore.read(input.idempotencyKey);
      if (recorded !== null) {
        return recorded.fingerprint === requestFingerprint
          ? recorded.result
          : reject(
              "IDEMPOTENCY_CONFLICT",
              "The idempotency key was already used for a different presentation request.",
            );
      }
      if (
        input.actor.kind !== "Game Master" &&
        (input.actor.kind !== "Player" ||
          input.actor.playerCharacterId !== actorScope.playerCharacterId)
      ) {
        const result = reject(
          "ACTOR_NOT_AUTHORIZED",
          "That actor cannot regenerate Scene presentation.",
        );
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
        return result;
      }
      const request = recordStore.presentation(input.outcomeEventId);
      if (request === null) {
        const result = reject(
          "PRESENTATION_NOT_FOUND",
          "That committed outcome has no presentation snapshot.",
        );
        recordStore.write(input.idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
        });
        return result;
      }
      let output: unknown = null;
      try {
        output = await narrate(request);
      } catch {
        // Regeneration cannot affect the already committed outcome.
      }
      const presentation: ScenePresentation = validatesSceneNarration(
        output,
        request,
      )
        ? immutableSnapshot({
            source: "model" as const,
            text: output.text,
            evidenceTrace: request.modelResult.evidenceTrace,
          })
        : immutableSnapshot({
            source: "deterministic-fallback" as const,
            text: request.deterministicSummary,
            evidenceTrace: request.modelResult.evidenceTrace,
          });
      const result: SceneOrchestrationResult = immutableSnapshot({
        status: "accepted" as const,
        message: request.deterministicSummary,
        lifecycle: lifecycle(),
        committedEvents: [],
        presentation,
      });
      recordStore.write(input.idempotencyKey, {
        fingerprint: requestFingerprint,
        result,
      });
      return result;
    },
  };
};
