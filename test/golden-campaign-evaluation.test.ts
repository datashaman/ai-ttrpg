import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateGoldenCampaign,
  evaluateGoldenCampaignText,
  parseGoldenCampaignFixture,
  supportedGoldenCampaignAdapters,
  type GoldenCampaignAdapters,
  type GoldenCampaignFixture,
} from "../src/golden-campaign-evaluation.js";

const fixtureText = readFileSync(
  new URL("../benchmarks/golden-campaign-v1.json", import.meta.url),
  "utf8",
);

const withAdapterMatrix = (
  fixture: GoldenCampaignFixture,
  adapters: GoldenCampaignAdapters,
): GoldenCampaignFixture => ({
  ...fixture,
  matrix: {
    repositories: adapters.repositories.map(({ id }) => id),
    modelProviders: adapters.modelProviders.map(({ id }) => id),
    rulesetPackages: adapters.rulesetPackages.map(({ id }) => id),
    presentations: adapters.presentations.map(({ id }) => id),
  },
});

test("the versioned golden campaign is reproducible across every supported adapter combination", async () => {
  const fixture = parseGoldenCampaignFixture(fixtureText);
  const adapters = supportedGoldenCampaignAdapters();
  const report = await evaluateGoldenCampaign({ fixture, adapters });

  assert.equal(report.evaluationId, "locked-manor-golden-campaign-v1");
  assert.deepEqual(report.matrix, {
    repositories: ["in-memory", "local-durable"],
    modelProviders: ["scripted", "openai-recorded"],
    rulesetPackages: ["micro-ruleset@1.0.0"],
    presentations: ["deterministic", "grounded"],
  });
  assert.equal(report.runs.length, 8);
  assert.ok(report.runs.every((run) => run.status === "passed"));
  assert.ok(report.runs.every((run) => run.diagnostics.length === 0));
  assert.deepEqual(
    new Set(report.runs.map((run) => JSON.stringify(run.normalizedTruth))),
    new Set([JSON.stringify(fixture.expected.truth)]),
  );
  assert.deepEqual(
    new Set(report.runs.map((run) => JSON.stringify(run.normalizedEvidence))),
    new Set([JSON.stringify(fixture.expected.evidence)]),
  );
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.runs[0]!.normalizedTruth), true);
});

test("a presentation mismatch identifies its layer without reporting canonical divergence", async () => {
  const fixture = parseGoldenCampaignFixture(fixtureText);
  const adapters = supportedGoldenCampaignAdapters();
  const report = await evaluateGoldenCampaign({
    fixture: withAdapterMatrix(fixture, {
      ...adapters,
      presentations: [
        {
          id: "misleading",
          model: {
            narrate: async () => ({
              segments: [
                { kind: "rule", id: "micro-ruleset.check@1.0.0" },
              ],
            }),
            explainRules: async () => ({ invalid: true }),
          },
        },
      ],
    }),
    adapters: {
      ...adapters,
      presentations: [
        {
          id: "misleading",
          model: {
            narrate: async () => ({
              segments: [
                { kind: "rule", id: "micro-ruleset.check@1.0.0" },
              ],
            }),
            explainRules: async () => ({ invalid: true }),
          },
        },
      ],
    },
  });

  assert.equal(report.runs.length, 4);
  assert.ok(report.runs.every((run) => run.status === "failed"));
  assert.ok(
    report.runs.every(
      (run) =>
        run.diagnostics.length === 1 &&
        run.diagnostics[0]!.layer === "presentation",
    ),
  );
  assert.ok(
    report.runs.every(
      (run) => JSON.stringify(run.normalizedTruth) === JSON.stringify(fixture.expected.truth),
    ),
  );
});

