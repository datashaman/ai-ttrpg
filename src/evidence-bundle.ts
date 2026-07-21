import {
  evidenceBundleId,
  selectRankedEvidence,
  type RankedEvidenceItem,
} from "./evidence-selection.js";
import { immutableSnapshot } from "./model-boundary.js";
import type {
  ApplicationView,
  CanonicalEvent,
  CheckTrace,
  EstablishedFact,
  OracleTrace,
  PlayerCharacter,
  Scene,
} from "./structured-play.js";
import {
  filterCanonicalEventsVisibleTo,
  projectWorldKnowledge,
  type PlayerWorldKnowledgeActorScope,
  type WorldKnowledgeEntry,
} from "./world-knowledge.js";

export type EvidenceSourceKind =
  | "active-scene"
  | "player-character"
  | "inventory-item"
  | "condition"
  | "established-fact"
  | "relationship"
  | "capability"
  | "authority-rule"
  | "resolution"
  | "direct-entity"
  | "retrieved-entity"
  | "validated-intent"
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
  readonly taskType:
    | "interpret-player-input"
    | "classify-discourse"
    | "extract-intent"
    | "suggest-rule-match"
    | "propose-state-change"
    | "explain-rules"
    | "narrate-committed-outcome";
  readonly items: readonly EvidenceItem[];
}

export interface InterpretationEvidenceInput {
  readonly actorScope: PlayerWorldKnowledgeActorScope;
  readonly utterance: string;
  readonly view: ApplicationView;
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly maxItems?: number;
}

export type RulesExplanationEvidenceInput = InterpretationEvidenceInput;

export interface NarrationEvidenceInput {
  readonly actorScope: PlayerWorldKnowledgeActorScope;
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly resolutionTrace: CheckTrace | OracleTrace | null;
  readonly committedEvents: readonly CanonicalEvent[];
  readonly playerCharacter: PlayerCharacter | null;
  readonly activeScene: Scene | null;
  readonly maxItems?: number;
}

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

const directWorldKnowledgeReferences = (utterance: string): ReadonlySet<string> =>
  new Set(
    [...utterance.matchAll(/(?:^|\s)world-knowledge:([a-z0-9._-]+)/gi)].map(
      (match) => match[1]!,
    ),
  );

const worldKnowledgeContent = (
  entry: WorldKnowledgeEntry,
): string => entry.kind === "Established Fact" ? entry.text : entry.content;

const worldKnowledgeEvidenceItem = (
  entry: WorldKnowledgeEntry,
  reason: "current situation" | "committed outcome",
): EvidenceItem => {
  const isFact = entry.kind === "Established Fact";
  return {
    id: `${isFact ? "fact" : "relationship"}:${entry.id}`,
    sourceKind: isFact ? "established-fact" : "relationship",
    sourceReference: `world-knowledge:${entry.id}`,
    content: worldKnowledgeContent(entry),
    inclusionReason: `This Player-visible World Knowledge ${
      isFact ? "Entry" : "Relationship"
    } ${reason === "current situation" ? "describes" : "supports"} the ${reason}.`,
  };
};

export const assembleInterpretationEvidence = (
  input: InterpretationEvidenceInput,
): EvidenceBundle => {
  const candidates: RankedEvidenceItem<EvidenceItem>[] = [];
  const add = (item: EvidenceItem, priority: number): void => {
    candidates.push({ item, priority, order: candidates.length });
  };
  const playerCharacter = input.view.state.playerCharacter;
  const activeScene = input.view.state.activeScene;
  const directKnowledgeReferences = directWorldKnowledgeReferences(
    input.utterance,
  );

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
  projectWorldKnowledge({
    actorScope: input.actorScope,
    events: input.acceptedEvents,
  }).entries.forEach((entry) =>
    add(
      worldKnowledgeEvidenceItem(entry, "current situation"),
      directKnowledgeReferences.size > 0
        ? directKnowledgeReferences.has(entry.id)
          ? 0
          : 4
        : isDirectlyRelevant(
            input.utterance,
            entry.id,
            worldKnowledgeContent(entry),
          )
          ? 0
          : 4,
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

  [...filterCanonicalEventsVisibleTo({
    actorScope: input.actorScope,
    events: input.acceptedEvents,
  })]
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
    id: evidenceBundleId(items),
    taskType: "interpret-player-input" as const,
    items,
  });
};

