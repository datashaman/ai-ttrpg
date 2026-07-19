import { createHash } from "node:crypto";

import { immutableSnapshot } from "./model-boundary.js";
import type {
  ApplicationView,
  CanonicalEvent,
} from "./structured-play.js";

export type EvidenceSourceKind =
  | "active-scene"
  | "player-character"
  | "inventory-item"
  | "condition"
  | "established-fact"
  | "capability"
  | "authority-rule"
  | "resolution"
  | "accepted-event";

export interface EvidenceItem {
  readonly id: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly sourceReference: string;
  readonly content: string;
  readonly inclusionReason: string;
}

export interface EvidenceBundle {
  readonly id: string;
  readonly taskType: "interpret-player-input" | "explain-rules";
  readonly items: readonly EvidenceItem[];
}

interface RankedEvidenceItem {
  readonly item: EvidenceItem;
  readonly priority: number;
  readonly order: number;
}

const selectRankedEvidence = (
  candidates: readonly RankedEvidenceItem[],
  maxItems: number,
): readonly EvidenceItem[] =>
  [...candidates]
    .sort((left, right) =>
      left.priority === right.priority
        ? left.order - right.order
        : left.priority - right.priority,
    )
    .slice(0, maxItems)
    .map(({ item }) => item);

export interface InterpretationEvidenceInput {
  readonly utterance: string;
  readonly view: ApplicationView;
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly maxItems?: number;
}

export type RulesExplanationEvidenceInput = InterpretationEvidenceInput;

const normalized = (value: string): string =>
  value
    .toLocaleLowerCase("en")
    .replace(/lockpick/g, "lock pick")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isDirectlyRelevant = (
  utterance: string,
  ...descriptions: readonly string[]
): boolean => {
  const input = normalized(utterance);
  return descriptions.some((description) => {
    const candidate = normalized(description);
    if (candidate.length > 3 && input.includes(candidate)) return true;
    return candidate
      .split(" ")
      .filter((term) => term.length >= 4)
      .some((term) => input.split(" ").includes(term));
  });
};

const bundleId = (items: readonly EvidenceItem[]): string =>
  `evidence:${createHash("sha256").update(JSON.stringify(items)).digest("hex")}`;

