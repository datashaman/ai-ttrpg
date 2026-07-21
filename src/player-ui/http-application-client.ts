import type {
  ApplicationClient,
  PlayerAdventureProjection,
  PlayerCommand,
  PlayerCommandResponse,
} from "./application-client.js";
import type { PlayerPresentationEvent } from "./player-presentation.js";
import { createHttpGameMasterApplicationClient } from "../gm-ui/http-application-client.js";

const adventurePath = (adventureId: string): string =>
  `/api/player/adventures/${encodeURIComponent(adventureId)}`;

const timelinePath = (
  adventureId: string,
  actor: "Player" | "Game Master",
): string => actor === "Game Master"
  ? `/api/gm/campaigns/${encodeURIComponent(adventureId)}/timelines`
  : `${adventurePath(adventureId)}/timelines`;

const readJson = async <Value>(response: Response): Promise<Value> => {
  if (!response.ok) {
    throw new Error("The local Player Interface is unavailable. Try again.");
  }
  return (await response.json()) as Value;
};

const presentationPath = (adventureId: string, outcomeEventId: string): string =>
  `${adventurePath(adventureId)}/presentations/${encodeURIComponent(outcomeEventId)}/stream`;

const streamEvents = async function* (
  response: Response,
  expectedCorrelationId: string,
): AsyncGenerator<PlayerPresentationEvent> {
  if (!response.ok || response.body === null) {
    throw new Error("Narration is unavailable. The committed outcome is safe.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamId: string | null = null;
  let correlationId: string | null = null;
  let expectedSequence = 0;
  let terminal = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data !== "") {
          const event = JSON.parse(data) as PlayerPresentationEvent;
          if (
            terminal ||
            typeof event !== "object" ||
            event === null ||
            typeof event.streamId !== "string" ||
            typeof event.correlationId !== "string" ||
            event.correlationId !== expectedCorrelationId ||
            event.sequence !== expectedSequence ||
            (streamId !== null && event.streamId !== streamId) ||
            (correlationId !== null && event.correlationId !== correlationId) ||
            !["segment", "completed", "failed"].includes(event.type)
          ) {
            throw new Error(
              "Narration stream was malformed. The committed outcome is safe.",
            );
          }
          streamId ??= event.streamId;
          correlationId ??= event.correlationId;
          expectedSequence += 1;
          terminal = event.type === "completed" || event.type === "failed";
          yield event;
        }
      }
      if (done) break;
    }
    if (!terminal) {
      throw new Error(
        "Narration stream disconnected before completion. The committed outcome is safe.",
      );
    }
  } finally {
    reader.releaseLock();
  }
};

export const createHttpApplicationClient = (
  fetcher: typeof fetch = fetch,
): ApplicationClient => ({
  ...createHttpGameMasterApplicationClient(fetcher),
  async readPlayerAdventure(adventureId) {
    return readJson<PlayerAdventureProjection>(
      await fetcher(adventurePath(adventureId), {
        headers: { Accept: "application/json" },
      }),
    );
  },
  async readPlayerPresentations(adventureId) {
    return readJson(
      await fetcher(`${adventurePath(adventureId)}/presentations`, {
        headers: { Accept: "application/json" },
      }),
    );
  },
  async submitPlayerCommand(adventureId, command: PlayerCommand) {
    return readJson<PlayerCommandResponse>(
      await fetcher(`${adventurePath(adventureId)}/commands`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      }),
    );
  },
  streamPlayerPresentation(adventureId, outcomeEventId, options = {}) {
    const query = options.regenerate ? "?regenerate=true" : "";
    return {
      async *[Symbol.asyncIterator]() {
        yield* streamEvents(
          await fetcher(`${presentationPath(adventureId, outcomeEventId)}${query}`, {
            headers: { Accept: "text/event-stream" },
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          }),
          outcomeEventId,
        );
      },
    };
  },
  async readTimelineWorkspace(adventureId, actor, compareWith) {
    const query = compareWith === undefined
      ? ""
      : `?compareWith=${encodeURIComponent(compareWith)}`;
    return readJson(await fetcher(`${timelinePath(adventureId, actor)}${query}`, {
      headers: { Accept: "application/json" },
    }));
  },
  async branchTimeline(adventureId, actor, eventPosition) {
    return readJson(await fetcher(`${timelinePath(adventureId, actor)}/branches`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ eventPosition }),
    }));
  },
  async selectTimeline(adventureId, actor, timelineId, compareWith) {
    return readJson(await fetcher(`${timelinePath(adventureId, actor)}/selection`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        timelineId,
        ...(compareWith === undefined ? {} : { compareWith }),
      }),
    }));
  },
});