const narrationRule = (
  trace: CheckTrace | OracleTrace,
): EvidenceItem =>
  trace.rule.id === "micro-ruleset.check"
    ? {
        id: `rule:${trace.rule.id}@${trace.rule.version}`,
        sourceKind: "authority-rule",
        sourceReference: "CONTEXT.md#Check",
        content:
          "The resolution of a confirmed Check Proposal with 2d6 plus the relevant Trait, producing a Setback, Success with Cost, or Clean Success.",
        inclusionReason:
          "This exact authored rule governs the committed Check outcome.",
      }
    : {
        id: `rule:${trace.rule.id}@${trace.rule.version}`,
        sourceKind: "authority-rule",
        sourceReference: "CONTEXT.md#Oracle",
        content:
          "The authority that answers an Unresolved Proposition with Yes or No when no human Game Master is present. Its answer is distinct from a Check, which determines whether a character succeeds.",
        inclusionReason:
          "This exact authored rule governs the committed Oracle outcome.",
      };

const directlyInvolvedEntity = (
  trace: CheckTrace | OracleTrace,
  committedEvents: readonly CanonicalEvent[],
): EvidenceItem | null => {
  if ("proposition" in trace) {
    return {
      id: `entity:proposition:${trace.proposition.id}`,
      sourceKind: "direct-entity",
      sourceReference: `proposition:${trace.proposition.id}`,
      content: trace.proposition.text,
      inclusionReason:
        "This Unresolved Proposition is the subject of the committed Oracle answer.",
    };
  }
  const checkEvent = committedEvents.find(
    (event) => event.type === "CheckResolved",
  );
  if (checkEvent === undefined) return null;
  return {
    id: `entity:action:${checkEvent.payload.actionId}`,
    sourceKind: "direct-entity",
    sourceReference: `action:${checkEvent.payload.actionId}`,
    content: JSON.stringify({
      actionId: checkEvent.payload.actionId,
      goal: checkEvent.payload.goal,
      trait: checkEvent.payload.trait,
    }),
    inclusionReason:
      "This authored action is directly involved in the committed Check outcome.",
  };
};

const acceptedEventContent = (event: CanonicalEvent): string => {
  if (event.type === "CheckResolved") {
    return JSON.stringify({
      type: event.type,
      actionId: event.payload.actionId,
      goal: event.payload.goal,
      trait: event.payload.trait,
      resolveSpent: event.payload.resolveSpent,
      adjustedTotal: event.payload.adjustedTotal,
      outcome: event.payload.outcome,
      committedStake: event.payload.committedStake,
    });
  }
  if (event.type === "OracleAnswered") {
    return JSON.stringify({
      type: event.type,
      proposition: {
        id: event.payload.trace.proposition.id,
        text: event.payload.trace.proposition.text,
      },
      confirmedLikelihood: event.payload.trace.confirmedLikelihood,
      recommendationEvidence: event.payload.trace.recommendation.evidence,
      result: event.payload.trace.result,
      establishedFact: event.payload.establishedFact,
    });
  }
  if (event.type === "SceneTransitioned") {
    return JSON.stringify({ type: event.type, ...event.payload });
  }
  if (event.type === "ConfrontationStarted") {
    return JSON.stringify({
      type: event.type,
      confrontationId: event.payload.definition.id,
      resistanceCapacity:
        event.payload.definition.resistanceClock.capacity,
      dangerCapacity: event.payload.definition.dangerClock.capacity,
    });
  }
  if (event.type === "ConfrontationEnded") {
    return JSON.stringify({ type: event.type, ...event.payload });
  }
  if (event.type === "AdventureEnded") {
    return JSON.stringify({ type: event.type, ...event.payload });
  }
  return JSON.stringify({ type: event.type });
};

const resolutionContent = (trace: CheckTrace | OracleTrace): string =>
  "proposition" in trace
    ? JSON.stringify({
        rule: trace.rule,
        proposition: {
          id: trace.proposition.id,
          text: trace.proposition.text,
        },
        recommendation: trace.recommendation,
        confirmedLikelihood: trace.confirmedLikelihood,
        result: trace.result,
      })
    : JSON.stringify({
        rule: trace.rule,
        randomInputs: trace.random.inputs,
        modifiers: trace.modifiers,
        result: trace.result,
      });

