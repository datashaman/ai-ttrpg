import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeterministicGameMasterSession,
  type GameMasterSessionSnapshot,
} from "../src/gm-ui/deterministic-game-master-session.js";

const GAME_MASTER = {
  kind: "Game Master" as const,
  campaignIds: ["locked-manor"] as const,
};

test("Game Master work queues expose scoped review evidence and a complete outcome trace", () => {
  const session = createDeterministicGameMasterSession({ actor: GAME_MASTER });

  const workspace = session.workspace("locked-manor");
  assert.deepEqual(
    workspace.queue.map((item) => item.taskType),
    ["Ambiguous intent", "Invalid proposal", "Rule conflict", "Ingestion review"],
  );
  for (const item of workspace.queue) {
    assert.equal(item.campaign.id, "locked-manor");
    assert.ok(item.actor.label.length > 0);
    assert.match(item.age, /minute/);
    assert.ok(item.evidence.bundleId.length > 0);
    assert.ok(item.validationFindings.length > 0);
    assert.ok(item.allowedInterventions.length > 0);
  }

  const trace = session.trace("locked-manor", "outcome:side-door");
  assert.equal(trace.narration.status, "Retained");
  assert.equal(trace.evidenceBundle.id, trace.queueItem.evidence.bundleId);
  assert.ok(trace.rule.sourcePassages.every((passage) => passage.text.length > 0));
  assert.equal(trace.modelCall.evidenceBundleId, trace.evidenceBundle.id);
  assert.equal(trace.command.id, trace.events[0]?.commandId);
  assert.equal(trace.randomTrace.eventId, trace.events[0]?.id);
  assert.equal(trace.projection.lastOutcomeEventId, trace.events[0]?.id);

  const serialized = JSON.stringify({ workspace, trace });
  assert.doesNotMatch(serialized, /rawProviderPayload|providerRequest|providerResponse/);
  assert.doesNotMatch(serialized, /The steward keeps a forbidden private ledger/);
});

test("Game Master intervention dispatches one actor-authorized command and rejects stale or conflicting work", async () => {
  const session = createDeterministicGameMasterSession({ actor: GAME_MASTER });
  const item = session
    .workspace("locked-manor")
    .queue.find(({ taskType }) => taskType === "Rule conflict")!;
  const canonicalBefore = JSON.stringify(session.snapshot().canonicalEvents);

  const accepted = await session.intervene("locked-manor", {
    itemId: item.id,
    expectedRevision: item.revision,
    idempotencyKey: "gm-review:rule-conflict",
    decision: "approve",
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.auditRecord?.decision, "approve");
  assert.equal(accepted.auditRecord?.actor.kind, "Game Master");
  assert.equal(accepted.auditRecord?.command?.type, "choose-action");
  assert.equal(accepted.committedEvents.length, 1);
  assert.notEqual(JSON.stringify(session.snapshot().canonicalEvents), canonicalBefore);

  const afterAccepted = JSON.stringify(session.snapshot());
  const stale = await session.intervene("locked-manor", {
    itemId: item.id,
    expectedRevision: item.revision,
    idempotencyKey: "gm-review:stale",
    decision: "reject",
  });
  assert.equal(stale.status, "rejected");
  assert.equal(stale.code, "STALE_WORK");
  assert.equal(JSON.stringify(session.snapshot()), afterAccepted);

  const conflict = await session.intervene("locked-manor", {
    itemId: item.id,
    expectedRevision: item.revision + 1,
    idempotencyKey: "gm-review:rule-conflict",
    decision: "reject",
  });
  assert.equal(conflict.status, "rejected");
  assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(JSON.stringify(session.snapshot()), afterAccepted);
});

test("Game Master controls reject insufficient scope without changing canonical state", async () => {
  const session = createDeterministicGameMasterSession({
    actor: { kind: "Game Master", campaignIds: ["another-campaign"] },
  });
  const before = JSON.stringify(session.snapshot());

  assert.throws(
    () => session.workspace("locked-manor"),
    /not authorized/i,
  );
  const result = await session.intervene("locked-manor", {
    itemId: "review:rule-conflict",
    expectedRevision: 1,
    idempotencyKey: "gm-review:outside-scope",
    decision: "override",
    command: { type: "choose-action", actionId: "survey-manor" },
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "ACTOR_NOT_AUTHORIZED");
  assert.equal(JSON.stringify(session.snapshot()), before);
});

test("presentation provider failure is recoverable and audit replay restores the same trace", async () => {
  const session = createDeterministicGameMasterSession({
    actor: GAME_MASTER,
    regenerateNarration: async () => {
      throw new Error("provider unavailable");
    },
  });
  const before = session.snapshot();
  const retry = await session.retryNarration("locked-manor", "outcome:side-door");
  assert.equal(retry.status, "Recoverable error");
  assert.match(retry.message, /committed outcome is safe/i);
  assert.deepEqual(session.snapshot().canonicalEvents, before.canonicalEvents);
  assert.deepEqual(session.snapshot().projection, before.projection);

  const restored = createDeterministicGameMasterSession({
    actor: GAME_MASTER,
    snapshot: structuredClone(before) as GameMasterSessionSnapshot,
  });
  assert.deepEqual(
    restored.trace("locked-manor", "outcome:side-door"),
    session.trace("locked-manor", "outcome:side-door"),
  );
  assert.deepEqual(restored.replayAudit("locked-manor"), {
    status: "verified",
    acceptedEventIds: before.canonicalEvents.map(({ id }) => id),
    projection: before.projection,
  });
});
