import type {
  CheckActionDefinition,
  CheckStakes,
  ConfrontationDefinition,
  EstablishedFact,
  FictionalConsequence,
  MechanicalEffect,
  OracleActionDefinition,
  SceneTransitionDefinition,
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
    requiresFreeMovement: true,
    availableInScenes: ["arrival"],
    stakes: FORCE_SIDE_DOOR_STAKES,
  },
  {
    id: "pick-side-door-lock",
    label: "Pick the side-door lock",
    kind: "Check",
    goal: "Open the manor's side door with the Lockpick Set",
    trait: "Wits",
    requiredItem: "Lockpick Set",
    requiresFreeMovement: true,
    availableInScenes: ["arrival"],
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
  {
    id: "inspect-dark-entryway",
    label: "Inspect the dark entryway by Lantern light",
    kind: "Check",
    goal: "Inspect the dark entryway by Lantern light",
    trait: "Wits",
    requiredItem: "Lantern",
    requiresFreeMovement: true,
    availableInScenes: ["arrival"],
    stakes: {
      Setback: {
        summary: "The shadows conceal anything useful.",
        consequences: [],
      },
      "Success with Cost": {
        summary: "You spot signs of passage, but someone hears you moving.",
        consequences: [MANOR_ALERTED],
      },
      "Clean Success": {
        summary: "The Lantern reveals signs of recent passage.",
        consequences: [],
      },
    },
  },
  {
    id: "cut-away-door-vines",
    label: "Cut away the side-door vines with the Short Blade",
    kind: "Check",
    goal: "Clear the tangled vines from the side door",
    trait: "Might",
    requiredItem: "Short Blade",
    requiresFreeMovement: true,
    availableInScenes: ["arrival"],
    stakes: {
      Setback: {
        summary: "The tangled vines hold and the effort alerts the manor.",
        consequences: [MANOR_ALERTED],
      },
      "Success with Cost": {
        summary: "The vines part, but the effort alerts the manor.",
        consequences: [MANOR_ALERTED],
      },
      "Clean Success": {
        summary: "The Short Blade quietly clears the vines.",
        consequences: [],
      },
    },
  },
  {
    id: "drive-back-cult-guardian",
    label: "Drive back the cult guardian",
    kind: "Check",
    goal: "Overcome the cult guardian and secure the cellar",
    trait: "Might",
    requiredItem: "Short Blade",
    requiresFreeMovement: true,
    availableInScenes: ["confrontation"],
    repeatable: true,
    stakes: {
      Setback: {
        summary: "The guardian presses the attack and you lose 1 Health.",
        consequences: [
          { type: "advance-clock", clock: "Danger", amount: 1 },
          { type: "lose-health", amount: 1 },
        ],
      },
      "Success with Cost": {
        summary: "You drive the guardian back, but the danger escalates.",
        consequences: [
          { type: "advance-clock", clock: "Resistance", amount: 1 },
          { type: "advance-clock", clock: "Danger", amount: 1 },
        ],
      },
      "Clean Success": {
        summary: "You drive the guardian back without yielding ground.",
        consequences: [
          { type: "advance-clock", clock: "Resistance", amount: 1 },
        ],
      },
    },
  },
];

export const DEFAULT_CONFRONTATION: ConfrontationDefinition = {
  id: "cellar-guardian",
  resistanceClock: {
    capacity: 2,
    fillingConsequence: {
      id: "cellar-guardian-overcome",
      text: "The cult guardian is overcome and the cellar is secured.",
    },
  },
  dangerClock: {
    capacity: 2,
    fillingConsequence: {
      id: "mara-captured-by-guardian",
      text: "The cult guardian captures Mara and drags her into the cells.",
    },
  },
  healthZeroConsequence: {
    id: "mara-overwhelmed-and-imprisoned",
    text: "Overwhelmed by her injuries, Mara wakes imprisoned in the manor cells.",
  },
  defeatEffects: [{ type: "add-condition", condition: "Restrained" }],
};

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

export const DEFAULT_SCENE_TRANSITIONS: readonly SceneTransitionDefinition[] = [
  {
    from: "arrival",
    to: "discovery",
    requiredFactIds: [SIDE_DOOR_OPEN.fact.id],
  },
  {
    from: "discovery",
    to: "confrontation",
    requiredFactIds: [SIDE_DOOR_OPEN.fact.id],
  },
];