export const assembleNarrationEvidence = (
  input: NarrationEvidenceInput,
): EvidenceBundle => {
  const candidates: RankedEvidenceItem<EvidenceItem>[] = [];
  const add = (item: EvidenceItem, priority: number): void => {
    candidates.push({ item, priority, order: candidates.length });
  };

  const committedEvents = filterCanonicalEventsVisibleTo({
    actorScope: input.actorScope,
    events: input.committedEvents,
  });
  committedEvents.forEach((event, index) =>
    add(
      {
        id: `event:committed:${index}`,
        sourceKind: "accepted-event",
        sourceReference: `adventure-event:${event.id}`,
        content: acceptedEventContent(event),
        inclusionReason:
          "This accepted event is part of the committed outcome being narrated.",
      },
      0,
    ),
  );
  if (input.resolutionTrace !== null) {
    add(
      {
        id: "resolution:committed",
        sourceKind: "resolution",
        sourceReference: "projected-state:committed-resolution",
        content: resolutionContent(input.resolutionTrace),
        inclusionReason:
          "This Player-visible accepted resolution trace defines the outcome.",
      },
      0,
    );
    add(narrationRule(input.resolutionTrace), 0);
  }

  const involvedEntity = input.resolutionTrace === null
    ? null
    : directlyInvolvedEntity(input.resolutionTrace, committedEvents);
  if (involvedEntity !== null) add(involvedEntity, 1);
  if (
    input.playerCharacter !== null &&
    input.resolutionTrace !== null &&
    input.resolutionTrace.rule.id === "micro-ruleset.check"
  ) {
    add(
      {
        id: "entity:player-character",
        sourceKind: "direct-entity",
        sourceReference: "player-character",
        content: JSON.stringify({
          name: input.playerCharacter.name,
          pronouns: input.playerCharacter.pronouns,
        }),
        inclusionReason:
          "This Player-visible Player Character is directly involved in the committed outcome.",
      },
      1,
    );
  }
  if (input.activeScene !== null) {
    add(
      {
        id: `entity:scene:${input.activeScene}`,
        sourceKind: "direct-entity",
        sourceReference: `scene:${input.activeScene}`,
        content: input.activeScene,
        inclusionReason:
          "This Player-visible Scene contains the committed outcome.",
      },
      1,
    );
  }

  const committedContent = [
    ...committedEvents.map(acceptedEventContent),
    ...(input.resolutionTrace === null
      ? []
      : [resolutionContent(input.resolutionTrace)]),
  ].join(" ");
  projectWorldKnowledge({
    actorScope: input.actorScope,
    events: input.acceptedEvents,
  }).entries
    .filter(
      (entry) =>
        committedContent.includes(entry.id) ||
        committedContent.includes(worldKnowledgeContent(entry)),
    )
    .forEach((entry) =>
      add(
        worldKnowledgeEvidenceItem(entry, "committed outcome"),
        1,
      ),
    );

  const maxItems = Math.max(1, input.maxItems ?? 64);
  const items = selectRankedEvidence(candidates, maxItems);
  return immutableSnapshot({
    id: evidenceBundleId(items),
    taskType: "narrate-committed-outcome" as const,
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

const publishedCheckRule = (view: ApplicationView): EvidenceItem | null => {
  const rule = view.state.lastCheckResolution?.trace.rule;
  if (rule === undefined || !("sourcePassages" in rule)) return null;
  return {
    id: `rule:${rule.id}@${rule.version}`,
    sourceKind: "authority-rule",
    sourceReference: `rule-package:micro-ruleset@${rule.version}#${rule.sourcePassages
      .map(({ passageAnchor }) => passageAnchor)
      .join(",")}`,
    content: rule.sourcePassages.map(({ text }) => text).join(" "),
    inclusionReason:
      "This exact approved package rule and its source passages govern the committed Check outcome.",
  };
};

const applicableRules = (
  query: string,
  view: ApplicationView,
): readonly EvidenceItem[] => {
  const normalizedQuery = normalized(query);
  const matching = AUTHORED_RULES.filter((rule) =>
    rule.terms.some((term) => normalizedQuery.includes(normalized(term))),
  ).map((rule) => rule.item);
  const published = publishedCheckRule(view);
  const selected = matching.length > 0 ? matching : [AUTHORED_RULES[1]!.item];
  return published === null ? selected : [published, ...selected];
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
  const rules = applicableRules(input.utterance, input.view);
  const ranked: RankedEvidenceItem<EvidenceItem>[] = [
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
    id: evidenceBundleId(items),
    taskType: "explain-rules" as const,
    items,
  });
};
