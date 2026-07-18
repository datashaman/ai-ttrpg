import { randomUUID } from "node:crypto";

import { createInMemoryEventStore } from "./in-memory-event-store.js";
import {
  DEFAULT_CHECK_ACTIONS,
  FRESH_FOOTPRINTS,
} from "./locked-manor-content.js";
import {
  createSeededRandomSource,
  type RandomSource,
} from "./random-source.js";

export { createInMemoryEventStore } from "./in-memory-event-store.js";
export { createSeededRandomSource } from "./random-source.js";
export type { RandomSource } from "./random-source.js";

export type Trait = "Might" | "Wits" | "Presence";
export type CheckOutcome = "Setback" | "Success with Cost" | "Clean Success";
export type Health = 0 | 1 | 2 | 3;
export type Resolve = 0 | 1 | 2 | 3;

export type TraitRatings = Readonly<Record<Trait, 0 | 1 | 2>>;

export interface EstablishedFact {
  readonly id: string;
  readonly text: string;
}

export interface PlayerCharacter {
  readonly name: string;
  readonly pronouns: string;
  readonly motivation: string;
  readonly traits: TraitRatings;
  readonly health: Health;
  readonly resolve: Resolve;
  readonly inventory: readonly [
    "Lantern",
    "Lockpick Set",
    "Short Blade",
    "Field Kit",
  ];
}

export interface MechanicalEffect {
  readonly type: "lose-health";
  readonly amount: 1;
}

export interface FictionalConsequence {
  readonly type: "establish-fact";
  readonly fact: EstablishedFact;
}

export type OutcomeConsequence = MechanicalEffect | FictionalConsequence;

export interface CheckStake {
  readonly summary: string;
  readonly consequences: readonly OutcomeConsequence[];
}

export interface CheckStakes {
  readonly Setback: CheckStake;
  readonly "Success with Cost": CheckStake;
  readonly "Clean Success": CheckStake;
}

export interface CheckProposal {
  readonly id: string;
  readonly actionId: string;
  readonly goal: string;
  readonly trait: Trait;
  readonly stakes: CheckStakes;
}

interface CheckRollEvidence {
  readonly rule: {
    readonly id: "micro-ruleset.check";
    readonly version: "1.0.0";
  };
  readonly random: {
    readonly source: string;
    readonly seed: number | null;
    readonly inputs: readonly [number, number];
  };
}

interface TraitModifier {
  readonly source: Trait;
  readonly value: 0 | 1 | 2;
}

interface ResolveModifier {
  readonly source: "Resolve";
  readonly value: 1;
}

export interface RevealedCheckRoll extends CheckRollEvidence {
  readonly modifiers: readonly [TraitModifier];
  readonly result: {
    readonly diceTotal: number;
    readonly total: number;
  };
}

export interface CheckTrace extends CheckRollEvidence {
  readonly modifiers:
    | readonly [TraitModifier]
    | readonly [TraitModifier, ResolveModifier];
  readonly result: {
    readonly diceTotal: number;
    readonly originalTotal: number;
    readonly total: number;
    readonly outcome: CheckOutcome;
  };
}

export interface CheckResolution {
  readonly proposalId: string;
  readonly pendingChoiceId: string;
  readonly goal: string;
  readonly trait: Trait;
  readonly resolveSpent: 0 | 1;
  readonly adjustedTotal: number;
  readonly outcome: CheckOutcome;
  readonly committedStake: CheckStake;
  readonly resultingResolve: Resolve;
  readonly trace: CheckTrace;
}

export type ResolveChoice = "decline" | "spend-resolve";

export interface PendingChoice {
  readonly id: string;
  readonly type: "spend-resolve";
  readonly proposal: CheckProposal;
  readonly roll: RevealedCheckRoll;
  readonly availableChoices: readonly ResolveChoice[];
}

