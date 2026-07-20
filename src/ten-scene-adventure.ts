import type {
  AdventureEndingDefinition,
  CheckActionDefinition,
  ConfrontationDefinition,
  FreeActionDefinition,
  OracleActionDefinition,
  RevealDefinition,
  Scene,
  SceneTransitionDefinition,
  StructuredPlayOptions,
} from "./structured-play.js";
import { DEFAULT_PLAYER_CHARACTER_ID } from "./world-knowledge.js";

export const TEN_SCENE_ADVENTURE_SCENES = [
  "arrival",
  "gatehouse",
  "courtyard",
  "vestibule",
  "gallery",
  "library",
  "study",
  "cellar",
  "antechamber",
  "confrontation",
] as const satisfies readonly Scene[];

const freeAction = (
  id: string,
  label: string,
  scene: Scene,
  factId: string,
  text: string,
  requiredFactIds: readonly string[] = [],
): FreeActionDefinition => ({
  id,
  label,
  kind: "Free Action",
  establishedFact: { id: factId, text },
  availableInScenes: [scene],
  requiredFactIds,
});

const freeActions: readonly FreeActionDefinition[] = [
  freeAction(
    "read-arrival-marker",
    "Read the weathered arrival marker",
    "arrival",
    "gatehouse-route-found",
    "The weathered marker identifies a safe route to the gatehouse.",
  ),
  freeAction(
    "raise-gatehouse-latch",
    "Raise the gatehouse latch",
    "gatehouse",
    "courtyard-opened",
    "The gatehouse latch opens the way into the courtyard.",
    ["gatehouse-route-found"],
  ),
  freeAction(
    "cross-courtyard",
    "Cross the moonlit courtyard",
    "courtyard",
    "vestibule-reached",
    "The Player Character crosses the courtyard and reaches the vestibule.",
    ["courtyard-opened"],
  ),
  freeAction(
    "study-family-portrait",
    "Study the damaged family portrait",
    "gallery",
    "portrait-sigil-found",
    "A sigil beneath the damaged portrait matches the manor library seal.",
    ["gallery-entered"],
  ),
  freeAction(
    "catalogue-library-ledger",
    "Catalogue the library ledger",
    "library",
    "ledger-indexed",
    "The library ledger identifies a concealed route below the study.",
    ["portrait-sigil-found"],
  ),
  freeAction(
    "follow-cellar-route",
    "Follow the route through the cellar",
    "cellar",
    "antechamber-reached",
    "The concealed route leads through the cellar to the antechamber.",
  ),
  freeAction(
    "prepare-for-guardian",
    "Prepare to confront the manor guardian",
    "antechamber",
    "guardian-confrontation-ready",
    "The Player Character enters the guardian's chamber prepared.",
    ["antechamber-reached"],
  ),
];

const enterGallery: CheckActionDefinition = {
  id: "open-vestibule-door",
  label: "Open the sealed vestibule door",
  kind: "Check",
  goal: "Open the sealed vestibule door",
  trait: "Wits",
  availableInScenes: ["vestibule"],
  stakes: {
    Setback: {
      summary: "The door opens noisily and leaves the Player Character Shaken.",
      consequences: [
        {
          type: "establish-fact",
          fact: {
            id: "gallery-entered",
            text: "The sealed vestibule door is open and the gallery is accessible.",
          },
        },
        { type: "add-condition", condition: "Shaken" },
      ],
    },
    "Success with Cost": {
      summary: "The door opens with a scrape that echoes through the manor.",
      consequences: [
        {
          type: "establish-fact",
          fact: {
            id: "gallery-entered",
            text: "The sealed vestibule door is open and the gallery is accessible.",
          },
        },
      ],
    },
    "Clean Success": {
      summary: "The sealed door opens quietly into the gallery.",
      consequences: [
        {
          type: "establish-fact",
          fact: {
            id: "gallery-entered",
            text: "The sealed vestibule door is open and the gallery is accessible.",
          },
        },
      ],
    },
  },
};

const overcomeGuardian: CheckActionDefinition = {
  id: "overcome-manor-guardian",
  label: "Overcome the manor guardian",
  kind: "Check",
  goal: "Overcome the manor guardian and recover the manor records",
  trait: "Might",
  availableInScenes: ["confrontation"],
  repeatable: true,
  stakes: {
    Setback: {
      summary: "The guardian is overcome, but the struggle costs 1 Health.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
        { type: "lose-health", amount: 1 },
      ],
    },
    "Success with Cost": {
      summary: "The guardian is overcome as danger closes in.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
        { type: "advance-clock", clock: "Danger", amount: 1 },
      ],
    },
    "Clean Success": {
      summary: "The guardian yields and the manor records are secured.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
      ],
    },
  },
};

