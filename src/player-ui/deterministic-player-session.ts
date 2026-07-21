import { randomUUID } from "node:crypto";

import {
  assembleInterpretationEvidence,
  type EvidenceBundle,
} from "../evidence-bundle.js";
import {
  createInMemoryModelCallRecordStore,
  type ModelCallRecordStore,
  type ModelGateway,
} from "../model-gateway.js";
import type {
  PlayerUiPlayLog,
  PlayerUiPresentationStatus,
} from "../player-ui-play-log.js";
import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type AcceptedResult,
  type RejectedResult,
} from "../structured-play.js";
import type {
  PlayerAdventureCommand,
  PlayerCommand,
  PlayerCommandResponse,
  PlayerEvidenceItem,
  PlayerLedgerEntry,
  PlayerNaturalLanguageProposal,
  PlayerNaturalLanguageResponse,
} from "./application-client.js";
import { playerLedgerEntryFor } from "./player-ledger.js";
import { interpretPlayerNaturalLanguage } from "./player-natural-language.js";
import { projectPlayerAdventure } from "./player-projection.js";
import type {
  PlayerPresentationEvent,
  PlayerPresentationGenerator,
  PlayerPresentationSnapshot,
  PlayerRetainedPresentation,
} from "./player-presentation.js";

export interface DeterministicPlayerSessionOptions {
  readonly sessionToken?: string;
  readonly playLog?: PlayerUiPlayLog;
  readonly onPlayLogError?: (error: unknown) => void;
  readonly modelGateway?: ModelGateway;
  readonly modelCallStore?: ModelCallRecordStore;
  readonly presentationGenerator?: PlayerPresentationGenerator;
}

const playerEvidence = (
  bundles: Awaited<ReturnType<typeof interpretPlayerNaturalLanguage>>["evidenceBundles"],
): readonly PlayerEvidenceItem[] =>
  [...new Map(
    bundles
      .flatMap(({ items }) => items)
      .map((item) => [item.id, item] as const),
  ).values()].map((item) => ({
      id: item.id,
      sourceKind: item.sourceKind,
      sourceReference: item.sourceReference,
      content: item.content,
      inclusionReason: item.inclusionReason,
      citation: item.citation,
    }));

