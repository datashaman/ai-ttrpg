import { createHash } from "node:crypto";

import { canonicalJson, immutableSnapshot } from "../model-boundary.js";

export type GameMasterTaskType =
  | "Ambiguous intent"
  | "Invalid proposal"
  | "Rule conflict"
  | "Ingestion review";

export type GameMasterDecision = "approve" | "edit" | "reject" | "override";

export type GameMasterCommand =
  | { readonly type: "choose-action"; readonly actionId: string }
  | { readonly type: "publish-rule-candidate"; readonly candidateId: string };

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
  readonly evidence: {
    readonly bundleId: string;
    readonly summary: string;
    readonly itemCount: number;
  };
  readonly validationFindings: readonly string[];
  readonly allowedInterventions: readonly GameMasterDecision[];
  readonly candidateCommand: GameMasterCommand | null;
}

export interface GameMasterProjection {
  readonly campaignId: string;
  readonly scene: string;
  readonly acceptedEventCount: number;
  readonly establishedFacts: readonly string[];
  readonly lastOutcomeEventId: string | null;
}

export interface GameMasterCanonicalEvent {
  readonly id: string;
  readonly commandId: string;
  readonly type: "CheckResolved" | "FreeActionCompleted" | "RuleCandidatePublished";
  readonly payload: {
    readonly establishedFact: string;
    readonly scene: string;
    readonly random?: {
      readonly seed: number;
      readonly position: number;
      readonly rolls: readonly number[];
    };
  };
}

export interface GameMasterAuditRecord {
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly actor: { readonly kind: "Game Master" };
  readonly itemId: string;
  readonly decision: GameMasterDecision;
  readonly command: GameMasterCommand | null;
  readonly acceptedEventIds: readonly string[];
}

export interface GameMasterSessionSnapshot {
  readonly queue: readonly GameMasterQueueItem[];
  readonly canonicalEvents: readonly GameMasterCanonicalEvent[];
  readonly projection: GameMasterProjection;
  readonly auditRecords: readonly GameMasterAuditRecord[];
}

export interface GameMasterWorkspace {
  readonly campaign: { readonly id: string; readonly title: string };
  readonly status: "Action required";
  readonly queue: readonly GameMasterQueueItem[];
  readonly recentNarration: {
    readonly outcomeId: string;
    readonly text: string;
    readonly traceHref: string;
  };
}

