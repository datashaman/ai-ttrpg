export type GameMasterTaskType =
  | "Ambiguous intent"
  | "Invalid proposal"
  | "Rule conflict"
  | "Ingestion review";

export type GameMasterDecision = "approve" | "edit" | "reject" | "override";

export interface GameMasterCommand {
  readonly type: "choose-action";
  readonly actionId: string;
}

export interface GameMasterQueueItem {
  readonly id: string;
  readonly revision: number;
  readonly status: "Under review" | "Committed";
  readonly taskType: GameMasterTaskType;
  readonly actor: { readonly kind: "Player" | "Game Master" | "Importer"; readonly label: string };
  readonly campaign: { readonly id: string; readonly title: string };
  readonly createdAt: string;
  readonly age: string;
  readonly playerInput: string;
  readonly evidence: { readonly bundleId: string; readonly summary: string; readonly itemCount: number };
  readonly validationFindings: readonly string[];
  readonly allowedInterventions: readonly GameMasterDecision[];
  readonly candidateCommand: GameMasterCommand | null;
  readonly allowedCommands: readonly { readonly command: GameMasterCommand; readonly label: string }[];
}

export interface GameMasterProjection {
  readonly campaignId: string;
  readonly scene: string;
  readonly acceptedEventCount: number;
  readonly establishedFacts: readonly string[];
  readonly lastOutcomeEventId: string | null;
}

export interface GameMasterAuditRecord {
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly actor: { readonly kind: "Game Master" };
  readonly itemId: string;
  readonly decision: GameMasterDecision;
  readonly candidateCommand: GameMasterCommand | null;
  readonly submittedCommand: GameMasterCommand | null;
  readonly outcome: "accepted" | "rejected";
  readonly acceptedEventIds: readonly string[];
}

export interface GameMasterWorkspace {
  readonly campaign: { readonly id: string; readonly title: string };
  readonly status: "Action required";
  readonly queue: readonly GameMasterQueueItem[];
  readonly recentNarration: { readonly outcomeId: string; readonly text: string; readonly traceHref: string };
}

export interface GameMasterOutcomeTrace {
  readonly id: string;
  readonly narration: { readonly id: string; readonly status: "Retained"; readonly source: "Narrator"; readonly text: string; readonly modelCallIds: readonly string[] };
  readonly evidenceBundle: { readonly id: string; readonly items: readonly { readonly id: string; readonly source: string; readonly inclusionReason: string; readonly citation: string }[] };
  readonly rule: { readonly id: string; readonly packageVersion: string; readonly sourcePassages: readonly { readonly id: string; readonly citation: string; readonly text: string }[] };
  readonly modelCall: { readonly id: string; readonly taskType: "narrate-committed-outcome"; readonly provider: string; readonly model: string; readonly promptVersion: string; readonly evidenceBundleId: string; readonly validation: "accepted"; readonly retryCount: number };
  readonly command: { readonly id: string; readonly input: { readonly type: string; readonly summary: string } };
  readonly events: readonly { readonly id: string; readonly commandId: string; readonly type: string; readonly summary: string }[];
  readonly randomTrace: { readonly eventId: string; readonly seed: number | null; readonly position: number; readonly rolls: readonly number[] };
  readonly projection: GameMasterProjection;
}

export interface GameMasterIntervention {
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly decision: GameMasterDecision;
  readonly command?: GameMasterCommand;
}

export type GameMasterInterventionResult =
  | { readonly status: "accepted"; readonly message: string; readonly auditRecord: GameMasterAuditRecord; readonly committedEvents: readonly { readonly id: string; readonly type: string }[]; readonly workspace: GameMasterWorkspace }
  | { readonly status: "rejected"; readonly code: "ACTOR_NOT_AUTHORIZED" | "IDEMPOTENCY_CONFLICT" | "INVALID_INTERVENTION" | "STALE_WORK" | "WORK_NOT_FOUND" | "COMMAND_REJECTED"; readonly message: string; readonly auditRecord: null; readonly committedEvents: readonly [] };

export interface GameMasterApplicationClient {
  selectGameMasterScope(): Promise<void>;
  readWorkspace(campaignId: string): Promise<GameMasterWorkspace>;
  readOutcomeTrace(campaignId: string, outcomeId: string): Promise<GameMasterOutcomeTrace>;
  intervene(campaignId: string, intervention: GameMasterIntervention): Promise<GameMasterInterventionResult>;
  retryNarration(campaignId: string, outcomeId: string): Promise<{ readonly status: "Retained" | "Recoverable error"; readonly message: string }>;
}
