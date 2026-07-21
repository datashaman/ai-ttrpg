import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateReleaseMeasurements,
  parseEvaluationPolicy,
  parseReleaseEvaluationSuite,
  type EvaluationObservations,
} from "../src/evaluation-release-gate.js";

const policyText = readFileSync(
  new URL("../benchmarks/evaluation-policy-v1.json", import.meta.url),
  "utf8",
);
const suiteText = readFileSync(
  new URL("../benchmarks/release-measurements-v1.json", import.meta.url),
  "utf8",
);

const observations = (): EvaluationObservations => ({
  datasets: [
    { layer: "classification", datasetId: "expanded-model-tasks-v1", metrics: { precision: 1, recall: 1, accuracy: 1 } },
    { layer: "intent-extraction", datasetId: "locked-manor-utterances-v1", metrics: { accuracy: 1 } },
    { layer: "rule-selection", datasetId: "rule-extraction-v1", metrics: { precision: 1, recall: 1, citationAccuracy: 1 } },
    {
      layer: "retrieval",
      datasetId: "actor-scoped-retrieval-v1",
      metrics: {},
      retrieval: {
        k: 5,
        byKind: {
          entity: { caseCount: 10, precisionAtK: 1, recallAtK: 13 / 14, meanReciprocalRank: 0.9, forbiddenDataLeakage: 0 },
          relationship: { caseCount: 4, precisionAtK: 2 / 7, recallAtK: 0.5, meanReciprocalRank: 15 / 28, forbiddenDataLeakage: 0 },
          rule: { caseCount: 3, precisionAtK: 1, recallAtK: 2 / 3, meanReciprocalRank: 2 / 3, forbiddenDataLeakage: 0 },
          event: { caseCount: 2, precisionAtK: 0.8, recallAtK: 1, meanReciprocalRank: 1, forbiddenDataLeakage: 0 },
        },
        unambiguousEntityLinkAccuracy: 0.875,
        totalForbiddenDataLeakage: 0,
      },
    },
    { layer: "citation", datasetId: "locked-manor-utterances-v1", metrics: { citationAccuracy: 1 } },
    { layer: "proposal-validity", datasetId: "expanded-model-tasks-v1", metrics: { accuracy: 1, contradictionRate: 0, forbiddenDataLeakage: 0 } },
    { layer: "narration", datasetId: "locked-manor-golden-campaign-v1", metrics: { contradictionRate: 0, citationAccuracy: 1, forbiddenDataLeakage: 0 } },
  ],
  turns: [
    { sessionId: "a", latencyMs: 80, modelTasks: 2, costUsd: 0.002, retries: 0, repairs: 0, failures: 0, evidenceBundleItems: 4, usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 } },
    { sessionId: "a", latencyMs: 120, modelTasks: 3, costUsd: 0.003, retries: 1, repairs: 1, failures: 0, evidenceBundleItems: 6, usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 } },
    { sessionId: "b", latencyMs: 120, modelTasks: 2, costUsd: 0.002, retries: 0, repairs: 0, failures: 0, evidenceBundleItems: 6, usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 } },
    { sessionId: "b", latencyMs: 240, modelTasks: 3, costUsd: 0.003, retries: 0, repairs: 0, failures: 0, evidenceBundleItems: 8, usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 } },
  ],
});

test("the reviewed policy is versioned separately from fixed measurements", () => {
  const policy = parseEvaluationPolicy(policyText);
  const suite = parseReleaseEvaluationSuite(suiteText);

  assert.equal(policy.id, "evaluation-policy-v1");
  assert.deepEqual(policy.review, {
    reviewer: "project-maintainer",
    reviewedAt: "2026-07-21",
    rationale: "Milestone C no-regression baseline approved for issue #87.",
  });
  assert.equal(suite.policyId, policy.id);
  assert.deepEqual(
    suite.datasets.map(({ layer }) => layer),
    [
      "classification",
      "intent-extraction",
      "rule-selection",
      "retrieval",
      "citation",
      "proposal-validity",
      "narration",
    ],
  );
  assert.deepEqual(suite.changeSurface, {
    models: ["golden-script-v1", "recorded-openai-v1"],
    promptVersions: [
      "interpret-player-input-v1",
      "classify-discourse-v1",
      "extract-intent-v1",
      "suggest-rule-match-v1",
      "propose-state-change-v1",
      "explain-rules-v1",
      "narrate-committed-outcome-v1",
    ],
    providers: ["scripted", "openai"],
    retrievalPolicies: ["actor-scoped-retrieval-v1"],
    rulesets: ["micro-ruleset@1.0.0"],
  });
});

