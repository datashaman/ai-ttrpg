import { createHash } from "node:crypto";

import { canonicalJson, immutableSnapshot } from "../model-boundary.js";
import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type CanonicalEvent,
  type EventStore,
  type StructuredPlayApplication,
} from "../structured-play.js";
import {
  committedRandomPosition,
  createSeededRandomSourceAtPosition,
} from "../random-source.js";
import type {
  GameMasterAuditRecord,
  GameMasterCommand,
  GameMasterIntervention,
  GameMasterInterventionResult,
  GameMasterOutcomeTrace,
  GameMasterProjection,
  GameMasterQueueItem,
  GameMasterWorkspace,
} from "./application-client.js";

const CAMPAIGN = { id: "locked-manor", title: "The Locked Manor" } as const;
const RANDOM_SEED = 690;
const TRACE_OUTCOME_ID = "outcome:side-door";
const TRACE_WORK_ID = "review:rule-conflict";

export interface GameMasterSessionSnapshot {
  readonly queue: readonly GameMasterQueueItem[];
  readonly canonicalEvents: readonly CanonicalEvent[];
  readonly projection: GameMasterProjection;
  readonly auditRecords: readonly GameMasterAuditRecord[];
}

const knownCommands = (
  application: StructuredPlayApplication,
): readonly { readonly command: GameMasterCommand; readonly label: string }[] =>
  application.view().availableActions
    .filter(({ kind }) => kind !== "Scene Transition")
    .map(({ id, label }) => ({ command: { type: "choose-action", actionId: id }, label }));

const queueFixture = (
  application: StructuredPlayApplication,
): GameMasterQueueItem[] => {
  const commands = knownCommands(application);
  const survey = commands.find(({ command }) => command.actionId === "survey-manor")?.command ?? null;
  return [
    {
      id: "review:ambiguous-intent", revision: 1, status: "Under review", taskType: "Ambiguous intent",
      actor: { kind: "Player", label: "Mara Vey" }, campaign: CAMPAIGN,
      createdAt: "2026-07-21T12:00:00.000Z", age: "18 minutes old",
      playerInput: "I deal with the person by the door.",
      evidence: { bundleId: "evidence:ambiguous-intent", summary: "Scene, visible actors, and available actions", itemCount: 3 },
      validationFindings: ["The referenced person and intended action are ambiguous."],
      allowedInterventions: ["reject", "override"], candidateCommand: null, allowedCommands: commands,
    },
    {
      id: "review:invalid-proposal", revision: 1, status: "Under review", taskType: "Invalid proposal",
      actor: { kind: "Player", label: "Mara Vey" }, campaign: CAMPAIGN,
      createdAt: "2026-07-21T12:04:00.000Z", age: "14 minutes old",
      playerInput: "I open the barred cellar door.",
      evidence: { bundleId: "evidence:invalid-proposal", summary: "Player input and scoped capabilities", itemCount: 2 },
      validationFindings: ["The proposed capability is unavailable in the active Scene."],
      allowedInterventions: ["edit", "reject", "override"], candidateCommand: null, allowedCommands: commands,
    },
    {
      id: TRACE_WORK_ID, revision: 1, status: "Under review", taskType: "Rule conflict",
      actor: { kind: "Player", label: "Mara Vey" }, campaign: CAMPAIGN,
      createdAt: "2026-07-21T12:06:00.000Z", age: "12 minutes old",
      playerInput: "I survey the muddy tracks before entering.",
      evidence: { bundleId: "evidence:side-door", summary: "Committed outcome, Check rule, and visible Scene facts", itemCount: 4 },
      validationFindings: ["Two supplied rules could govern the attempted survey."],
      allowedInterventions: ["approve", "edit", "reject", "override"], candidateCommand: survey, allowedCommands: commands,
    },
    {
      id: "review:ingestion", revision: 1, status: "Under review", taskType: "Ingestion review",
      actor: { kind: "Importer", label: "Rule Source importer" }, campaign: CAMPAIGN,
      createdAt: "2026-07-21T12:09:00.000Z", age: "9 minutes old",
      playerInput: "Review candidate micro-ruleset.check@1.1.0.",
      evidence: { bundleId: "evidence:rule-review", summary: "Rule Candidate, diff, and exact source passages", itemCount: 5 },
      validationFindings: ["One normalized field is an Authored Interpretation."],
      allowedInterventions: ["reject"], candidateCommand: null, allowedCommands: [],
    },
  ];
};