test("provider failure is attributed to the model layer without changing truth", async () => {
  const fixture = parseGoldenCampaignFixture(fixtureText);
  const adapters = supportedGoldenCampaignAdapters();
  const failingAdapters: GoldenCampaignAdapters = {
    ...adapters,
    repositories: [adapters.repositories[0]!],
    modelProviders: [
      {
        id: "failing-provider",
        createProvider: () => ({
          provider: "failing-provider",
          model: "failure-v1",
          invoke: async () => {
            throw new Error("recorded provider unavailable");
          },
        }),
      },
    ],
    presentations: [adapters.presentations[0]!],
  };
  const report = await evaluateGoldenCampaign({
    fixture: withAdapterMatrix(fixture, failingAdapters),
    adapters: failingAdapters,
  });

  assert.equal(report.runs[0]!.status, "failed");
  assert.ok(report.runs[0]!.diagnostics.some(({ layer }) => layer === "model"));
  assert.ok(report.runs[0]!.diagnostics.every(({ layer }) => layer === "model"));
  assert.deepEqual(
    report.runs[0]!.normalizedTruth.commands.map((command) =>
      (command as { readonly type: string }).type
    ),
    ["configure-player-character", "begin-adventure"],
  );
});

test("provider construction failure is attributed to the model layer", async () => {
  const fixture = parseGoldenCampaignFixture(fixtureText);
  const adapters = supportedGoldenCampaignAdapters();
  const failingAdapters: GoldenCampaignAdapters = {
    ...adapters,
    repositories: [adapters.repositories[0]!],
    modelProviders: [
      {
        id: "misconfigured-provider",
        createProvider: () => {
          throw new Error("provider credentials are invalid");
        },
      },
    ],
    presentations: [adapters.presentations[0]!],
  };
  const report = await evaluateGoldenCampaign({
    fixture: withAdapterMatrix(fixture, failingAdapters),
    adapters: failingAdapters,
  });

  assert.equal(report.runs[0]!.status, "failed");
  assert.deepEqual(report.runs[0]!.diagnostics, [
    { layer: "model", message: "provider credentials are invalid" },
  ]);
});

test("the golden evaluation command emits a passing machine-readable report", () => {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "src/golden-campaign-cli.ts"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  const report = JSON.parse(output) as {
    readonly evaluationId: string;
    readonly runs: readonly { readonly status: string }[];
  };

  assert.equal(report.evaluationId, "locked-manor-golden-campaign-v1");
  assert.equal(report.runs.length, 8);
  assert.ok(report.runs.every(({ status }) => status === "passed"));
});

test("malformed golden inputs fail at the schema layer before an adapter runs", () => {
  assert.throws(
    () =>
      parseGoldenCampaignFixture(
        JSON.stringify({ id: "mutable-draft", schemaVersion: 2 }),
      ),
    /Invalid golden campaign fixture/,
  );
});

test("malformed golden input produces a machine-readable schema diagnostic", async () => {
  const report = await evaluateGoldenCampaignText({
    serializedFixture: JSON.stringify({ id: "mutable-draft", schemaVersion: 2 }),
    adapters: supportedGoldenCampaignAdapters(),
  });

  assert.equal(report.evaluationId, null);
  assert.deepEqual(report.runs, []);
  assert.equal(report.diagnostics[0]!.layer, "schema");
});

test("the configured adapters must exactly match the immutable fixture matrix", async () => {
  const fixture = parseGoldenCampaignFixture(fixtureText);
  const adapters = supportedGoldenCampaignAdapters();
  const report = await evaluateGoldenCampaign({
    fixture,
    adapters: {
      ...adapters,
      repositories: [adapters.repositories[0]!],
    },
  });

  assert.deepEqual(report.runs, []);
  assert.equal(report.diagnostics[0]!.layer, "adapter");
});

test("repository runtime failure produces an adapter diagnostic, not a schema diagnostic", async () => {
  const fixture = parseGoldenCampaignFixture(fixtureText);
  const adapters = supportedGoldenCampaignAdapters();
  const failingAdapters: GoldenCampaignAdapters = {
    ...adapters,
    repositories: [
      {
        id: "failing-repository",
        create: () => {
          throw new Error("repository unavailable");
        },
      },
    ],
  };
  const configuredFixture = withAdapterMatrix(fixture, failingAdapters);
  const report = await evaluateGoldenCampaignText({
    serializedFixture: JSON.stringify(configuredFixture),
    adapters: failingAdapters,
  });

  assert.equal(report.evaluationId, fixture.id);
  assert.deepEqual(report.runs, []);
  assert.equal(report.diagnostics[0]!.layer, "adapter");
});