export interface GameState {
  readonly playerCharacter: PlayerCharacter | null;
  readonly activeScene: "arrival" | null;
  readonly establishedFacts: readonly EstablishedFact[];
  readonly pendingCheckProposal: CheckProposal | null;
  readonly pendingChoice: PendingChoice | null;
  readonly lastCheckResolution: CheckResolution | null;
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

interface EventPayloads {
  readonly PlayerCharacterConfigured: PlayerCharacter;
  readonly SceneStarted: { readonly scene: "arrival" };
  readonly FreeActionCompleted: {
    readonly actionId: "survey-manor";
    readonly establishedFact: EstablishedFact;
  };
  readonly CheckProposalCreated: { readonly proposal: CheckProposal };
  readonly CheckProposalReplaced: {
    readonly supersededProposalId: string;
    readonly proposal: CheckProposal;
    readonly reason: "correction" | "revised-action";
  };
  readonly CheckProposalWithdrawn: { readonly proposalId: string };
  readonly CheckRollRevealed: { readonly pendingChoice: PendingChoice };
  readonly CheckResolved: CheckResolution;
}

export type CanonicalEvent = {
  readonly [EventType in keyof EventPayloads]: EventEnvelope<
    EventType,
    EventPayloads[EventType]
  >;
}[keyof EventPayloads];

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
  readonly actionId: string;
}

export interface ConfirmCheckProposal {
  readonly type: "confirm-check-proposal";
  readonly proposalId: string;
}

export interface ResolvePendingCheck {
  readonly type: "resolve-pending-check";
  readonly pendingChoiceId: string;
  readonly choice: ResolveChoice;
}

export interface CorrectCheckProposal {
  readonly type: "correct-check-proposal";
  readonly proposalId: string;
  readonly goal: string;
  readonly trait: Trait;
}

export interface ReviseCheckAction {
  readonly type: "revise-check-action";
  readonly proposalId: string;
  readonly actionId: string;
}

export interface WithdrawCheckProposal {
  readonly type: "withdraw-check-proposal";
  readonly proposalId: string;
}

export interface AmendCheckStakes {
  readonly type: "amend-check-stakes";
  readonly proposalId: string;
  readonly stakes: CheckStakes;
}

export type StructuredPlayInput =
  | ConfigurePlayerCharacter
  | BeginAdventure
  | ChooseAction
  | ConfirmCheckProposal
  | ResolvePendingCheck
  | CorrectCheckProposal
  | ReviseCheckAction
  | WithdrawCheckProposal
  | AmendCheckStakes;

export interface FreeAction {
  readonly id: "survey-manor";
  readonly label: "Survey the manor grounds";
  readonly kind: "Free Action";
}

export interface CheckAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "Check";
}

export type AvailableAction = FreeAction | CheckAction;

export interface CheckActionDefinition extends CheckAction {
  readonly goal: string;
  readonly trait: Trait;
  readonly stakes: CheckStakes;
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
    | "player-character-required"
    | "check-proposal-unavailable"
    | "pending-choice-unavailable"
    | "resolve-unavailable"
    | "invalid-check-correction"
    | "check-stakes-immutable";
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
  readonly randomSource?: RandomSource;
  readonly checkActions?: readonly CheckActionDefinition[];
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
  pendingCheckProposal: null,
  pendingChoice: null,
  lastCheckResolution: null,
});

const isTrait = (value: unknown): value is Trait =>
  value === "Might" || value === "Wits" || value === "Presence";

const validateOutcomeConsequence = (
  consequence: unknown,
): consequence is OutcomeConsequence => {
  if (typeof consequence !== "object" || consequence === null) return false;
  const candidate = consequence as Partial<OutcomeConsequence>;
  if (candidate.type === "lose-health") {
    return (candidate as Partial<MechanicalEffect>).amount === 1;
  }
  if (candidate.type === "establish-fact") {
    const fact = (candidate as Partial<FictionalConsequence>).fact;
    return (
      typeof fact?.id === "string" &&
      fact.id.trim() !== "" &&
      typeof fact.text === "string" &&
      fact.text.trim() !== ""
    );
  }
  return false;
};

const validateCheckAction = (action: CheckActionDefinition): void => {
  if (
    typeof action.id !== "string" ||
    action.id.trim() === "" ||
    typeof action.label !== "string" ||
    action.label.trim() === "" ||
    typeof action.goal !== "string" ||
    action.goal.trim() === "" ||
    !isTrait(action.trait)
  ) {
    throw new Error(`Invalid Check action definition: ${action.id || "<unknown>"}.`);
  }

  const outcomes: readonly CheckOutcome[] = [
    "Setback",
    "Success with Cost",
    "Clean Success",
  ];
  for (const outcome of outcomes) {
    const stake = action.stakes?.[outcome];
    if (
      stake === undefined ||
      typeof stake.summary !== "string" ||
      stake.summary.trim() === "" ||
      !Array.isArray(stake.consequences) ||
      !stake.consequences.every(validateOutcomeConsequence)
    ) {
      throw new Error(
        `Invalid Outcome Consequence or stake for ${action.id} (${outcome}).`,
      );
    }
  }
};

