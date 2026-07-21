import type { GameMasterApplicationClient } from "./application-client.js";
import type {
  GameMasterInterventionResult,
  GameMasterOutcomeTrace,
  GameMasterWorkspace,
} from "./deterministic-game-master-session.js";

const campaignPath = (campaignId: string): string =>
  `/api/gm/campaigns/${encodeURIComponent(campaignId)}`;

const readJson = async <Value>(response: Response): Promise<Value> => {
  if (!response.ok) {
    throw new Error("The local Game Master workspace is unavailable. Try again.");
  }
  return (await response.json()) as Value;
};

export const createHttpGameMasterApplicationClient = (
  fetcher: typeof fetch = fetch,
): GameMasterApplicationClient => ({
  async readWorkspace(campaignId) {
    return readJson<GameMasterWorkspace>(
      await fetcher(`${campaignPath(campaignId)}/workspace`, {
        headers: { Accept: "application/json" },
      }),
    );
  },
  async readOutcomeTrace(campaignId, outcomeId) {
    return readJson<GameMasterOutcomeTrace>(
      await fetcher(
        `${campaignPath(campaignId)}/outcomes/${encodeURIComponent(outcomeId)}/trace`,
        { headers: { Accept: "application/json" } },
      ),
    );
  },
  async intervene(campaignId, intervention) {
    return readJson<GameMasterInterventionResult>(
      await fetcher(`${campaignPath(campaignId)}/interventions`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(intervention),
      }),
    );
  },
  async retryNarration(campaignId, outcomeId) {
    return readJson(
      await fetcher(
        `${campaignPath(campaignId)}/outcomes/${encodeURIComponent(outcomeId)}/retry-narration`,
        { method: "POST", headers: { Accept: "application/json" } },
      ),
    );
  },
});
