import { randomUUID } from "node:crypto";

export type Trait = "Might" | "Wits" | "Presence";

export type TraitRatings = Readonly<Record<Trait, 0 | 1 | 2>>;

export interface EstablishedFact {
  readonly id: "fresh-footprints";
  readonly text: string;
}

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
  readonly activeScene: "arrival" | null;
  readonly establishedFacts: readonly EstablishedFact[];
}

interface EventEnvelope<EventType extends string, Payload> {
  readonly id: string;
  readonly streamId: "adventure";
  readonly sequence: number;
  readonly type: EventType;
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly origin: "structured-play";
  readonly correlationId: string;
  readonly causationId: string;
  readonly payload: Payload;
}

export type CanonicalEvent =
  | EventEnvelope<"PlayerCharacterConfigured", PlayerCharacter>
  | EventEnvelope<"SceneStarted", { readonly scene: "arrival" }>
  | EventEnvelope<
      "FreeActionCompleted",
      {
        readonly actionId: "survey-manor";
        readonly establishedFact: EstablishedFact;
      }
    >;

export interface ConfigurePlayerCharacter {
  readonly type: "configure-player-character";
  readonly name: string;
  readonly pronouns: string;
  readonly motivation: string;
  readonly traits: TraitRatings;
}

export interface BeginAdventure {
  readonly type: "begin-adventure";
}

export interface ChooseAction {
  readonly type: "choose-action";
  readonly actionId: "survey-manor";
}

export type StructuredPlayInput =
  | ConfigurePlayerCharacter
  | BeginAdventure
  | ChooseAction;

export interface AvailableAction {
  readonly id: "survey-manor";
  readonly label: "Survey the manor grounds";
  readonly kind: "Free Action";
}

export interface AcceptedResult {
  readonly status: "accepted";
  readonly message: string;
  readonly state: GameState;
  readonly availableActions: readonly AvailableAction[];
  readonly appendedEvents: readonly CanonicalEvent[];
}

export interface RejectedResult {
  readonly status: "rejected";
  readonly code:
    | "invalid-identity"
    | "invalid-trait-assignment"
    | "action-unavailable"
    | "player-character-already-configured"
    | "player-character-required";
  readonly message: string;
  readonly state: GameState;
  readonly availableActions: readonly AvailableAction[];
  readonly appendedEvents: readonly [];
}

export interface ApplicationView {
  readonly state: GameState;
  readonly availableActions: readonly AvailableAction[];
}

export interface EventStore {
  readAll(): readonly CanonicalEvent[];
  append(event: CanonicalEvent): void;
}

export interface StructuredPlayApplication {
  submit(input: StructuredPlayInput): AcceptedResult | RejectedResult;
  view(): ApplicationView;
}

export interface StructuredPlayOptions {
  readonly eventStore?: EventStore;
}

const STARTING_INVENTORY = [
  "Lantern",
  "Lockpick Set",
  "Short Blade",
  "Field Kit",
] as const;

const FRESH_FOOTPRINTS: EstablishedFact = {
  id: "fresh-footprints",
  text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
};

const initialState = (): GameState => ({
  playerCharacter: null,
  activeScene: null,
  establishedFacts: [],
});

const availableActionsFor = (
  state: GameState,
): readonly AvailableAction[] =>
  state.activeScene === "arrival" &&
  !state.establishedFacts.some((fact) => fact.id === FRESH_FOOTPRINTS.id)
    ? [
        {
          id: "survey-manor",
          label: "Survey the manor grounds",
          kind: "Free Action",
        },
      ]
    : [];

const project = (events: readonly CanonicalEvent[]): GameState =>
  events.reduce<GameState>(
    (state, event) => {
      switch (event.type) {
        case "PlayerCharacterConfigured":
          return { ...state, playerCharacter: event.payload };
        case "SceneStarted":
          return { ...state, activeScene: event.payload.scene };
        case "FreeActionCompleted":
          return {
            ...state,
            establishedFacts: [
              ...state.establishedFacts,
              event.payload.establishedFact,
            ],
          };
      }
    },
    initialState(),
  );

const createEvent = <EventType extends CanonicalEvent["type"], Payload>(
  type: EventType,
  payload: Payload,
  sequence: number,
  commandId: string,
): EventEnvelope<EventType, Payload> => ({
  id: randomUUID(),
  streamId: "adventure",
  sequence,
  type,
  schemaVersion: 1,
  timestamp: new Date().toISOString(),
  origin: "structured-play",
  correlationId: commandId,
  causationId: commandId,
  payload,
});

export const createInMemoryEventStore = (): EventStore => {
  const events: CanonicalEvent[] = [];

  return {
    readAll: () => [...events],
    append: (event) => {
      events.push(event);
    },
  };
};

export const createStructuredPlayApplication = (
  options: StructuredPlayOptions = {},
): StructuredPlayApplication => {
  const eventStore = options.eventStore ?? createInMemoryEventStore();

  return {
    view() {
      const state = project(eventStore.readAll());
      return {
        state,
        availableActions: availableActionsFor(state),
      };
    },
    submit(input) {
      const events = eventStore.readAll();
      const commandId = randomUUID();
      if (input.type === "choose-action") {
        const state = project(events);
        const actionIsAvailable = availableActionsFor(state).some(
          (action) => action.id === input.actionId,
        );
        if (!actionIsAvailable) {
          return {
            status: "rejected",
            code: "action-unavailable",
            message: "That action is not available in the current Scene.",
            state,
            availableActions: availableActionsFor(state),
            appendedEvents: [],
          };
        }

        const event: CanonicalEvent = createEvent(
          "FreeActionCompleted",
          {
            actionId: input.actionId,
            establishedFact: FRESH_FOOTPRINTS,
          },
          events.length + 1,
          commandId,
        );
        eventStore.append(event);
        const nextState = project(eventStore.readAll());

        return {
          status: "accepted",
          message: FRESH_FOOTPRINTS.text,
          state: nextState,
          availableActions: availableActionsFor(nextState),
          appendedEvents: [event],
        };
      }

      if (input.type === "begin-adventure") {
        const state = project(events);
        if (state.playerCharacter === null) {
          return {
            status: "rejected",
            code: "player-character-required",
            message: "Configure the Player Character before beginning.",
            state,
            availableActions: availableActionsFor(state),
            appendedEvents: [],
          };
        }

        const event: CanonicalEvent = createEvent(
          "SceneStarted",
          { scene: "arrival" as const },
          events.length + 1,
          commandId,
        );
        eventStore.append(event);
        const nextState = project(eventStore.readAll());

        return {
          status: "accepted",
          message: "The Adventure begins at the locked manor.",
          state: nextState,
          availableActions: availableActionsFor(nextState),
          appendedEvents: [event],
        };
      }

      const state = project(events);
      if (state.playerCharacter !== null) {
        return {
          status: "rejected",
          code: "player-character-already-configured",
          message: "The Player Character is already configured.",
          state,
          availableActions: availableActionsFor(state),
          appendedEvents: [],
        };
      }

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
          availableActions: [],
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
          availableActions: [],
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
      const event: CanonicalEvent = createEvent(
        "PlayerCharacterConfigured",
        playerCharacter,
        events.length + 1,
        commandId,
      );

      eventStore.append(event);

      return {
        status: "accepted",
        message: `${playerCharacter.name} is ready for the Adventure.`,
        state: project(eventStore.readAll()),
        availableActions: [],
        appendedEvents: [event],
      };
    },
  };
};