const availableActionsFor = (
  state: GameState,
  checkActions: readonly CheckActionDefinition[],
): readonly AvailableAction[] => {
  if (
    state.activeScene !== "arrival" ||
    state.pendingCheckProposal !== null ||
    state.pendingChoice !== null
  ) {
    return [];
  }

  const actions: AvailableAction[] = [];
  if (!state.establishedFacts.some((fact) => fact.id === FRESH_FOOTPRINTS.id)) {
    actions.push({
      id: "survey-manor",
      label: "Survey the manor grounds",
      kind: "Free Action",
    });
  }
  if (state.lastCheckResolution === null) {
    actions.push(
      ...checkActions.map(({ id, label, kind }) => ({ id, label, kind })),
    );
  }
  return actions;
};

const applyConsequences = (
  state: GameState,
  consequences: readonly OutcomeConsequence[],
): GameState =>
  consequences.reduce<GameState>((nextState, consequence) => {
    if (consequence.type === "establish-fact") {
      return nextState.establishedFacts.some(
        (fact) => fact.id === consequence.fact.id,
      )
        ? nextState
        : {
            ...nextState,
            establishedFacts: [
              ...nextState.establishedFacts,
              consequence.fact,
            ],
          };
    }
    const playerCharacter = nextState.playerCharacter;
    if (playerCharacter === null) return nextState;
    const health = Math.max(0, playerCharacter.health - consequence.amount) as Health;
    return {
      ...nextState,
      playerCharacter: { ...playerCharacter, health },
    };
  }, state);

const project = (events: readonly CanonicalEvent[]): GameState =>
  events.reduce<GameState>((state, event) => {
    switch (event.type) {
      case "PlayerCharacterConfigured":
        return { ...state, playerCharacter: event.payload };
      case "SceneStarted":
        return { ...state, activeScene: event.payload.scene };
      case "FreeActionCompleted":
        return applyConsequences(state, [
          { type: "establish-fact", fact: event.payload.establishedFact },
        ]);
      case "CheckProposalCreated":
        return { ...state, pendingCheckProposal: event.payload.proposal };
      case "CheckProposalReplaced":
        return { ...state, pendingCheckProposal: event.payload.proposal };
      case "CheckProposalWithdrawn":
        return { ...state, pendingCheckProposal: null };
      case "CheckRollRevealed":
        return {
          ...state,
          pendingCheckProposal: null,
          pendingChoice: event.payload.pendingChoice,
        };
      case "CheckResolved":
        const playerCharacter = state.playerCharacter;
        const stateWithResolve =
          playerCharacter === null
            ? state
            : {
                ...state,
                playerCharacter: {
                  ...playerCharacter,
                  resolve: event.payload.resultingResolve,
                },
              };
        return {
          ...applyConsequences(
            stateWithResolve,
            event.payload.committedStake.consequences,
          ),
          pendingCheckProposal: null,
          pendingChoice: null,
          lastCheckResolution: event.payload,
        };
    }
  }, initialState());