export const assembleInterpretationEvidence = (
  input: InterpretationEvidenceInput,
): EvidenceBundle => {
  const candidates: RankedEvidenceItem[] = [];
  const add = (item: EvidenceItem, priority: number): void => {
    candidates.push({ item, priority, order: candidates.length });
  };
  const playerCharacter = input.view.state.playerCharacter;
  const activeScene = input.view.state.activeScene;

  if (activeScene !== null) {
    add(
      {
        id: `entity:scene:${activeScene}`,
        sourceKind: "active-scene",
        sourceReference: `scene:${activeScene}`,
        content: activeScene,
        inclusionReason: "The active Scene bounds currently available actions.",
      },
      isDirectlyRelevant(input.utterance, activeScene) ? 0 : 3,
    );
  }
  if (playerCharacter !== null) {
    add(
      {
        id: "entity:player-character",
        sourceKind: "player-character",
        sourceReference: "player-character",
        content: JSON.stringify({
          name: playerCharacter.name,
          pronouns: playerCharacter.pronouns,
          motivation: playerCharacter.motivation,
          traits: playerCharacter.traits,
          health: playerCharacter.health,
          resolve: playerCharacter.resolve,
        }),
        inclusionReason: "The acting Player Character is visible in the current situation.",
      },
      isDirectlyRelevant(input.utterance, playerCharacter.name) ? 0 : 3,
    );
    playerCharacter.inventory
      .filter((item) => item.state === "carried")
      .forEach((item) =>
        add(
          {
            id: `entity:inventory:${item.name}`,
            sourceKind: "inventory-item",
            sourceReference: `inventory:${item.name}`,
            content: item.name,
            inclusionReason: "This carried Inventory Item may permit an authored approach.",
          },
          isDirectlyRelevant(input.utterance, item.name) ? 0 : 3,
        ),
      );
  }
  input.view.state.conditions.forEach((condition) =>
    add(
      {
        id: `entity:condition:${condition}`,
        sourceKind: "condition",
        sourceReference: `condition:${condition}`,
        content: condition,
        inclusionReason: "This visible Condition may constrain an available action.",
      },
      isDirectlyRelevant(input.utterance, condition) ? 0 : 3,
    ),
  );
  input.view.state.establishedFacts.forEach((fact) =>
    add(
      {
        id: `fact:${fact.id}`,
        sourceKind: "established-fact",
        sourceReference: fact.id,
        content: fact.text,
        inclusionReason: "This Player-visible Established Fact describes the current situation.",
      },
      isDirectlyRelevant(input.utterance, fact.id, fact.text) ? 0 : 4,
    ),
  );
  input.view.availableActions.forEach((capability) =>
    add(
      {
        id: `capability:${capability.id}`,
        sourceKind: "capability",
        sourceReference: capability.id,
        content: JSON.stringify({ label: capability.label, kind: capability.kind }),
        inclusionReason: "This capability is currently available through Structured Play.",
      },
      isDirectlyRelevant(input.utterance, capability.id, capability.label) ? 0 : 2,
    ),
  );
  add(
    {
      id: "rule:structured-play-authority",
      sourceKind: "authority-rule",
      sourceReference: "CONTEXT.md#Structured Play",
      content:
        "A model may select only an available capability; Structured Play validates and commits every command and Mechanical Effect.",
      inclusionReason: "This exact authority rule governs interpretation tasks.",
    },
    1,
  );

  const latestResolution =
    input.view.state.pendingChoice ??
    input.view.state.pendingCheckProposal ??
    input.view.state.pendingNarratorRecommendation ??
    input.view.state.lastCheckResolution ??
    input.view.state.lastOracleResolution;
  if (latestResolution !== null) {
    add(
      {
        id: "resolution:current",
        sourceKind: "resolution",
        sourceReference: "projected-state:current-resolution",
        content: JSON.stringify(latestResolution),
        inclusionReason: "The pending or latest visible resolution constrains the next action.",
      },
      1,
    );
  }

  [...input.acceptedEvents]
    .reverse()
    .slice(0, 8)
    .forEach((event, newestFirstIndex) =>
      add(
        {
          id: `event:${event.id}`,
          sourceKind: "accepted-event",
          sourceReference: `adventure-event:${event.id}`,
          content: JSON.stringify({ type: event.type, payload: event.payload }),
          inclusionReason: "This is recent accepted Adventure context visible through projection.",
        },
        10 + newestFirstIndex,
      ),
    );

  const maxItems = Math.max(1, input.maxItems ?? 64);
  const items = selectRankedEvidence(candidates, maxItems);
  return immutableSnapshot({
    id: bundleId(items),
    taskType: "interpret-player-input" as const,
    items,
  });
};

interface AuthoredRule {
  readonly item: EvidenceItem;
  readonly terms: readonly string[];
}

const AUTHORED_RULES: readonly AuthoredRule[] = [
  {
    item: {
      id: "rule:inventory-items@1.0.0",
      sourceKind: "authority-rule",
      sourceReference: "CONTEXT.md#Inventory Item",
      content:
        "A distinct object carried by the Player Character that may permit an approach or become an explicit outcome stake without granting an automatic numeric bonus. An Inventory Item is either carried or removed; consumption, loss, surrender, or breakage removes it rather than creating a damaged state. The first inventory contains a Lantern, Lockpick Set, Short Blade, and Field Kit.",
      inclusionReason:
        "This exact authored rule governs Inventory Items and item-enabled approaches.",
    },
    terms: ["inventory", "item", "lockpick", "lantern", "blade", "field kit"],
  },
  {
    item: {
      id: "rule:checks@1.0.0",
      sourceKind: "authority-rule",
      sourceReference: "CONTEXT.md#Check",
      content:
        "The resolution of a confirmed Check Proposal with 2d6 plus the relevant Trait, producing a Setback, Success with Cost, or Clean Success.",
      inclusionReason: "This exact authored rule governs Check resolution.",
    },
    terms: ["check", "roll", "trait", "setback", "success", "2d6"],
  },
  {
    item: {
      id: "rule:resolve@1.0.0",
      sourceKind: "authority-rule",
      sourceReference: "CONTEXT.md#Resolve",
      content:
        "The Player Character's three-point capacity to change a Check after seeing its roll but before its outcome is established. The Player may spend one Resolve per Check to add +1 to its final total; reaching zero does not itself cause Defeat.",
      inclusionReason: "This exact authored rule governs spending Resolve.",
    },
    terms: ["resolve", "spend", "shaken", "plus one", "+1"],
  },
  {
    item: {
      id: "rule:oracle-likelihood@1.0.0",
      sourceKind: "authority-rule",
      sourceReference: "CONTEXT.md#Likelihood",
      content:
        "The Player-visible odds confirmed by the Player before the Oracle answers an Unresolved Proposition: Unlikely means 25% Yes, Even means 50% Yes, and Likely means 75% Yes. The Narrator may recommend a Likelihood from Established Facts but cannot select it finally.",
      inclusionReason: "This exact authored rule governs Oracle Likelihood.",
    },
    terms: ["oracle", "likelihood", "unlikely", "even", "likely", "odds"],
  },
  {
    item: {
      id: "rule:free-actions@1.0.0",
      sourceKind: "authority-rule",
      sourceReference: "CONTEXT.md#Free Action",
      content:
        "An action whose outcome is not meaningfully uncertain or whose failure would not materially change the situation. A Free Action proceeds without a Check.",
      inclusionReason: "This exact authored rule governs Free Actions.",
    },
    terms: ["free action", "without a check", "automatic", "uncertain"],
  },
];

