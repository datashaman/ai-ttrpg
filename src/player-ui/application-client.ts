import type {
  Likelihood,
  ResolveChoice,
  Trait,
  TraitRatings,
} from "../structured-play.js";
import type {
  PlayerPresentationEvent,
  PlayerRetainedPresentation,
} from "./player-presentation.js";
import type { GameMasterApplicationClient } from "../gm-ui/application-client.js";

export type PlayerAdventureCommand =
  | {
      readonly type: "configure-player-character";
      readonly name: string;
      readonly pronouns: string;
      readonly motivation: string;
      readonly traits: TraitRatings;
    }
  | { readonly type: "begin-adventure" }
  | { readonly type: "choose-action"; readonly actionId: string }
  | { readonly type: "confirm-check-proposal"; readonly proposalId: string }
  | {
      readonly type: "resolve-pending-check";
      readonly pendingChoiceId: string;
      readonly choice: ResolveChoice;
    }
  | {
      readonly type: "confirm-oracle-likelihood";
      readonly recommendationId: string;
      readonly likelihood: Likelihood;
    };

export type PlayerCommand =
  | PlayerAdventureCommand
  | {
      readonly type: "set-input-mode";
      readonly mode: "structured" | "natural-language";
    }
  | { readonly type: "submit-natural-language"; readonly utterance: string }
  | {
      readonly type: "confirm-natural-language-command";
      readonly proposalId: string;
    };

export interface PlayerActionOption {
  readonly id: string;
  readonly label: string;
  readonly kind: "Free Action" | "Check" | "Oracle" | "Recovery";
}

export interface PlayerMechanicTrace {
  readonly ruleReference: string | null;
  readonly calculation: string | null;
  readonly evidenceBundle: {
    readonly id: string;
    readonly references: readonly string[];
  };
}

export interface PlayerLedgerEntry {
  readonly id: string;
  readonly status: "Committed";
  readonly action: string;
  readonly presentation: "Deterministic summary";
  readonly narrationStatus: "Unavailable";
  readonly inputMode: "Structured Play" | "Natural Language Play";
  readonly interpretation: PlayerEvidenceTrace | null;
  readonly summary: string;
  readonly mechanic: PlayerMechanicTrace;
}

export interface PlayerEvidenceItem {
  readonly id: string;
  readonly sourceKind: string;
  readonly sourceReference: string;
  readonly content: string;
  readonly inclusionReason: string;
  readonly citation: string | null;
}

export interface PlayerEvidenceTrace {
  readonly modelCallIds: readonly string[];
  readonly evidenceBundleIds: readonly string[];
  readonly bundleItemIds: readonly string[];
  readonly citedEvidenceItemIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly evidence: readonly PlayerEvidenceItem[];
}

export interface PlayerNaturalLanguageProposal extends PlayerEvidenceTrace {
  readonly id: string;
  readonly utterance: string;
  readonly actionLabel: string;
  readonly command: { readonly type: "choose-action"; readonly actionId: string };
}

export interface PlayerNaturalLanguageResponse extends PlayerEvidenceTrace {
  readonly kind:
    | "clarification"
    | "rules-answer"
    | "acknowledgement"
    | "provider-failure"
    | "provider-unavailable";
  readonly status:
    | "Action required"
    | "Provisional"
    | "Recoverable error"
    | "Unavailable";
  readonly message: string;
}

export interface PlayerCheckProposal {
  readonly id: string;
  readonly goal: string;
  readonly trait: Trait;
  readonly stakes: {
    readonly setback: string;
    readonly successWithCost: string;
    readonly cleanSuccess: string;
  };
}

export interface PlayerPendingChoice {
  readonly id: string;
  readonly formula: string;
  readonly total: number;
  readonly canSpendResolve: boolean;
}

export interface PlayerOracleConfirmation {
  readonly id: string;
  readonly proposition: string;
  readonly recommendation: Likelihood;
  readonly supportingFacts: readonly string[];
}

export interface PlayerAdventureProjection {
  readonly id: string;
  readonly title: string;
  readonly playerCharacter: null | {
    readonly name: string;
    readonly pronouns: string;
    readonly motivation: string;
    readonly traits: TraitRatings;
    readonly health: number;
    readonly resolve: number;
    readonly inventory: readonly {
      readonly name: string;
      readonly state: "carried" | "removed";
    }[];
  };
  readonly activeScene: null | {
    readonly id: string;
    readonly title: string;
  };
  readonly conditions: readonly string[];
  readonly clocks: readonly {
    readonly name: "Resistance" | "Danger";
    readonly current: number;
    readonly capacity: number;
  }[];
  readonly relationships: readonly {
    readonly id: string;
    readonly content: string;
  }[];
  readonly availableActions: readonly PlayerActionOption[];
  readonly pendingCheckProposal: PlayerCheckProposal | null;
  readonly pendingChoice: PlayerPendingChoice | null;
  readonly oracleConfirmation: PlayerOracleConfirmation | null;
  readonly ledger: readonly PlayerLedgerEntry[];
  readonly inputMode: "structured" | "natural-language";
  readonly naturalLanguage: {
    readonly available: boolean;
    readonly pendingProposal: PlayerNaturalLanguageProposal | null;
    readonly response: PlayerNaturalLanguageResponse | null;
  };
}

export interface PlayerCommandResponse {
  readonly status: "accepted" | "rejected";
  readonly message: string;
  readonly projection: PlayerAdventureProjection;
  readonly canonicalCommand: PlayerAdventureCommand | null;
  readonly canonicalEventTypes: readonly string[];
  readonly canonicalEvents: readonly {
    readonly type: string;
    readonly payload: unknown;
  }[];
}

export interface ApplicationClient extends GameMasterApplicationClient {
  readPlayerAdventure(adventureId: string): Promise<PlayerAdventureProjection>;
  readPlayerPresentations(
    adventureId: string,
  ): Promise<readonly PlayerRetainedPresentation[]>;
  submitPlayerCommand(
    adventureId: string,
    command: PlayerCommand,
  ): Promise<PlayerCommandResponse>;
  streamPlayerPresentation(
    adventureId: string,
    outcomeEventId: string,
    options?: {
      readonly regenerate?: boolean;
      readonly signal?: AbortSignal;
    },
  ): AsyncIterable<PlayerPresentationEvent>;
}