export interface GameMasterOutcomeTrace {
  readonly id: string;
  readonly queueItem: GameMasterQueueItem;
  readonly narration: {
    readonly id: string;
    readonly status: "Retained";
    readonly source: "Narrator";
    readonly text: string;
    readonly modelCallIds: readonly string[];
  };
  readonly evidenceBundle: {
    readonly id: string;
    readonly items: readonly {
      readonly id: string;
      readonly source: string;
      readonly inclusionReason: string;
      readonly citation: string;
    }[];
  };
  readonly rule: {
    readonly id: string;
    readonly packageVersion: string;
    readonly sourcePassages: readonly {
      readonly id: string;
      readonly citation: string;
      readonly text: string;
    }[];
  };
  readonly modelCall: {
    readonly id: string;
    readonly taskType: "narrate-committed-outcome";
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly evidenceBundleId: string;
    readonly validation: "accepted";
    readonly retryCount: number;
  };
  readonly command: { readonly id: string; readonly input: GameMasterCommand };
  readonly events: readonly GameMasterCanonicalEvent[];
  readonly randomTrace: {
    readonly eventId: string;
    readonly seed: number;
    readonly position: number;
    readonly rolls: readonly number[];
  };
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
  | {
      readonly status: "accepted";
      readonly message: string;
      readonly auditRecord: GameMasterAuditRecord;
      readonly committedEvents: readonly GameMasterCanonicalEvent[];
      readonly workspace: GameMasterWorkspace;
    }
  | {
      readonly status: "rejected";
      readonly code:
        | "ACTOR_NOT_AUTHORIZED"
        | "IDEMPOTENCY_CONFLICT"
        | "INVALID_INTERVENTION"
        | "STALE_WORK"
        | "WORK_NOT_FOUND";
      readonly message: string;
      readonly auditRecord: null;
      readonly committedEvents: readonly [];
    };

const CAMPAIGN = { id: "locked-manor", title: "The Locked Manor" } as const;

const queueFixture = (): GameMasterQueueItem[] => [
  {
    id: "review:ambiguous-intent",
    revision: 1,
    status: "Under review",
    taskType: "Ambiguous intent",
    actor: { kind: "Player", label: "Mara Vey" },
    campaign: CAMPAIGN,
    createdAt: "2026-07-21T12:00:00.000Z",
    age: "18 minutes old",
    playerInput: "I deal with the person by the door.",
    evidence: { bundleId: "evidence:ambiguous-intent", summary: "Scene, visible actors, and available actions", itemCount: 3 },
    validationFindings: ["The referenced person and intended action are ambiguous."],
    allowedInterventions: ["reject", "override"],
    candidateCommand: null,
  },
  {
    id: "review:invalid-proposal",
    revision: 1,
    status: "Under review",
    taskType: "Invalid proposal",
    actor: { kind: "Player", label: "Mara Vey" },
    campaign: CAMPAIGN,
    createdAt: "2026-07-21T12:04:00.000Z",
    age: "14 minutes old",
    playerInput: "I open the barred cellar door.",
    evidence: { bundleId: "evidence:invalid-proposal", summary: "Player input and scoped capabilities", itemCount: 2 },
    validationFindings: ["The proposed capability is unavailable in the active Scene."],
    allowedInterventions: ["edit", "reject", "override"],
    candidateCommand: null,
  },
  {
    id: "review:rule-conflict",
    revision: 1,
    status: "Under review",
    taskType: "Rule conflict",
    actor: { kind: "Player", label: "Mara Vey" },
    campaign: CAMPAIGN,
    createdAt: "2026-07-21T12:06:00.000Z",
    age: "12 minutes old",
    playerInput: "I survey the muddy tracks before entering.",
    evidence: { bundleId: "evidence:side-door", summary: "Committed outcome, Check rule, and visible Scene facts", itemCount: 4 },
    validationFindings: ["Two supplied rules could govern the attempted survey."],
    allowedInterventions: ["approve", "edit", "reject", "override"],
    candidateCommand: { type: "choose-action", actionId: "survey-manor" },
  },
  {
    id: "review:ingestion",
    revision: 1,
    status: "Under review",
    taskType: "Ingestion review",
    actor: { kind: "Importer", label: "Rule Source importer" },
    campaign: CAMPAIGN,
    createdAt: "2026-07-21T12:09:00.000Z",
    age: "9 minutes old",
    playerInput: "Review candidate micro-ruleset.check@1.1.0.",
    evidence: { bundleId: "evidence:rule-review", summary: "Rule Candidate, diff, and exact source passages", itemCount: 5 },
    validationFindings: ["One normalized field is an Authored Interpretation."],
    allowedInterventions: ["approve", "reject"],
    candidateCommand: { type: "publish-rule-candidate", candidateId: "micro-ruleset.check@1.1.0" },
  },
];

const initialEvent = (): GameMasterCanonicalEvent => ({
  id: "event:side-door",
  commandId: "command:side-door",
  type: "CheckResolved",
  payload: {
    establishedFact: "The side door opens, but the scrape of its lock carries into the manor.",
    scene: "Discovery",
    random: { seed: 690, position: 4, rolls: [3, 4] },
  },
});

const project = (
  events: readonly GameMasterCanonicalEvent[],
): GameMasterProjection => ({
  campaignId: CAMPAIGN.id,
  scene: events.at(-1)?.payload.scene ?? "Arrival",
  acceptedEventCount: events.length,
  establishedFacts: events.map(({ payload }) => payload.establishedFact),
  lastOutcomeEventId: events.at(-1)?.id ?? null,
});

const initialSnapshot = (): GameMasterSessionSnapshot => {
  const canonicalEvents = [initialEvent()];
  return immutableSnapshot({
    queue: queueFixture(),
    canonicalEvents,
    projection: project(canonicalEvents),
    auditRecords: [],
  });
};

const fingerprint = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

const traceFixture = (
  queueItem: GameMasterQueueItem,
  projection: GameMasterProjection,
  event: GameMasterCanonicalEvent,
): GameMasterOutcomeTrace => ({
  id: "trace:side-door",
  queueItem,
  narration: {
    id: "narration:side-door",
    status: "Retained",
    source: "Narrator",
    text: "The lock yields with a hard scrape. Beyond the opening, floorboards answer from deeper in the manor.",
    modelCallIds: ["model-call:side-door"],
  },
  evidenceBundle: {
    id: "evidence:side-door",
    items: [
      { id: "evidence-item:outcome", source: "Accepted event event:side-door", inclusionReason: "Ground the committed outcome.", citation: "timeline:locked-manor#event:side-door" },
      { id: "evidence-item:rule", source: "Executable Ruleset Package", inclusionReason: "Explain the governing Check outcome.", citation: "micro-ruleset@1.0.0#checks.outcomes.success-with-cost" },
    ],
  },
  rule: {
    id: "micro-ruleset.check",
    packageVersion: "micro-ruleset@1.0.0",
    sourcePassages: [
      { id: "passage:checks-procedure", citation: "micro-ruleset@1.0.0#checks.procedure", text: "Roll two six-sided dice and add the relevant Trait." },
      { id: "passage:success-with-cost", citation: "micro-ruleset@1.0.0#checks.outcomes.success-with-cost", text: "A total from seven through nine achieves the goal with a meaningful cost." },
    ],
  },
  modelCall: {
    id: "model-call:side-door",
    taskType: "narrate-committed-outcome",
    provider: "configured-provider",
    model: "configured-model",
    promptVersion: "narrate-committed-outcome-v1",
    evidenceBundleId: "evidence:side-door",
    validation: "accepted",
    retryCount: 0,
  },
  command: {
    id: "command:side-door",
    input: { type: "choose-action", actionId: "pick-side-door-lock" },
  },
  events: [event],
  randomTrace: {
    eventId: event.id,
    seed: event.payload.random!.seed,
    position: event.payload.random!.position,
    rolls: event.payload.random!.rolls,
  },
  projection,
});

const interventionEvent = (
  command: GameMasterCommand,
  index: number,
): GameMasterCanonicalEvent => ({
  id: `event:gm-intervention:${index}`,
  commandId: `command:gm-intervention:${index}`,
  type:
    command.type === "publish-rule-candidate"
      ? "RuleCandidatePublished"
      : "FreeActionCompleted",
  payload: {
    establishedFact:
      command.type === "publish-rule-candidate"
        ? `Rule Candidate ${command.candidateId} was published through an approved Rule Review.`
        : "Mara surveys the manor grounds and confirms that the tracks lead to the side door.",
    scene: "Discovery",
  },
});

export interface DeterministicGameMasterSession {
  workspace(campaignId: string): GameMasterWorkspace;
  trace(campaignId: string, outcomeId: string): GameMasterOutcomeTrace;
  intervene(campaignId: string, intervention: GameMasterIntervention): Promise<GameMasterInterventionResult>;
  retryNarration(campaignId: string, outcomeId: string): Promise<{
    readonly status: "Retained" | "Recoverable error";
    readonly message: string;
  }>;
  replayAudit(campaignId: string): {
    readonly status: "verified";
    readonly acceptedEventIds: readonly string[];
    readonly projection: GameMasterProjection;
  };
  snapshot(): GameMasterSessionSnapshot;
}

export const createDeterministicGameMasterSession = ({
  actor,
  snapshot = initialSnapshot(),
  regenerateNarration = async () => traceFixture(
    snapshot.queue.find(({ id }) => id === "review:rule-conflict")!,
    snapshot.projection,
    snapshot.canonicalEvents[0]!,
  ).narration.text,
}: {
  readonly actor:
    | { readonly kind: "Game Master"; readonly campaignIds: readonly string[] }
    | { readonly kind: "Player"; readonly playerCharacterId: string };
  readonly snapshot?: GameMasterSessionSnapshot;
  readonly regenerateNarration?: () => Promise<string>;
}): DeterministicGameMasterSession => {
  let queue = structuredClone(snapshot.queue) as GameMasterQueueItem[];
  let canonicalEvents = structuredClone(snapshot.canonicalEvents) as GameMasterCanonicalEvent[];
  let projection = structuredClone(snapshot.projection);
  let auditRecords = structuredClone(snapshot.auditRecords) as GameMasterAuditRecord[];

  const authorized = (campaignId: string): boolean =>
    actor.kind === "Game Master" && actor.campaignIds.includes(campaignId);
  const assertAuthorized = (campaignId: string): void => {
    if (!authorized(campaignId)) {
      throw new Error("The local actor is not authorized for this campaign.");
    }
  };
  const workspace = (campaignId: string): GameMasterWorkspace => {
    assertAuthorized(campaignId);
    return immutableSnapshot({
      campaign: CAMPAIGN,
      status: "Action required" as const,
      queue: queue.filter(({ campaign }) => campaign.id === campaignId),
      recentNarration: {
        outcomeId: "outcome:side-door",
        text: traceFixture(queue[2]!, projection, canonicalEvents[0]!).narration.text,
        traceHref: `/gm/campaigns/${campaignId}/outcomes/outcome%3Aside-door/trace`,
      },
    });
  };

  return {
    workspace,
    trace: (campaignId, outcomeId) => {
      assertAuthorized(campaignId);
      if (outcomeId !== "outcome:side-door") throw new Error("Outcome trace not found.");
      return immutableSnapshot(
        traceFixture(
          queue.find(({ id }) => id === "review:rule-conflict")!,
          project([canonicalEvents[0]!]),
          canonicalEvents[0]!,
        ),
      );
    },
    intervene: async (campaignId, intervention) => {
      if (!authorized(campaignId)) {
        return immutableSnapshot({
          status: "rejected" as const,
          code: "ACTOR_NOT_AUTHORIZED" as const,
          message: "The local actor is not authorized for this campaign.",
          auditRecord: null,
          committedEvents: [] as const,
        });
      }
      const requestFingerprint = fingerprint(intervention);
      const existing = auditRecords.find(
        ({ idempotencyKey }) => idempotencyKey === intervention.idempotencyKey,
      );
      if (existing !== undefined) {
        if (existing.fingerprint !== requestFingerprint) {
          return immutableSnapshot({
            status: "rejected" as const,
            code: "IDEMPOTENCY_CONFLICT" as const,
            message: "That intervention key was already used for different review work.",
            auditRecord: null,
            committedEvents: [] as const,
          });
        }
        const events = canonicalEvents.filter(({ id }) => existing.acceptedEventIds.includes(id));
        return immutableSnapshot({
          status: "accepted" as const,
          message: "The original Game Master intervention was returned.",
          auditRecord: existing,
          committedEvents: events,
          workspace: workspace(campaignId),
        });
      }
      const index = queue.findIndex(({ id }) => id === intervention.itemId);
      const item = queue[index];
      if (item === undefined) {
        return immutableSnapshot({
          status: "rejected" as const,
          code: "WORK_NOT_FOUND" as const,
          message: "That review work is not available.",
          auditRecord: null,
          committedEvents: [] as const,
        });
      }
      if (item.revision !== intervention.expectedRevision || item.status !== "Under review") {
        return immutableSnapshot({
          status: "rejected" as const,
          code: "STALE_WORK" as const,
          message: "The review work changed before this intervention was submitted.",
          auditRecord: null,
          committedEvents: [] as const,
        });
      }
      if (!item.allowedInterventions.includes(intervention.decision)) {
        return immutableSnapshot({
          status: "rejected" as const,
          code: "INVALID_INTERVENTION" as const,
          message: "That intervention is not valid for this review work.",
          auditRecord: null,
          committedEvents: [] as const,
        });
      }
      const command =
        intervention.decision === "approve"
          ? item.candidateCommand
          : intervention.decision === "edit" || intervention.decision === "override"
            ? intervention.command ?? null
            : null;
      if (intervention.decision !== "reject" && command === null) {
        return immutableSnapshot({
          status: "rejected" as const,
          code: "INVALID_INTERVENTION" as const,
          message: "This intervention requires one validated command.",
          auditRecord: null,
          committedEvents: [] as const,
        });
      }

      const committedEvents = command === null
        ? []
        : [interventionEvent(command, canonicalEvents.length)];
      canonicalEvents = [...canonicalEvents, ...committedEvents];
      projection = project(canonicalEvents);
      queue[index] = { ...item, revision: item.revision + 1, status: "Committed" };
      const auditRecord: GameMasterAuditRecord = {
        idempotencyKey: intervention.idempotencyKey,
        fingerprint: requestFingerprint,
        actor: { kind: "Game Master" },
        itemId: item.id,
        decision: intervention.decision,
        command,
        acceptedEventIds: committedEvents.map(({ id }) => id),
      };
      auditRecords = [...auditRecords, auditRecord];
      return immutableSnapshot({
        status: "accepted" as const,
        message: command === null
          ? "The review work was rejected without changing canonical game state."
          : "The validated Game Master command was accepted.",
        auditRecord,
        committedEvents,
        workspace: workspace(campaignId),
      });
    },
    retryNarration: async (campaignId, outcomeId) => {
      assertAuthorized(campaignId);
      if (outcomeId !== "outcome:side-door") throw new Error("Outcome trace not found.");
      try {
        const text = await regenerateNarration();
        if (text.trim().length === 0) throw new Error("Empty Narration");
        return immutableSnapshot({
          status: "Retained" as const,
          message: "Narration was regenerated from the committed presentation snapshot.",
        });
      } catch {
        return immutableSnapshot({
          status: "Recoverable error" as const,
          message: "Narration is unavailable. The committed outcome is safe.",
        });
      }
    },
    replayAudit: (campaignId) => {
      assertAuthorized(campaignId);
      const replayed = project(canonicalEvents);
      if (canonicalJson(replayed) !== canonicalJson(projection)) {
        throw new Error("Audit replay did not reproduce the authoritative projection.");
      }
      return immutableSnapshot({
        status: "verified" as const,
        acceptedEventIds: canonicalEvents.map(({ id }) => id),
        projection: replayed,
      });
    },
    snapshot: () => immutableSnapshot({ queue, canonicalEvents, projection, auditRecords }),
  };
};