const appendAll = (store: EventStore, events: readonly CanonicalEvent[]): void =>
  events.forEach((event) => store.append(structuredClone(event)));

const createApplication = (events: readonly CanonicalEvent[] = []) => {
  const eventStore = createInMemoryEventStore();
  appendAll(eventStore, events);
  const randomSource = createSeededRandomSourceAtPosition(
    RANDOM_SEED,
    committedRandomPosition(events),
  );
  return {
    eventStore,
    application: createStructuredPlayApplication({ eventStore, randomSource }),
  };
};

const seedFixtureOutcome = (
  application: StructuredPlayApplication,
): void => {
  application.submit({
    type: "configure-player-character", name: "Mara Vey", pronouns: "she/her",
    motivation: "Find her missing sister", traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  application.submit({ type: "begin-adventure" });
  application.submit({ type: "choose-action", actionId: "pick-side-door-lock" });
  const proposal = application.view().state.pendingCheckProposal;
  if (proposal === null) throw new Error("Fixture Check Proposal was unavailable.");
  application.submit({ type: "confirm-check-proposal", proposalId: proposal.id });
  const choice = application.view().state.pendingChoice;
  if (choice === null) throw new Error("Fixture Pending Choice was unavailable.");
  application.submit({ type: "resolve-pending-check", pendingChoiceId: choice.id, choice: "decline" });
};

const outcomeEvent = (events: readonly CanonicalEvent[]): Extract<CanonicalEvent, { type: "CheckResolved" }> => {
  const event = [...events].reverse().find(
    (candidate): candidate is Extract<CanonicalEvent, { type: "CheckResolved" }> =>
      candidate.type === "CheckResolved" && candidate.payload.actionId === "pick-side-door-lock",
  );
  if (event === undefined) throw new Error("Fixture outcome is unavailable.");
  return event;
};

const projectionFrom = (
  application: StructuredPlayApplication,
  events: readonly CanonicalEvent[],
): GameMasterProjection => {
  const state = application.view().state;
  const lastOutcome = [...events].reverse().find(({ type }) =>
    type === "CheckResolved" || type === "OracleAnswered" || type === "FreeActionCompleted");
  return immutableSnapshot({
    campaignId: CAMPAIGN.id,
    scene: state.activeScene ?? "Not started",
    acceptedEventCount: events.length,
    establishedFacts: state.establishedFacts.map(({ text }) => text),
    lastOutcomeEventId: lastOutcome?.id ?? null,
  });
};

const projectionAt = (
  events: readonly CanonicalEvent[],
  eventId: string,
): GameMasterProjection => {
  const end = events.findIndex(({ id }) => id === eventId);
  if (end < 0) throw new Error("Trace event is unavailable.");
  const bounded = events.slice(0, end + 1);
  const replay = createApplication(bounded);
  return projectionFrom(replay.application, bounded);
};

const traceFor = (events: readonly CanonicalEvent[]): GameMasterOutcomeTrace => {
  const event = outcomeEvent(events);
  const traceEvents = events.slice(0, events.findIndex(({ id }) => id === event.id) + 1);
  const random = event.payload.trace.random;
  return immutableSnapshot({
    id: "trace:side-door",
    narration: {
      id: "narration:side-door", status: "Retained" as const, source: "Narrator" as const,
      text: "The lock yields with a hard scrape. Beyond the opening, floorboards answer from deeper in the manor.",
      modelCallIds: ["model-call:side-door"],
    },
    evidenceBundle: {
      id: "evidence:side-door",
      items: [
        { id: "evidence-item:outcome", source: `Accepted event ${event.id}`, inclusionReason: "Ground the committed outcome.", citation: `timeline:locked-manor#${event.id}` },
        { id: "evidence-item:rule", source: "Executable Ruleset Package", inclusionReason: "Explain the governing Check outcome.", citation: "micro-ruleset@1.0.0#checks.outcomes" },
      ],
    },
    rule: {
      id: "micro-ruleset.check", packageVersion: "micro-ruleset@1.0.0",
      sourcePassages: [
        { id: "passage:checks-procedure", citation: "micro-ruleset@1.0.0#checks.procedure", text: "Roll two six-sided dice and add the relevant Trait." },
        { id: "passage:check-outcomes", citation: "micro-ruleset@1.0.0#checks.outcomes", text: "The final total selects Setback, Success with Cost, or Clean Success." },
      ],
    },
    modelCall: {
      id: "model-call:side-door", taskType: "narrate-committed-outcome" as const,
      provider: "configured-provider", model: "configured-model", promptVersion: "narrate-committed-outcome-v1",
      evidenceBundleId: "evidence:side-door", validation: "accepted" as const, retryCount: 0,
    },
    command: {
      id: event.causationId,
      input: { type: "resolve-pending-check", summary: `Resolve ${event.payload.goal} without spending Resolve.` },
    },
    events: [{ id: event.id, commandId: event.causationId, type: event.type, summary: event.payload.committedStake.summary }],
    randomTrace: {
      eventId: event.id, seed: random.seed,
      position: committedRandomPosition(traceEvents), rolls: random.inputs,
    },
    projection: projectionAt(events, event.id),
  });
};

const fingerprint = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

export interface DeterministicGameMasterSession {
  workspace(campaignId: string): GameMasterWorkspace;
  trace(campaignId: string, outcomeId: string): GameMasterOutcomeTrace;
  intervene(campaignId: string, intervention: GameMasterIntervention): Promise<GameMasterInterventionResult>;
  retryNarration(campaignId: string, outcomeId: string): Promise<{ readonly status: "Retained" | "Recoverable error"; readonly message: string }>;
  replayAudit(campaignId: string): { readonly status: "verified"; readonly acceptedEventIds: readonly string[]; readonly projection: GameMasterProjection };
  snapshot(): GameMasterSessionSnapshot;
}

export const createDeterministicGameMasterSession = ({
  actor,
  snapshot,
  regenerateNarration,
}: {
  readonly actor: { readonly kind: "Game Master"; readonly campaignIds: readonly string[] } | { readonly kind: "Player"; readonly playerCharacterId: string };
  readonly snapshot?: GameMasterSessionSnapshot;
  readonly regenerateNarration?: () => Promise<string>;
}): DeterministicGameMasterSession => {
  const runtime = createApplication(snapshot?.canonicalEvents);
  if (snapshot === undefined) seedFixtureOutcome(runtime.application);
  const narrationGenerator = regenerateNarration ??
    (async () => traceFor(runtime.eventStore.readAll()).narration.text);
  let queue = structuredClone(snapshot?.queue ?? queueFixture(runtime.application)) as GameMasterQueueItem[];
  let auditRecords = structuredClone(snapshot?.auditRecords ?? []) as GameMasterAuditRecord[];

  const authorized = (campaignId: string): boolean =>
    actor.kind === "Game Master" && actor.campaignIds.includes(campaignId);
  const assertAuthorized = (campaignId: string): void => {
    if (!authorized(campaignId)) throw new Error("The local actor is not authorized for this campaign.");
  };
  const workspace = (campaignId: string): GameMasterWorkspace => {
    assertAuthorized(campaignId);
    return immutableSnapshot({
      campaign: CAMPAIGN, status: "Action required" as const,
      queue: queue.filter(({ campaign }) => campaign.id === campaignId),
      recentNarration: {
        outcomeId: TRACE_OUTCOME_ID,
        text: traceFor(runtime.eventStore.readAll()).narration.text,
        traceHref: `/gm/campaigns/${campaignId}/outcomes/outcome%3Aside-door/trace`,
      },
    });
  };

  return {
    workspace,
    trace: (campaignId, requestedOutcomeId) => {
      assertAuthorized(campaignId);
      if (requestedOutcomeId !== TRACE_OUTCOME_ID) throw new Error("Outcome trace not found.");
      return traceFor(runtime.eventStore.readAll());
    },
    intervene: async (campaignId, intervention) => {
      const reject = (code: Extract<GameMasterInterventionResult, { status: "rejected" }>["code"], message: string): GameMasterInterventionResult =>
        immutableSnapshot({ status: "rejected" as const, code, message, auditRecord: null, committedEvents: [] as const });
      if (!authorized(campaignId)) return reject("ACTOR_NOT_AUTHORIZED", "The local actor is not authorized for this campaign.");
      const requestFingerprint = fingerprint(intervention);
      const existing = auditRecords.find(({ idempotencyKey }) => idempotencyKey === intervention.idempotencyKey);
      if (existing !== undefined) {
        if (existing.fingerprint !== requestFingerprint) return reject("IDEMPOTENCY_CONFLICT", "That intervention key was already used for different review work.");
        const events = runtime.eventStore.readAll().filter(({ id }) => existing.acceptedEventIds.includes(id));
        return immutableSnapshot({
          status: "accepted" as const, message: "The original Game Master intervention was returned.",
          auditRecord: existing, committedEvents: events.map(({ id, type }) => ({ id, type })), workspace: workspace(campaignId),
        });
      }
      const index = queue.findIndex(({ id }) => id === intervention.itemId);
      const item = queue[index];
      if (item === undefined) return reject("WORK_NOT_FOUND", "That review work is not available.");
      if (item.revision !== intervention.expectedRevision || item.status !== "Under review") return reject("STALE_WORK", "The review work changed before this intervention was submitted.");
      if (!item.allowedInterventions.includes(intervention.decision)) return reject("INVALID_INTERVENTION", "That intervention is not valid for this review work.");
      const submittedCommand = intervention.decision === "approve"
        ? item.candidateCommand
        : intervention.decision === "edit" || intervention.decision === "override"
          ? intervention.command ?? null
          : null;
      if (intervention.decision !== "reject" && submittedCommand === null) return reject("INVALID_INTERVENTION", "This intervention requires one validated command.");
      if (submittedCommand !== null && !item.allowedCommands.some(({ command }) => canonicalJson(command) === canonicalJson(submittedCommand))) {
        return reject("INVALID_INTERVENTION", "The submitted command is outside the validated capabilities for this work item.");
      }
      const beforeIds = new Set(runtime.eventStore.readAll().map(({ id }) => id));
      if (submittedCommand !== null) {
        const result = runtime.application.submit(submittedCommand);
        if (result.status === "rejected") return reject("COMMAND_REJECTED", result.message);
      }
      const committed = runtime.eventStore.readAll().filter(({ id }) => !beforeIds.has(id));
      queue[index] = { ...item, revision: item.revision + 1, status: "Committed" };
      const auditRecord: GameMasterAuditRecord = {
        idempotencyKey: intervention.idempotencyKey, fingerprint: requestFingerprint,
        actor: { kind: "Game Master" }, itemId: item.id, decision: intervention.decision,
        candidateCommand: item.candidateCommand, submittedCommand, outcome: "accepted",
        acceptedEventIds: committed.map(({ id }) => id),
      };
      auditRecords = [...auditRecords, auditRecord];
      return immutableSnapshot({
        status: "accepted" as const,
        message: submittedCommand === null
          ? "The review work was rejected without changing canonical game state."
          : "The validated Game Master command was accepted.",
        auditRecord, committedEvents: committed.map(({ id, type }) => ({ id, type })), workspace: workspace(campaignId),
      });
    },
    retryNarration: async (campaignId, requestedOutcomeId) => {
      assertAuthorized(campaignId);
      if (requestedOutcomeId !== TRACE_OUTCOME_ID) throw new Error("Outcome trace not found.");
      try {
        const text = await narrationGenerator();
        if (text.trim().length === 0) throw new Error("Empty Narration");
        return immutableSnapshot({ status: "Retained" as const, message: "Narration was regenerated from the committed presentation snapshot." });
      } catch {
        return immutableSnapshot({ status: "Recoverable error" as const, message: "Narration is unavailable. The committed outcome is safe." });
      }
    },
    replayAudit: (campaignId) => {
      assertAuthorized(campaignId);
      const events = runtime.eventStore.readAll();
      const replay = createApplication(events);
      const replayed = projectionFrom(replay.application, events);
      const current = projectionFrom(runtime.application, events);
      if (canonicalJson(replayed) !== canonicalJson(current)) throw new Error("Audit replay did not reproduce the authoritative projection.");
      const eventIds = new Set(events.map(({ id }) => id));
      if (auditRecords.some(({ acceptedEventIds }) => acceptedEventIds.some((id) => !eventIds.has(id)))) {
        throw new Error("Audit replay found an intervention event outside canonical history.");
      }
      return immutableSnapshot({ status: "verified" as const, acceptedEventIds: events.map(({ id }) => id), projection: replayed });
    },
    snapshot: () => {
      const events = runtime.eventStore.readAll();
      return immutableSnapshot({ queue, canonicalEvents: events, projection: projectionFrom(runtime.application, events), auditRecords });
    },
  };
};
