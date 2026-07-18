import { randomUUID } from "node:crypto";

export type Trait = "Might" | "Wits" | "Presence";

export type TraitRatings = Readonly<Record<Trait, 0 | 1 | 2>>;

export interface PlayerCharacter {
  readonly name: string;
  readonly pronouns: string;
  readonly motivation: string;
  readonly traits: TraitRatings;
  readonly health: 3;
  readonly resolve: 3;
  readonly inventory: readonly [
    "Lantern",
    "Lockpick Set",
    "Short Blade",
    "Field Kit",
  ];
}

export interface GameState {
  readonly playerCharacter: PlayerCharacter | null;
  readonly activeScene: null;
  readonly establishedFacts: readonly string[];
}

export interface CanonicalEvent {
  readonly id: string;
  readonly streamId: "adventure";
  readonly sequence: number;
  readonly type: "PlayerCharacterConfigured";
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly origin: "structured-play";
  readonly correlationId: string;
  readonly causationId: string;
  readonly payload: PlayerCharacter;
}

export interface ConfigurePlayerCharacter {
  readonly type: "configure-player-character";
  readonly name: string;
  readonly pronouns: string;
  readonly motivation: string;
  readonly traits: TraitRatings;
}

export interface AcceptedResult {
  readonly status: "accepted";
  readonly message: string;
  readonly state: GameState;
  readonly appendedEvents: readonly CanonicalEvent[];
}

export interface RejectedResult {
  readonly status: "rejected";
  readonly code: "invalid-identity" | "invalid-trait-assignment";
  readonly message: string;
  readonly state: GameState;
  readonly appendedEvents: readonly [];
}

export interface StructuredPlayApplication {
  submit(input: ConfigurePlayerCharacter): AcceptedResult | RejectedResult;
}

const STARTING_INVENTORY = [
  "Lantern",
  "Lockpick Set",
  "Short Blade",
  "Field Kit",
] as const;

const initialState = (): GameState => ({
  playerCharacter: null,
  activeScene: null,
  establishedFacts: [],
});

const project = (events: readonly CanonicalEvent[]): GameState =>
  events.reduce<GameState>(
    (state, event) => ({
      ...state,
      playerCharacter: event.payload,
    }),
    initialState(),
  );

export const createStructuredPlayApplication = (): StructuredPlayApplication => {
  const events: CanonicalEvent[] = [];

  return {
    submit(input) {
      if (
        input.name.trim() === "" ||
        input.pronouns.trim() === "" ||
        input.motivation.trim() === ""
      ) {
        return {
          status: "rejected",
          code: "invalid-identity",
          message: "Name, pronouns, and Motivation are required.",
          state: project(events),
          appendedEvents: [],
        };
      }

      const assignedRatings = Object.values(input.traits).sort(
        (left, right) => left - right,
      );
      if (
        assignedRatings.length !== 3 ||
        assignedRatings[0] !== 0 ||
        assignedRatings[1] !== 1 ||
        assignedRatings[2] !== 2
      ) {
        return {
          status: "rejected",
          code: "invalid-trait-assignment",
          message: "Assign +0, +1, and +2 exactly once among the three Traits.",
          state: project(events),
          appendedEvents: [],
        };
      }

      const playerCharacter: PlayerCharacter = {
        name: input.name,
        pronouns: input.pronouns,
        motivation: input.motivation,
        traits: input.traits,
        health: 3,
        resolve: 3,
        inventory: STARTING_INVENTORY,
      };
      const eventId = randomUUID();
      const event: CanonicalEvent = {
        id: eventId,
        streamId: "adventure",
        sequence: events.length + 1,
        type: "PlayerCharacterConfigured",
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        origin: "structured-play",
        correlationId: eventId,
        causationId: eventId,
        payload: playerCharacter,
      };

      events.push(event);

      return {
        status: "accepted",
        message: `${playerCharacter.name} is ready for the Adventure.`,
        state: project(events),
        appendedEvents: [event],
      };
    },
  };
};