const applicableRules = (query: string): readonly EvidenceItem[] => {
  const normalizedQuery = normalized(query);
  const matching = AUTHORED_RULES.filter((rule) =>
    rule.terms.some((term) => normalizedQuery.includes(normalized(term))),
  ).map((rule) => rule.item);
  return matching.length > 0 ? matching : [AUTHORED_RULES[1]!.item];
};

const RELEVANCE_STOP_WORDS = new Set([
    "and",
    "are",
    "can",
    "does",
    "from",
    "how",
    "that",
    "the",
    "this",
    "use",
    "was",
    "what",
    "why",
    "with",
    "you",
    "your",
]);

const RESOLUTION_QUERY_TERMS = [
  "check",
  "cost",
  "happen",
  "happened",
  "outcome",
  "resolve",
  "result",
  "roll",
  "setback",
  "spend",
  "success",
  "total",
  "why",
] as const;

const relevanceScore = (query: string, item: EvidenceItem): number => {
  const queryTerms = new Set(
    normalized(query)
      .split(" ")
      .filter((term) => term.length >= 3 && !RELEVANCE_STOP_WORDS.has(term)),
  );
  return normalized(`${item.id} ${item.sourceReference} ${item.content}`)
    .split(" ")
    .filter((term) => term.length >= 3 && queryTerms.has(term)).length;
};

export const isRulesEvidenceApplicable = (
  query: string,
  item: EvidenceItem,
): boolean => {
  if (item.sourceKind === "authority-rule") return true;
  if (item.sourceKind === "active-scene") return true;
  if (item.sourceKind === "resolution") {
    const normalizedQuery = normalized(query);
    return RESOLUTION_QUERY_TERMS.some((term) =>
      normalizedQuery.includes(term),
    );
  }
  return relevanceScore(query, item) > 0;
};

const taskSpecificContext = (
  query: string,
  items: readonly EvidenceItem[],
): readonly EvidenceItem[] => {
  const scoredCapabilities = items
    .filter((item) => item.sourceKind === "capability")
    .map((item) => ({ item, score: relevanceScore(query, item) }));
  const highestCapabilityScore = Math.max(
    0,
    ...scoredCapabilities.map(({ score }) => score),
  );
  return items.filter((item) => {
    if (item.sourceKind === "capability") {
      return (
        highestCapabilityScore > 0 &&
        relevanceScore(query, item) === highestCapabilityScore
      );
    }
    if (
      item.sourceKind === "inventory-item" ||
      item.sourceKind === "condition" ||
      item.sourceKind === "established-fact"
    ) {
      return relevanceScore(query, item) > 0;
    }
    if (item.sourceKind === "player-character") {
      return relevanceScore(query, item) > 0;
    }
    return true;
  });
};

export const assembleRulesExplanationEvidence = (
  input: RulesExplanationEvidenceInput,
): EvidenceBundle => {
  const contextual = taskSpecificContext(
    input.utterance,
    assembleInterpretationEvidence({
      ...input,
      maxItems: 64,
    }).items.filter((item) => item.id !== "rule:structured-play-authority"),
  );
  const rules = applicableRules(input.utterance);
  const ranked: RankedEvidenceItem[] = [
    ...rules.map((item, order) => ({ item, priority: 0, order })),
    ...contextual.map((item, order) => ({
      item,
      priority:
        item.sourceKind === "accepted-event"
          ? 10
          : isDirectlyRelevant(
                input.utterance,
                item.id,
                item.sourceReference,
                item.content,
              )
            ? 1
            : 4,
      order: rules.length + order,
    })),
  ];
  const maxItems = Math.max(1, input.maxItems ?? 64);
  const items = selectRankedEvidence(ranked, maxItems);
  return immutableSnapshot({
    id: bundleId(items),
    taskType: "explain-rules" as const,
    items,
  });
};
