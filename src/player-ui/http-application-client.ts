import type {
  ApplicationClient,
  PlayerAdventureProjection,
  PlayerCommand,
  PlayerCommandResponse,
} from "./application-client.js";

const adventurePath = (adventureId: string): string =>
  `/api/player/adventures/${encodeURIComponent(adventureId)}`;

const readJson = async <Value>(response: Response): Promise<Value> => {
  if (!response.ok) {
    throw new Error("The local Player Interface is unavailable. Try again.");
  }
  return (await response.json()) as Value;
};

export const createHttpApplicationClient = (): ApplicationClient => ({
  async readPlayerAdventure(adventureId) {
    return readJson<PlayerAdventureProjection>(
      await fetch(adventurePath(adventureId), {
        headers: { Accept: "application/json" },
      }),
    );
  },
  async submitPlayerCommand(adventureId, command: PlayerCommand) {
    return readJson<PlayerCommandResponse>(
      await fetch(`${adventurePath(adventureId)}/commands`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      }),
    );
  },
});
