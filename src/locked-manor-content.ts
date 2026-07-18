import type {
  CheckActionDefinition,
  CheckStakes,
  EstablishedFact,
  FictionalConsequence,
  MechanicalEffect,
  OracleActionDefinition,
} from "./structured-play.js";

export const FRESH_FOOTPRINTS: EstablishedFact = {
  id: "fresh-footprints",
  text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
};

const SIDE_DOOR_OPEN: FictionalConsequence = {
  type: "establish-fact",
  fact: {
    id: "side-door-open",
    text: "The manor's side door is open.",
  },
};

const MANOR_ALERTED: FictionalConsequence = {
  type: "establish-fact",
  fact: {
    id: "manor-alerted",
    text: "The noise at the side door alerted someone inside the manor.",
  },
};

const SIDE_DOOR_HELD: FictionalConsequence = {
  type: "establish-fact",
  fact: {
    id: "side-door-held",
    text: "The swollen side door resisted the attempt to open it.",
  },
};

const FORCED_DOOR_HARM: MechanicalEffect = {
  type: "lose-health",
  amount: 1,
};

const FORCE_SIDE_DOOR_STAKES: CheckStakes = {
  Setback: {
    summary:
      "The door stays shut, the noise alerts the manor, and you lose 1 Health.",
    consequences: [SIDE_DOOR_HELD, MANOR_ALERTED, FORCED_DOOR_HARM],
  },
  "Success with Cost": {
    summary: "The door opens, but the noise alerts the manor.",
    consequences: [SIDE_DOOR_OPEN, MANOR_ALERTED],
  },
  "Clean Success": {
    summary: "The door opens quietly.",
    consequences: [SIDE_DOOR_OPEN],
  },
};

export const DEFAULT_CHECK_ACTIONS: readonly CheckActionDefinition[] = [
  {
    id: "force-side-door",
    label: "Force the side door",
    kind: "Check",
    goal: "Force open the manor's side door",
    trait: "Might",
    stakes: FORCE_SIDE_DOOR_STAKES,
  },
  {
    id: "pick-side-door-lock",
    label: "Pick the side-door lock",
    kind: "Check",
    goal: "Open the manor's side door with the Lockpick Set",
    trait: "Wits",
    stakes: {
      Setback: {
        summary: "The lock stays shut and the attempt alerts the manor.",
        consequences: [SIDE_DOOR_HELD, MANOR_ALERTED],
      },
      "Success with Cost": {
        summary: "The lock opens, but the attempt alerts the manor.",
        consequences: [SIDE_DOOR_OPEN, MANOR_ALERTED],
      },
      "Clean Success": {
        summary: "The lock opens quietly.",
        consequences: [SIDE_DOOR_OPEN],
      },
    },
  },
];

export const DEFAULT_ORACLE_ACTIONS: readonly OracleActionDefinition[] = [
  {
    id: "ask-someone-inside-manor",
    label: "Ask whether someone is inside the manor",
    kind: "Oracle",
    proposition: {
      id: "someone-inside-manor",
      text: "Is someone currently inside the manor?",
      answers: {
        Yes: {
          id: "someone-inside-manor-yes",
          text: "Someone is currently inside the manor.",
        },
        No: {
          id: "someone-inside-manor-no",
          text: "No one is currently inside the manor.",
        },
      },
      exceptionalConsequences: {
        favourable: {
          kind: "favourable",
          establishedFact: {
            id: "brass-key-by-footprints",
            text: "A recently dropped brass key lies beside the fresh footprints.",
          },
        },
        adverse: {
          kind: "adverse",
          establishedFact: {
            id: "sprung-warning-bell",
            text: "The fresh footprints cross a sprung warning bell at the side entrance.",
          },
        },
      },
    },
    recommendedLikelihood: "Likely",
    supportingFactIds: [FRESH_FOOTPRINTS.id],
  },
];