export const createDeterministicPlayerSession = (
  adventureId = "locked-manor",
  options: DeterministicPlayerSessionOptions = {},
) => {
  const eventStore = createInMemoryEventStore();
  const randomSource = createSeededRandomSource(1);
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource,
  });
  const modelCallStore =
    options.modelCallStore ?? createInMemoryModelCallRecordStore();
  const ledger: PlayerLedgerEntry[] = [];
  const presentationSnapshots = new Map<string, PlayerPresentationSnapshot>();
  const retainedPresentations = new Map<string, PlayerRetainedPresentation>();
  let inputMode: "structured" | "natural-language" = "structured";
  let naturalLanguageAvailable = options.modelGateway !== undefined;
  let naturalLanguageProposal: PlayerNaturalLanguageProposal | null = null;
  let naturalLanguageResponse: PlayerNaturalLanguageResponse | null = null;
  let pendingActionLabel = "Authored action";
  let pendingActionMode: PlayerLedgerEntry["inputMode"] = "Structured Play";
  let pendingInterpretation: PlayerLedgerEntry["interpretation"] = null;
  let pendingEvidence: EvidenceBundle | null = null;

  const projection = () =>
    projectPlayerAdventure({
      adventureId,
      app,
      ledger,
      inputMode,
      naturalLanguage: {
        available: naturalLanguageAvailable,
        pendingProposal: naturalLanguageProposal,
        response: naturalLanguageResponse,
      },
    });
  const interpretationEvidence = (utterance: string): EvidenceBundle =>
    assembleInterpretationEvidence({
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      utterance,
      view: app.view(),
      acceptedEvents: eventStore.readAll(),
    });

  const record = ({
    commandType,
    startedAt,
    stateBefore,
    result,
    presentationStatus = "not-requested",
  }: {
    readonly commandType: string;
    readonly startedAt: number;
    readonly stateBefore: ReturnType<typeof app.view>["state"];
    readonly result: AcceptedResult | RejectedResult;
    readonly presentationStatus?: PlayerUiPresentationStatus;
  }): void => {
    if (options.playLog === undefined) return;
    try {
      options.playLog.recordCommand({
        sessionToken: options.sessionToken ?? "local-player-session",
        adventureId,
        commandType,
        status: result.status,
        errorCode: result.status === "rejected" ? result.code : null,
        sceneBefore: stateBefore.activeScene,
        sceneAfter: result.state.activeScene,
        appendedEvents: result.appendedEvents,
        pendingChoiceBefore: stateBefore.pendingChoice !== null,
        pendingChoiceAfter: result.state.pendingChoice !== null,
        presentationStatus,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      options.onPlayLogError?.(error);
    }
  };

  const responseWithoutCanonicalChange = (
    status: PlayerCommandResponse["status"],
    message: string,
  ): PlayerCommandResponse => ({
    status,
    message,
    projection: projection(),
    canonicalCommand: null,
    canonicalEventTypes: [],
    canonicalEvents: [],
  });

  const submitAdventureCommand = (
    command: PlayerAdventureCommand,
    commandType: string = command.type,
  ): PlayerCommandResponse => {
    const startedAt = performance.now();
    const stateBefore = app.view().state;
    if (command.type === "choose-action") {
      const action = app
        .view()
        .availableActions.find((candidate) => candidate.id === command.actionId);
      pendingActionLabel = action?.label ?? "Authored action";
      pendingEvidence = interpretationEvidence(pendingActionLabel);
    }
    const fallbackEvidence =
      pendingEvidence ?? interpretationEvidence(command.type);
    const result = app.submit(command);
    let presentationStatus: PlayerUiPresentationStatus = "not-requested";
    if (result.status === "accepted") {
      const entry = playerLedgerEntryFor({
        result,
        actionLabel: pendingActionLabel,
        fallbackEvidence,
        acceptedEvents: eventStore.readAll(),
        inputMode: pendingActionMode,
        interpretation: pendingInterpretation,
      });
      if (entry !== null) {
        ledger.push(entry);
        const outcome = result.appendedEvents.find(
          (event) => event.id === entry.id,
        );
        const resolutionTrace =
          outcome?.type === "CheckResolved" || outcome?.type === "OracleAnswered"
            ? outcome.payload.trace
            : null;
        presentationSnapshots.set(entry.id, structuredClone({
          outcomeEventId: entry.id,
          deterministicSummary: entry.summary,
          context: {
            deterministicSummary: entry.summary,
            visibleEvidence: result.state.establishedFacts,
            resolutionTrace,
            committedEvents: result.appendedEvents,
          },
          acceptedEvents: eventStore.readAll(),
          state: result.state,
        }));
        presentationStatus = "deterministic-summary";
      }
      if (
        result.state.pendingCheckProposal === null &&
        result.state.pendingChoice === null &&
        result.state.pendingNarratorRecommendation === null
      ) {
        pendingEvidence = null;
        pendingInterpretation = null;
      }
      naturalLanguageProposal = null;
    }
    record({ commandType, startedAt, stateBefore, result, presentationStatus });
    return {
      status: result.status,
      message: result.message,
      projection: projection(),
      canonicalCommand: result.status === "accepted" ? command : null,
      canonicalEventTypes: result.appendedEvents.map(({ type }) => type),
      canonicalEvents: result.appendedEvents.map(({ type, payload }) => ({
        type,
        payload,
      })),
    };
  };

  const submitNaturalLanguage = async (
    utterance: string,
  ): Promise<PlayerCommandResponse> => {
    naturalLanguageProposal = null;
    naturalLanguageResponse = null;
    if (options.modelGateway === undefined) {
      inputMode = "structured";
      naturalLanguageAvailable = false;
      naturalLanguageResponse = {
        kind: "provider-unavailable",
        status: "Unavailable",
        message:
          "Natural Language Play is unavailable. Continue with the current Structured Play choices.",
        modelCallIds: [],
        evidenceBundleIds: [],
        bundleItemIds: [],
        citedEvidenceItemIds: [],
        ruleIds: [],
        evidence: [],
      };
      return responseWithoutCanonicalChange(
        "rejected",
        naturalLanguageResponse.message,
      );
    }
    const recordsBefore = modelCallStore.readAll().length;
    const interpreted = await interpretPlayerNaturalLanguage({
      utterance,
      view: app.view(),
      acceptedEvents: eventStore.readAll(),
      modelGateway: options.modelGateway,
      modelCallStore,
    });
    const {
      result,
      evidenceBundle,
      evidenceBundles,
      citedEvidenceItemIds,
    } = interpreted;
    const trace = {
      modelCallIds: result.evidenceTrace.modelCallIds,
      evidenceBundleIds: result.evidenceTrace.evidenceBundleIds,
      bundleItemIds: result.evidenceTrace.evidenceItemIds,
      citedEvidenceItemIds,
      ruleIds: result.evidenceTrace.ruleIds,
      evidence: playerEvidence(evidenceBundles),
    };
    if (
      result.classification === "player-action" &&
      result.candidateCommand?.type === "choose-action"
    ) {
      const candidateCommand = result.candidateCommand;
      const action = app
        .view()
        .availableActions.find(
          ({ id }) => id === candidateCommand.actionId,
        );
      if (action !== undefined) {
        naturalLanguageProposal = {
          id: randomUUID(),
          utterance,
          actionLabel: action.label,
          command: candidateCommand,
          ...trace,
        };
        return responseWithoutCanonicalChange(
          "accepted",
          `Interpreted as “${action.label}”. Confirm before committing it.`,
        );
      }
    }
    if (result.classification === "rules-query") {
      const ruleMatch = result.ruleMatch;
      const matchedRule =
        ruleMatch?.status === "matched"
          ? evidenceBundle.items.find(({ id }) => id === ruleMatch.ruleId)
          : undefined;
      naturalLanguageResponse = {
        kind: "rules-answer",
        status: "Provisional",
        message:
          matchedRule === undefined
            ? "No single approved rule in the current Evidence Bundle answers that question."
            : matchedRule.content,
        ...trace,
      };
      return responseWithoutCanonicalChange(
        "accepted",
        naturalLanguageResponse.message,
      );
    }
    if (
      result.classification === "in-character-speech" ||
      result.classification === "out-of-character-request" ||
      result.classification === "table-chat" ||
      result.classification === "system-command"
    ) {
      naturalLanguageResponse = {
        kind: "acknowledgement",
        status: "Provisional",
        message: "No gameplay action was proposed or committed.",
        ...trace,
      };
      return responseWithoutCanonicalChange(
        "accepted",
        naturalLanguageResponse.message,
      );
    }
    const newRecords = modelCallStore.readAll().slice(recordsBefore);
    const providerFailed =
      result.classification === null &&
      newRecords.some(
        (entry) =>
          entry.validation.status === "rejected" &&
          /provider|authentication|rate limit|timed out|budget/i.test(
            entry.validation.reason,
          ),
      );
    if (providerFailed) inputMode = "structured";
    naturalLanguageResponse = {
      kind: providerFailed ? "provider-failure" : "clarification",
      status: providerFailed ? "Recoverable error" : "Action required",
      message: providerFailed
        ? "Natural Language Play could not complete. Continue with the current Structured Play choices."
        : "Please clarify your intent or choose one of the current Structured Play choices.",
      ...trace,
    };
    return responseWithoutCanonicalChange(
      "rejected",
      naturalLanguageResponse.message,
    );
  };

  const submit = async (command: PlayerCommand): Promise<PlayerCommandResponse> => {
    if (command.type === "set-input-mode") {
      inputMode = command.mode;
      naturalLanguageResponse = null;
      if (command.mode === "natural-language" && !naturalLanguageAvailable) {
        return submitNaturalLanguage("");
      }
      return responseWithoutCanonicalChange(
        "accepted",
        command.mode === "structured"
          ? "Structured Play selected."
          : "Natural Language Play selected.",
      );
    }
    if (command.type === "submit-natural-language") {
      inputMode = "natural-language";
      return submitNaturalLanguage(command.utterance.trim());
    }
    if (command.type === "confirm-natural-language-command") {
      if (
        naturalLanguageProposal === null ||
        naturalLanguageProposal.id !== command.proposalId
      ) {
        return responseWithoutCanonicalChange(
          "rejected",
          "That interpreted action is no longer available. Interpret it again.",
        );
      }
      const proposal = naturalLanguageProposal;
      pendingActionLabel = proposal.actionLabel;
      pendingActionMode = "Natural Language Play";
      pendingInterpretation = {
        modelCallIds: proposal.modelCallIds,
        evidenceBundleIds: proposal.evidenceBundleIds,
        bundleItemIds: proposal.bundleItemIds,
        citedEvidenceItemIds: proposal.citedEvidenceItemIds,
        ruleIds: proposal.ruleIds,
        evidence: proposal.evidence,
      };
      pendingEvidence = interpretationEvidence(proposal.utterance);
      return submitAdventureCommand(
        proposal.command,
        "confirm-natural-language-command",
      );
    }
    if (command.type === "choose-action") {
      pendingActionMode = "Structured Play";
      pendingInterpretation = null;
    }
    naturalLanguageResponse = null;
    naturalLanguageProposal = null;
    return submitAdventureCommand(command);
  };

  const streamPresentation = async function* (
    outcomeEventId: string,
    { regenerate = false }: { readonly regenerate?: boolean } = {},
  ): AsyncGenerator<PlayerPresentationEvent> {
    const entryIndex = ledger.findIndex(({ id }) => id === outcomeEventId);
    const entry = ledger[entryIndex];
    const snapshot = presentationSnapshots.get(outcomeEventId);
    if (entry === undefined || snapshot === undefined) {
      throw new Error("That committed outcome has no presentation snapshot.");
    }
    const streamId = randomUUID();
    const correlationId = outcomeEventId;
    let sequence = 0;
    const retained = retainedPresentations.get(outcomeEventId);
    if (!regenerate && retained !== undefined) {
      yield {
        type: "completed",
        streamId,
        correlationId,
        sequence,
        presentation: retained,
      };
      return;
    }
    if (options.presentationGenerator === undefined) {
      yield {
        type: "failed",
        streamId,
        correlationId,
        sequence,
        message: "Narration is unavailable. The committed outcome is safe.",
        deterministicSummary: snapshot.deterministicSummary,
      };
      return;
    }
    let text = "";
    const recordsBefore = modelCallStore.readAll().length;
    try {
      for await (const chunk of options.presentationGenerator.generate(
        structuredClone(snapshot),
      )) {
        if (chunk.length === 0) continue;
        text += chunk;
        yield {
          type: "segment",
          streamId,
          correlationId,
          sequence,
          segment: {
            id: `${streamId}:segment:${sequence}`,
            source: "Narrator",
            status: "Provisional",
            text: chunk,
          },
        };
        sequence += 1;
      }
      if (text.trim().length === 0) throw new Error("Empty Narration");
      const narration: PlayerRetainedPresentation = {
        id: `${outcomeEventId}:narration`,
        outcomeEventId,
        source: "Narrator" as const,
        status: "Retained",
        text,
        modelCallIds: modelCallStore
          .readAll()
          .slice(recordsBefore)
          .filter((record) => record.acceptedEventIds.includes(outcomeEventId))
          .map(({ id }) => id),
      };
      retainedPresentations.set(outcomeEventId, narration);
      yield {
        type: "completed",
        streamId,
        correlationId,
        sequence,
        presentation: narration,
      };
    } catch {
      yield {
        type: "failed",
        streamId,
        correlationId,
        sequence,
        message: "Narration was interrupted. The committed outcome is safe.",
        deterministicSummary: snapshot.deterministicSummary,
      };
    }
  };

  const canonicalSnapshot = () => structuredClone({
    events: eventStore.readAll(),
    randomPosition: randomSource.position(),
    state: app.view().state,
    pendingChoice: app.view().state.pendingChoice,
  });

  const presentations = (): readonly PlayerRetainedPresentation[] =>
    structuredClone([...retainedPresentations.values()]);

  return {
    projection,
    presentations,
    submit,
    streamPresentation,
    canonicalSnapshot,
  };
};
