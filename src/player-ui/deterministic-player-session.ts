import {
  assembleInterpretationEvidence,
  type EvidenceBundle,
} from "../evidence-bundle.js";
import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  DEFAULT_PLAYER_ACTOR_SCOPE,
} from "../structured-play.js";
import type {
  PlayerCommand,
  PlayerCommandResponse,
  PlayerLedgerEntry,
} from "./application-client.js";
import { playerLedgerEntryFor } from "./player-ledger.js";
import { projectPlayerAdventure } from "./player-projection.js";

export const createDeterministicPlayerSession = (
  adventureId = "locked-manor",
) => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(1),
  });
  const ledger: PlayerLedgerEntry[] = [];
  let pendingActionLabel = "Authored action";
  let pendingEvidence: EvidenceBundle | null = null;

  const projection = () => projectPlayerAdventure({ adventureId, app, ledger });
  const interpretationEvidence = (utterance: string): EvidenceBundle =>
    assembleInterpretationEvidence({
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      utterance,
      view: app.view(),
      acceptedEvents: eventStore.readAll(),
    });

  const submit = (command: PlayerCommand): PlayerCommandResponse => {
    if (command.type === "choose-action") {
      const action = app
        .view()
        .availableActions.find((candidate) => candidate.id === command.actionId);
      pendingActionLabel = action?.label ?? "Authored action";
      pendingEvidence = interpretationEvidence(pendingActionLabel);
    }
    const fallbackEvidence = pendingEvidence ?? interpretationEvidence(command.type);
    const result = app.submit(command);
    if (result.status === "accepted") {
      const entry = playerLedgerEntryFor({
        result,
        actionLabel: pendingActionLabel,
        fallbackEvidence,
        acceptedEvents: eventStore.readAll(),
      });
      if (entry !== null) ledger.push(entry);
      if (
        result.state.pendingCheckProposal === null &&
        result.state.pendingChoice === null &&
        result.state.pendingNarratorRecommendation === null
      ) {
        pendingEvidence = null;
      }
    }
    return {
      status: result.status,
      message: result.message,
      projection: projection(),
    };
  };

  return { projection, submit };
};
