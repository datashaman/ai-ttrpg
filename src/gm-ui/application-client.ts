import type {
  GameMasterIntervention,
  GameMasterInterventionResult,
  GameMasterOutcomeTrace,
  GameMasterWorkspace,
} from "./deterministic-game-master-session.js";

export interface GameMasterApplicationClient {
  readWorkspace(campaignId: string): Promise<GameMasterWorkspace>;
  readOutcomeTrace(
    campaignId: string,
    outcomeId: string,
  ): Promise<GameMasterOutcomeTrace>;
  intervene(
    campaignId: string,
    intervention: GameMasterIntervention,
  ): Promise<GameMasterInterventionResult>;
  retryNarration(
    campaignId: string,
    outcomeId: string,
  ): Promise<{
    readonly status: "Retained" | "Recoverable error";
    readonly message: string;
  }>;
}