const passageOracle: OracleActionDefinition = {
  id: "ask-passage-behind-shelves",
  label: "Ask whether the concealed passage lies behind the shelves",
  kind: "Oracle",
  proposition: {
    id: "passage-behind-shelves",
    text: "Does the concealed passage lie behind the study shelves?",
    answers: {
      Yes: {
        id: "passage-behind-shelves-yes",
        text: "The concealed passage lies behind the study shelves.",
      },
      No: {
        id: "passage-behind-shelves-no",
        text: "The concealed passage lies beneath the study desk instead.",
      },
    },
    exceptionalConsequences: {
      favourable: {
        kind: "favourable",
        establishedFact: {
          id: "passage-key-found",
          text: "The matching passage key rests beside the ledger.",
        },
      },
      adverse: {
        kind: "adverse",
        establishedFact: {
          id: "passage-alarm-armed",
          text: "A warning wire is armed across the concealed passage.",
        },
      },
    },
  },
  recommendedLikelihood: "Likely",
  supportingFactIds: ["ledger-indexed"],
};

const transitions: readonly SceneTransitionDefinition[] = [
  ["arrival", "gatehouse", "gatehouse-route-found"],
  ["gatehouse", "courtyard", "courtyard-opened"],
  ["courtyard", "vestibule", "vestibule-reached"],
  ["vestibule", "gallery", "gallery-entered"],
  ["gallery", "library", "portrait-sigil-found"],
  ["library", "study", "ledger-indexed"],
  ["study", "cellar", "passage-behind-shelves-yes"],
  ["study", "cellar", "passage-behind-shelves-no"],
  ["cellar", "antechamber", "antechamber-reached"],
  ["antechamber", "confrontation", "guardian-confrontation-ready"],
].map(([from, to, factId]) => ({
  from: from as Scene,
  to: to as Scene,
  requiredFactIds: [factId!],
  automatic: true,
}));

const confrontation: ConfrontationDefinition = {
  id: "manor-guardian",
  resistanceClock: {
    capacity: 1,
    fillingConsequence: {
      id: "manor-guardian-overcome",
      text: "The manor guardian is overcome and the records are secured.",
    },
  },
  dangerClock: {
    capacity: 2,
    fillingConsequence: {
      id: "manor-guardian-prevails",
      text: "The manor guardian drives the Player Character from the records chamber.",
    },
  },
  healthZeroConsequence: {
    id: "player-character-overwhelmed",
    text: "The Player Character is overwhelmed and wakes outside the manor.",
  },
  defeatEffects: [{ type: "add-condition", condition: "Restrained" }],
};

const endings: readonly AdventureEndingDefinition[] = [
  {
    from: "confrontation",
    requiredFactIds: ["manor-guardian-overcome"],
    ending: {
      id: "manor-truth-recovered",
      kind: "favourable",
      text: "The recovered records reveal the truth behind the locked manor.",
    },
  },
];

const reveals: readonly RevealDefinition[] = [
  {
    id: "review-steward-ledger-reveal",
    label: "Review the steward ledger Reveal",
    kind: "Reveal",
    worldKnowledgeId: "steward-ledger-keeper",
    availableInScenes: ["library"],
    requiredFactIds: ["portrait-sigil-found"],
    knowledgeScope: [
      "Game Master",
      {
        kind: "Player Character",
        playerCharacterId: DEFAULT_PLAYER_CHARACTER_ID,
      },
    ],
  },
];

const structuredPlayOptions = {
  freeActions,
  checkActions: [enterGallery, overcomeGuardian],
  oracleActions: [passageOracle],
  sceneTransitions: transitions,
  confrontation,
  adventureEndings: endings,
  reveals,
  authoredWorldKnowledge: [
    {
      fact: {
        id: "steward-ledger-keeper",
        text: "The manor steward maintained the concealed passage ledger.",
      },
      provenance: {
        originKind: "authored-content" as const,
        sourceReference: "ten-scene-adventure:library-ledger",
      },
      visibility: "Game Master-only" as const,
      knowledgeScope: ["Game Master" as const],
    },
  ],
} satisfies Omit<
  StructuredPlayOptions,
  "eventStore" | "randomSource" | "timelineStore"
>;

export const TEN_SCENE_ADVENTURE = Object.freeze({
  id: "locked-manor-ten-scene",
  name: "The Ten Chambers of the Locked Manor",
  scenes: TEN_SCENE_ADVENTURE_SCENES,
  structuredPlayOptions,
});

export const TEN_SCENE_STRUCTURED_CHOICES = Object.freeze([
  { scene: "arrival", actionId: "read-arrival-marker" },
  { scene: "gatehouse", actionId: "raise-gatehouse-latch" },
  { scene: "courtyard", actionId: "cross-courtyard" },
  { scene: "vestibule", actionId: "open-vestibule-door" },
  { scene: "gallery", actionId: "study-family-portrait" },
  { scene: "library", actionId: "review-steward-ledger-reveal" },
  { scene: "library", actionId: "catalogue-library-ledger" },
  { scene: "study", actionId: "ask-passage-behind-shelves" },
  { scene: "cellar", actionId: "follow-cellar-route" },
  { scene: "antechamber", actionId: "prepare-for-guardian" },
  { scene: "confrontation", actionId: "overcome-manor-guardian" },
] as const);
