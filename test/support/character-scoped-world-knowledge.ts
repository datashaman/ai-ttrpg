import type { WorldKnowledgeEstablishedPayload } from "../../src/world-knowledge.js";

export const MARA_PLAYER_CHARACTER_ID = "player-character:mara-vey";
export const IONA_PLAYER_CHARACTER_ID = "player-character:iona-vale";

export const TWO_CHARACTER_WORLD_KNOWLEDGE: readonly WorldKnowledgeEstablishedPayload[] = [
  {
    fact: {
      id: "mara-remembers-insignia",
      text: "Mara remembers the silver insignia from her sister's letters.",
    },
    provenance: {
      originKind: "authored-content",
      sourceReference: "fixture:two-character-knowledge:mara",
    },
    visibility: "Player-visible",
    knowledgeScope: [
      {
        kind: "Player Character",
        playerCharacterId: MARA_PLAYER_CHARACTER_ID,
      },
    ],
  },
  {
    fact: {
      id: "iona-knows-tunnel",
      text: "Iona knows the abandoned well connects to the manor cellar.",
    },
    provenance: {
      originKind: "authored-content",
      sourceReference: "fixture:two-character-knowledge:iona",
    },
    visibility: "Player-visible",
    knowledgeScope: [
      {
        kind: "Player Character",
        playerCharacterId: IONA_PLAYER_CHARACTER_ID,
      },
    ],
  },
];
