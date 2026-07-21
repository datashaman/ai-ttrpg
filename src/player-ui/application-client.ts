import type {
  Likelihood,
  ResolveChoice,
  Trait,
  TraitRatings,
} from "../structured-play.js";

export type PlayerCommand =
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
  readonly summary: string;
  readonly mechanic: PlayerMechanicTrace;
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
}

export interface PlayerCommandResponse {
  readonly status: "accepted" | "rejected";
  readonly message: string;
  readonly projection: PlayerAdventureProjection;
}

export interface ApplicationClient {
  readPlayerAdventure(adventureId: string): Promise<PlayerAdventureProjection>;
  submitPlayerCommand(
    adventureId: string,
    command: PlayerCommand,
  ): Promise<PlayerCommandResponse>;
}
