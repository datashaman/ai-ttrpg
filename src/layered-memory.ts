import { immutableSnapshot } from "./model-boundary.js";
import type {
  Condition,
  ConfrontationState,
  EstablishedFact,
  PlayerCharacter,
  Scene,
} from "./structured-play.js";

export const CONVERSATION_CLASSIFICATIONS = [
  "player-action",
  "in-character-speech",
  "rules-query",
  "out-of-character-request",
  "table-chat",
  "system-command",
] as const;

export type ConversationClassification =
  (typeof CONVERSATION_CLASSIFICATIONS)[number];

export const isConversationClassification = (
  value: unknown,
): value is ConversationClassification =>
  CONVERSATION_CLASSIFICATIONS.some((classification) => classification === value);

export interface ConversationRecord {
  readonly id: string;
  readonly classification: ConversationClassification;
  readonly content: string;
}

export interface ConversationStore {
  enterScope(scope: ConversationScope): void;
  append(record: ConversationRecord): void;
  readAll(): readonly ConversationRecord[];
  clear(): void;
}

export interface ConversationScope {
  readonly timelineId: string | null;
  readonly scene: Scene | null;
}

export const createInMemoryConversationStore = (): ConversationStore => {
  let activeScope: ConversationScope | null = null;
  let records: ConversationRecord[] = [];
  return {
    enterScope: (scope) => {
      if (
        scope.timelineId === activeScope?.timelineId &&
        scope.scene === activeScope.scene
      ) {
        return;
      }
      activeScope = immutableSnapshot(scope);
      records = [];
    },
    append: (record) => {
      records.push(immutableSnapshot(record));
    },
    readAll: () => immutableSnapshot(records),
    clear: () => {
      records = [];
    },
  };
};

export interface LayeredMemoryView {
  readonly ownership: {
    readonly canonicalEvents: "event-store";
    readonly adventure: "event-derived-projection";
    readonly confrontation: "event-derived-projection";
    readonly worldKnowledge: "canonical-event-projection";
    readonly conversation: "conversation-store";
    readonly integrations: "adapters";
  };
  readonly adventure: {
    readonly playerCharacter: PlayerCharacter | null;
    readonly conditions: readonly Condition[];
    readonly establishedFacts: readonly EstablishedFact[];
  };
  readonly confrontation: {
    readonly state: ConfrontationState | null;
  };
  readonly conversation: {
    readonly records: readonly ConversationRecord[];
  };
}

export const layeredMemoryView = ({
  playerCharacter,
  conditions,
  establishedFacts,
  confrontation,
  conversationStore,
}: {
  readonly playerCharacter: PlayerCharacter | null;
  readonly conditions: readonly Condition[];
  readonly establishedFacts: readonly EstablishedFact[];
  readonly confrontation: ConfrontationState | null;
  readonly conversationStore: ConversationStore;
}): LayeredMemoryView =>
  immutableSnapshot({
    ownership: {
      canonicalEvents: "event-store",
      adventure: "event-derived-projection",
      confrontation: "event-derived-projection",
      worldKnowledge: "canonical-event-projection",
      conversation: "conversation-store",
      integrations: "adapters",
    },
    adventure: {
      playerCharacter,
      conditions,
      establishedFacts,
    },
    confrontation: { state: confrontation },
    conversation: { records: conversationStore.readAll() },
  });