const createEvent = <EventType extends keyof EventPayloads>(
  type: EventType,
  payload: EventPayloads[EventType],
  sequence: number,
  commandId: string,
): EventEnvelope<EventType, EventPayloads[EventType]> => ({
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

const createProposal = (definition: CheckActionDefinition): CheckProposal => ({
  id: randomUUID(),
  actionId: definition.id,
  goal: definition.goal,
  trait: definition.trait,
  stakes: definition.stakes,
});

const outcomeFor = (total: number): CheckOutcome =>
  total <= 6 ? "Setback" : total <= 9 ? "Success with Cost" : "Clean Success";

export const createStructuredPlayApplication = (
  options: StructuredPlayOptions = {},
): StructuredPlayApplication => {
  const eventStore = options.eventStore ?? createInMemoryEventStore();
  const randomSource = options.randomSource ?? createSeededRandomSource(Date.now());
  const checkActions = options.checkActions ?? DEFAULT_CHECK_ACTIONS;
  checkActions.forEach(validateCheckAction);

  const view = (): ApplicationView => {
    const state = project(eventStore.readAll());
    return { state, availableActions: availableActionsFor(state, checkActions) };
  };

  const reject = (
    code: RejectedResult["code"],
    message: string,
    state = project(eventStore.readAll()),
  ): RejectedResult => ({
    status: "rejected",
    code,
    message,
    state,
    availableActions: availableActionsFor(state, checkActions),
    appendedEvents: [],
  });

  const append = <EventType extends keyof EventPayloads>(
    type: EventType,
    payload: EventPayloads[EventType],
    commandId: string,
  ): EventEnvelope<EventType, EventPayloads[EventType]> => {
    const event = createEvent(
      type,
      payload,
      eventStore.readAll().length + 1,
      commandId,
    );
    eventStore.append(event as CanonicalEvent);
    return event;
  };

  const accept = (
    message: string,
    appendedEvents: readonly CanonicalEvent[],
  ): AcceptedResult => {
    const state = project(eventStore.readAll());
    return {
      status: "accepted",
      message,
      state,
      availableActions: availableActionsFor(state, checkActions),
      appendedEvents,
    };
  };

  return {
    view,
    submit(input) {
      const events = eventStore.readAll();
      const state = project(events);
      const commandId = randomUUID();

      if (input.type === "resolve-pending-check") {
        const pendingChoice = state.pendingChoice;
        const playerCharacter = state.playerCharacter;
        if (
          pendingChoice?.id !== input.pendingChoiceId ||
          playerCharacter === null
        ) {
          return reject(
            "pending-choice-unavailable",
            "That Pending Choice is no longer available.",
            state,
          );
        }
        if (
          input.choice === "spend-resolve" &&
          (playerCharacter.resolve === 0 ||
            !pendingChoice.availableChoices.includes("spend-resolve"))
        ) {
          return reject(
            "resolve-unavailable",
            "Resolve cannot be spent for this Check.",
            state,
          );
        }

        const resolveSpent = input.choice === "spend-resolve" ? 1 : 0;
        const adjustedTotal = pendingChoice.roll.result.total + resolveSpent;
        const outcome = outcomeFor(adjustedTotal);
        const resultingResolve = (
          playerCharacter.resolve - resolveSpent
        ) as Resolve;
        const resolution: CheckResolution = {
          proposalId: pendingChoice.proposal.id,
          pendingChoiceId: pendingChoice.id,
          goal: pendingChoice.proposal.goal,
          trait: pendingChoice.proposal.trait,
          resolveSpent,
          adjustedTotal,
          outcome,
          committedStake: pendingChoice.proposal.stakes[outcome],
          resultingResolve,
          trace: {
            rule: pendingChoice.roll.rule,
            random: pendingChoice.roll.random,
            modifiers:
              resolveSpent === 1
                ? [
                    ...pendingChoice.roll.modifiers,
                    { source: "Resolve", value: 1 },
                  ]
                : pendingChoice.roll.modifiers,
            result: {
              diceTotal: pendingChoice.roll.result.diceTotal,
              originalTotal: pendingChoice.roll.result.total,
              total: adjustedTotal,
              outcome,
            },
          },
        };
        const event = append("CheckResolved", resolution, commandId);
        return accept(
          `${outcome} (${adjustedTotal}): ${resolution.committedStake.summary}`,
          [event],
        );
      }

      if (input.type === "confirm-check-proposal") {
        const proposal = state.pendingCheckProposal;
        if (proposal?.id !== input.proposalId || state.playerCharacter === null) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        Object.values(proposal.stakes).forEach((stake) => {
          if (!stake.consequences.every(validateOutcomeConsequence)) {
            throw new Error("Invalid Outcome Consequence in confirmed Check Proposal.");
          }
        });

        const inputs = [
          randomSource.rollDie(6),
          randomSource.rollDie(6),
        ] as const;
        const modifier = state.playerCharacter.traits[proposal.trait];
        const diceTotal = inputs[0] + inputs[1];
        const total = diceTotal + modifier;
        const pendingChoice: PendingChoice = {
          id: randomUUID(),
          type: "spend-resolve",
          proposal,
          roll: {
            rule: { id: "micro-ruleset.check", version: "1.0.0" },
            random: { ...randomSource.metadata(), inputs },
            modifiers: [{ source: proposal.trait, value: modifier }],
            result: { diceTotal, total },
          },
          availableChoices:
            state.playerCharacter.resolve === 0
              ? ["decline"]
              : ["decline", "spend-resolve"],
        };
        const event = append("CheckRollRevealed", { pendingChoice }, commandId);
        return accept(
          `Roll revealed (${inputs.join(" + ")} + ${modifier} = ${total}). Decide whether to spend Resolve.`,
          [event],
        );
      }

      if (input.type === "correct-check-proposal") {
        const proposal = state.pendingCheckProposal;
        if (proposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        if (input.goal.trim() === "" || !isTrait(input.trait)) {
          return reject(
            "invalid-check-correction",
            "A corrected Check Proposal requires a goal and valid Trait.",
            state,
          );
        }
        const replacement: CheckProposal = {
          ...proposal,
          id: randomUUID(),
          goal: input.goal,
          trait: input.trait,
        };
        const event = append(
          "CheckProposalReplaced",
          {
            supersededProposalId: proposal.id,
            proposal: replacement,
            reason: "correction",
          },
          commandId,
        );
        return accept("The corrected Check Proposal is ready for review.", [event]);
      }

      if (input.type === "revise-check-action") {
        const proposal = state.pendingCheckProposal;
        if (proposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        const definition = checkActions.find(
          (action) => action.id === input.actionId,
        );
        if (definition === undefined) {
          return reject(
            "action-unavailable",
            "That revised action is not available in the current Scene.",
            state,
          );
        }
        const replacement = createProposal(definition);
        const event = append(
          "CheckProposalReplaced",
          {
            supersededProposalId: proposal.id,
            proposal: replacement,
            reason: "revised-action",
          },
          commandId,
        );
        return accept("A new validated Check Proposal is ready for review.", [event]);
      }

      if (input.type === "withdraw-check-proposal") {
        if (state.pendingCheckProposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        const event = append(
          "CheckProposalWithdrawn",
          { proposalId: input.proposalId },
          commandId,
        );
        return accept("The action was withdrawn before rolling.", [event]);
      }

      if (input.type === "amend-check-stakes") {
        if (state.pendingCheckProposal?.id !== input.proposalId) {
          return reject(
            "check-proposal-unavailable",
            "That Check Proposal is no longer available.",
            state,
          );
        }
        return reject(
          "check-stakes-immutable",
          "Confirmed stakes cannot be edited; revise or withdraw the action instead.",
          state,
        );
      }

      if (input.type === "choose-action") {
        const actionIsAvailable = availableActionsFor(state, checkActions).some(
          (action) => action.id === input.actionId,
        );
        if (!actionIsAvailable) {
          return reject(
            "action-unavailable",
            "That action is not available in the current Scene.",
            state,
          );
        }

        if (input.actionId === "survey-manor") {
          const event = append(
            "FreeActionCompleted",
            { actionId: "survey-manor", establishedFact: FRESH_FOOTPRINTS },
            commandId,
          );
          return accept(FRESH_FOOTPRINTS.text, [event]);
        }

        const definition = checkActions.find(
          (action) => action.id === input.actionId,
        );
        if (definition === undefined) {
          return reject(
            "action-unavailable",
            "That action is not available in the current Scene.",
            state,
          );
        }
        const proposal = createProposal(definition);
        const event = append("CheckProposalCreated", { proposal }, commandId);
        return accept("Review the Check Proposal before rolling.", [event]);
      }

      if (input.type === "begin-adventure") {
        if (state.playerCharacter === null) {
          return reject(
            "player-character-required",
            "Configure the Player Character before beginning.",
            state,
          );
        }
        const event = append(
          "SceneStarted",
          { scene: "arrival" },
          commandId,
        );
        return accept("The Adventure begins at the locked manor.", [event]);
      }

      if (state.playerCharacter !== null) {
        return reject(
          "player-character-already-configured",
          "The Player Character is already configured.",
          state,
        );
      }

      if (
        input.name.trim() === "" ||
        input.pronouns.trim() === "" ||
        input.motivation.trim() === ""
      ) {
        return reject(
          "invalid-identity",
          "Name, pronouns, and Motivation are required.",
          state,
        );
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
        return reject(
          "invalid-trait-assignment",
          "Assign +0, +1, and +2 exactly once among the three Traits.",
          state,
        );
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
      const event = append(
        "PlayerCharacterConfigured",
        playerCharacter,
        commandId,
      );
      return accept(`${playerCharacter.name} is ready for the Adventure.`, [event]);
    },
  };
};