test("the deterministic suite reports quality and operational measurements separately", () => {
  const report = evaluateReleaseMeasurements({
    policy: parseEvaluationPolicy(policyText),
    suite: parseReleaseEvaluationSuite(suiteText),
    observations: observations(),
  });

  assert.equal(report.status, "passed");
  assert.deepEqual(report.gates, []);
  assert.deepEqual(
    report.quality.map(({ layer }) => layer),
    [
      "classification",
      "intent-extraction",
      "rule-selection",
      "retrieval",
      "citation",
      "proposal-validity",
      "narration",
    ],
  );
  assert.deepEqual(report.operations, {
    turnCount: 4,
    sessionCount: 2,
    latencyMs: { p50: 120, p95: 240 },
    modelTasksPerTurn: 2.5,
    usage: {
      inputTokens: 2400,
      outputTokens: 600,
      totalTokens: 3000,
      totalTokensPerTurn: 750,
    },
    costUsd: { perTurn: 0.0025, perSession: 0.005 },
    retries: 1,
    repairs: 1,
    failures: 0,
    evidenceBundle: { p50Items: 6, p95Items: 8 },
  });
  assert.equal(report.measurementMode, "deterministic-scripted");
  assert.equal(report.paidProviderMeasurements, null);
});

test("a tolerance regression produces a layer-specific failing gate", () => {
  const policy = parseEvaluationPolicy(policyText);
  const suite = parseReleaseEvaluationSuite(suiteText);
  const measured = observations();
  const report = evaluateReleaseMeasurements({
    policy,
    suite,
    observations: {
      ...measured,
      datasets: measured.datasets.map((dataset) =>
        dataset.layer === "retrieval"
          ? {
              ...dataset,
              retrieval: {
                ...dataset.retrieval!,
                totalForbiddenDataLeakage: 1,
              },
            }
          : dataset,
      ),
      turns: measured.turns.map((turn, index) =>
        index === 0 ? { ...turn, latencyMs: 2_000 } : turn,
      ),
    },
  });

  assert.equal(report.status, "failed");
  assert.deepEqual(
    report.gates.map(({ layer, metric }) => [layer, metric]),
    [
      ["retrieval", "totalForbiddenDataLeakage"],
      ["model", "latencyMs.p95"],
    ],
  );
});

test("retrieval tolerances preserve each kind's own no-regression baseline", () => {
  const measured = observations();
  const report = evaluateReleaseMeasurements({
    policy: parseEvaluationPolicy(policyText),
    suite: parseReleaseEvaluationSuite(suiteText),
    observations: {
      ...measured,
      datasets: measured.datasets.map((dataset) =>
        dataset.layer === "retrieval"
          ? {
              ...dataset,
              retrieval: {
                ...dataset.retrieval!,
                byKind: {
                  ...dataset.retrieval!.byKind,
                  entity: {
                    ...dataset.retrieval!.byKind.entity,
                    precisionAtK: 0.99,
                  },
                },
              },
            }
          : dataset,
      ),
    },
  });

  assert.ok(
    report.gates.some(
      ({ layer, metric }) =>
        layer === "retrieval" && metric === "entity.precision@5",
    ),
  );
});

test("the release command emits one passing report and is part of required CI", () => {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "src/evaluation-release-cli.ts"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  const report = JSON.parse(output) as {
    readonly status: string;
    readonly changeSurface: {
      readonly models: readonly string[];
      readonly providers: readonly string[];
      readonly rulesets: readonly string[];
    };
    readonly simulation: {
      readonly status: string;
      readonly turns: { readonly accepted: number };
    };
  };
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { readonly scripts: Readonly<Record<string, string>> };

  assert.equal(report.status, "passed");
  assert.deepEqual(report.changeSurface.models, [
    "golden-script-v1",
    "recorded-openai-v1",
  ]);
  assert.deepEqual(report.changeSurface.providers, ["scripted", "openai"]);
  assert.deepEqual(report.changeSurface.rulesets, ["micro-ruleset@1.0.0"]);
  assert.equal(report.simulation.status, "passed");
  assert.equal(report.simulation.turns.accepted, 100);
  assert.equal(
    packageJson.scripts["verify:release"],
    "npm test && npm run typecheck && npm run player-ui:build && npm run test:browser && npm run evaluate:release",
  );
});

test("an incomplete report cannot pass by omitting a required layer", () => {
  const measured = observations();
  assert.throws(
    () => evaluateReleaseMeasurements({
      policy: parseEvaluationPolicy(policyText),
      suite: parseReleaseEvaluationSuite(suiteText),
      observations: { ...measured, datasets: measured.datasets.slice(0, 1) },
    }),
    /every quality layer exactly once/,
  );
});

test("the release command exits non-zero when a configured tolerance is exceeded", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/evaluation-release-cli.ts",
      "test/fixtures/failing-evaluation-policy-v1.json",
      "benchmarks/release-measurements-v1.json",
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /"layer": "model"/);
  assert.match(result.stdout, /"status": "failed"/);
});

test("the release report records issue #87 criteria, commands, and paid-provider limits", () => {
  const report = readFileSync(
    new URL("../docs/evaluation-release-report.md", import.meta.url),
    "utf8",
  );

  for (let criterion = 1; criterion <= 6; criterion += 1) {
    assert.match(
      report,
      new RegExp(`Issue-87-AC-${String(criterion).padStart(2, "0")}`),
    );
  }
  assert.match(report, /npm run evaluate:release/);
  assert.match(report, /npm run verify:release/);
  assert.match(report, /Paid-provider measurements/);
  assert.match(report, /Known limitations/);
});
