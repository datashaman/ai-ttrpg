import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { runDurableAdventureSimulation } from "../src/adventure-simulation.js";

test("the fixed 100-turn Adventure simulation recovers without canonical divergence", async () => {
  const report = await runDurableAdventureSimulation();

  assert.equal(report.simulationId, "durable-adventure-100-turn-v1");
  assert.equal(report.status, "passed");
  assert.equal(report.turns.accepted, 100);
  assert.equal(report.turns.attempted, 100);
  assert.ok(report.randomStream.length > 0);
  assert.ok(report.commands.length >= 100);
  assert.ok(report.events.length > 100);
  assert.ok(report.projections.length >= 100);
  assert.ok(report.modelTasks.some(({ outcome }) => outcome === "timeout"));
  assert.ok(report.modelTasks.some(({ outcome }) => outcome === "malformed"));
  assert.ok(report.modelTasks.some(({ outcome }) => outcome === "failed"));
  assert.ok(report.modelTasks.some(({ outcome }) => outcome === "cancelled"));
  assert.ok(
    report.recoveryActions.some(({ kind }) => kind === "repository-restart"),
  );
  assert.ok(
    report.recoveryActions.some(({ kind }) => kind === "stale-write-retry"),
  );
  assert.ok(
    report.recoveryActions.some(
      ({ kind }) => kind === "cancelled-pending-choice",
    ),
  );
  assert.ok(
    report.recoveryActions.some(({ kind }) => kind === "invalid-command-retry"),
  );
  assert.equal(
    new Set(
      report.commands
        .filter(({ mode }) => mode === "natural-language-paraphrase")
        .map(({ command }) => command),
    ).size,
    10,
  );
  assert.ok(report.timelineCount > 1);
  assert.equal(report.invariants.replayDivergence, 0);
  assert.equal(report.invariants.duplicateEvents, 0);
  assert.equal(report.invariants.unauthorizedLeakage, 0);
  assert.deepEqual(report.failure, null);
});

test("the simulation command emits a deterministic machine-readable report", () => {
  const run = (): unknown =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", "src/adventure-simulation-cli.ts"],
        { cwd: new URL("..", import.meta.url), encoding: "utf8" },
      ),
    );

  assert.deepEqual(run(), run());
});

test("a simulation failure reports its responsible layer and smallest turn position", async () => {
  const report = await runDurableAdventureSimulation({
    injectRepositoryFailureAtTurn: 39,
  });

  assert.equal(report.status, "failed");
  assert.equal(report.turns.accepted, 38);
  assert.equal(report.failure?.turn, 39);
  assert.equal(report.failure?.layer, "repository");
  assert.match(report.failure?.message ?? "", /is closed/);
});
