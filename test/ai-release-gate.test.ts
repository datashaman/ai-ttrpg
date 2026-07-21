import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAdventureCli } from "../src/adventure-cli.js";
import {
  createLocalAdventureRepository,
  type OpenAdventure,
} from "../src/adventure-repository.js";
import {
  createModelGateway,
  createScriptedModelProvider,
} from "../src/model-gateway.js";
import { runNaturalLanguagePlay } from "../src/natural-language-play.js";
import { createStructuredPlayApplication } from "../src/structured-play.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import { scriptedIO } from "./support/scripted-io.js";
import { assertDeterministicReleaseCommand } from "./support/release-command.js";

type BenchmarkExpectation =
  | "accepted-action"
  | "acknowledged"
  | "rules-explained"
  | "clarification"
  | "safe-rejection"
  | "deterministic-rules";

type BenchmarkCategory =
  | "authored-action"
  | "in-character-speech"
  | "rules-query"
  | "out-of-character-request"
  | "table-chat"
  | "system-command"
  | "ambiguity"
  | "unknown-entity"
  | "unavailable-capability"
  | "unsupported-fact"
  | "invented-mechanic";

interface BenchmarkFixture {
  readonly id: string;
  readonly schemaVersion: number;
  readonly thresholds: {
    readonly correctInterpretationRate: number;
    readonly correctAmbiguityRate: number;
    readonly unsupportedClaimRejectionRate: number;
    readonly citationValidityRate: number;
    readonly eventSafetyRate: number;
    readonly maxDeterministicLatencyMs: number;
  };
  readonly cases: readonly {
    readonly id: string;
    readonly category: BenchmarkCategory;
    readonly utterance: string;
    readonly responses: Readonly<Record<string, unknown>>;
    readonly expected: BenchmarkExpectation;
    readonly expectedEventDelta: number;
    readonly expectedTranscriptIncludes: string;
  }[];
  readonly journeys: readonly {
    readonly id: string;
    readonly inputs: readonly string[];
    readonly responses: Readonly<Record<string, unknown>>;
    readonly expectedEndingId: string;
    readonly expectedEndingKind: string;
  }[];
}

const benchmark = (): BenchmarkFixture =>
  JSON.parse(
    readFileSync(
      new URL("../benchmarks/locked-manor-utterances-v1.json", import.meta.url),
      "utf8",
    ),
  ) as BenchmarkFixture;

const durableSnapshot = (adventure: OpenAdventure) => ({
  events: adventure.eventStore.readAll(),
  modelCalls: adventure.modelCallStore.readAll(),
  state: createStructuredPlayApplication({
    timelineStore: adventure.timelineStore,
  }).view().state,
});

test("the v1 benchmark versions every required utterance class and release threshold", () => {
  const fixture = benchmark();

  assert.equal(fixture.id, "locked-manor-utterances-v1");
  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(
    [...new Set(fixture.cases.map(({ category }) => category))].sort(),
    [
      "ambiguity",
      "authored-action",
      "in-character-speech",
      "invented-mechanic",
      "out-of-character-request",
      "rules-query",
      "system-command",
      "table-chat",
      "unavailable-capability",
      "unknown-entity",
      "unsupported-fact",
    ],
  );
  assert.deepEqual(fixture.thresholds, {
    correctInterpretationRate: 1,
    correctAmbiguityRate: 1,
    unsupportedClaimRejectionRate: 1,
    citationValidityRate: 1,
    eventSafetyRate: 1,
    maxDeterministicLatencyMs: 1_000,
  });
});

test("required CI runs the complete deterministic release command without the OpenAI smoke test", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { readonly scripts: Readonly<Record<string, string>> };
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const releaseCommand = packageJson.scripts["verify:release"];

  assertDeterministicReleaseCommand(releaseCommand);
  assert.match(workflow, /run: npm run verify:release/);
  assert.doesNotMatch(releaseCommand, /openai|smoke|OPENAI_API_KEY/i);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|test:openai-smoke/);
});

test("the release report assesses issue #46 and every parent PRD user story", () => {
  const report = readFileSync(
    new URL("../docs/ai-assisted-release-report.md", import.meta.url),
    "utf8",
  );

  for (let criterion = 1; criterion <= 10; criterion += 1) {
    assert.match(report, new RegExp(`Issue-46-AC-${String(criterion).padStart(2, "0")}`));
  }
  for (let userStory = 1; userStory <= 34; userStory += 1) {
    assert.match(report, new RegExp(`PRD-39-US-${String(userStory).padStart(2, "0")}`));
  }
  assert.match(report, /npm run verify:release/);
  assert.match(report, /npm run test:openai-smoke/);
  assert.match(report, /Known limitations/);
});

test("the locked-manor Adventure completes through mixed input modes and reopens stably", async () => {
  const fixture = benchmark();

  for (const journey of fixture.journeys) {
    const repository = createLocalAdventureRepository(
      mkdtempSync(join(tmpdir(), "ai-ttrpg-ai-release-gate-")),
    );
    const script = scriptedIO(journey.inputs);
    const provider = createScriptedModelProvider({
      model: fixture.id,
      responses: journey.responses,
    });

    await runAdventureCli(
      ["--mode", "natural-language", "create", "AI Release Gate"],
      script.io,
      repository,
      {
        modelRuntime: {
          modelGateway: createModelGateway({ provider }),
          timeoutMs: fixture.thresholds.maxDeterministicLatencyMs,
        },
      },
    );

    const summary = repository.list()[0];
    assert.ok(summary);
    const firstOpen = repository.open(summary.id);
    const firstSnapshot = durableSnapshot(firstOpen);
    assert.equal(
      firstSnapshot.state.adventureEnding?.id,
      journey.expectedEndingId,
    );
    assert.equal(
      firstSnapshot.state.adventureEnding?.kind,
      journey.expectedEndingKind,
    );
    assert.equal(
      firstOpen.eventStore
        .readAll()
        .some((event) => event.type.toLocaleLowerCase("en").includes("mode")),
      false,
    );
    assert.equal(firstOpen.modelCallStore.readAll().length, 1);
    firstOpen.close();

    const reopened = repository.open(summary.id);
    assert.equal(
      JSON.stringify(durableSnapshot(reopened)),
      JSON.stringify(firstSnapshot),
    );
    reopened.close();

    const transcript = script.output.join("");
    assert.match(transcript, /Fresh footprints lead from the manor gate/);
    assert.match(transcript, /AI TTRPG — Structured Play/);
    assert.match(transcript, /Adventure ends unresolved/);
  }
});

test("the deterministic utterance benchmark meets every AI release threshold", async () => {
  const fixture = benchmark();
  const measurements = {
    correctInterpretation: { passed: 0, total: 0 },
    correctAmbiguity: { passed: 0, total: 0 },
    unsupportedClaimRejection: { passed: 0, total: 0 },
    citationValidity: { passed: 0, total: 0 },
    eventSafety: { passed: 0, total: 0 },
  };
  const outcomeMismatches: string[] = [];

  for (const benchmarkCase of fixture.cases) {
    const { eventStore } = beginAdventureFixture();
    const eventCountBefore = eventStore.readAll().length;
    const script = scriptedIO([benchmarkCase.utterance]);
    const provider = createScriptedModelProvider({
      model: fixture.id,
      responses: benchmarkCase.responses,
    });

    const result = await runNaturalLanguagePlay({
      io: script.io,
      modelGateway: createModelGateway({ provider }),
      eventStore,
    });

    const output = script.output.join("");
    const eventDelta = eventStore.readAll().length - eventCountBefore;
    const lastRecord = result.modelCallRecords.at(-1);
    let outcomeMatched = false;
    switch (benchmarkCase.expected) {
      case "accepted-action":
        outcomeMatched =
          result.interpretedCommands.length === 1 &&
          lastRecord?.validation.status === "accepted";
        break;
      case "acknowledged":
        outcomeMatched =
          result.interpretedCommands.length === 0 &&
          lastRecord?.validation.status === "accepted";
        break;
      case "rules-explained":
        outcomeMatched =
          /Rules explanation\n/.test(output) &&
          lastRecord?.validation.status === "accepted" &&
          lastRecord.fallbackOutcome === "none";
        break;
      case "clarification":
        outcomeMatched =
          /Clarification needed:/.test(output) &&
          lastRecord?.validation.status === "accepted";
        break;
      case "safe-rejection":
        outcomeMatched =
          /could not safely map/i.test(output) &&
          lastRecord?.validation.status === "rejected" &&
          lastRecord.fallbackOutcome === "safe-rejection";
        break;
      case "deterministic-rules":
        outcomeMatched =
          /Rules explanation \(deterministic fallback\)/.test(output) &&
          lastRecord?.validation.status === "rejected" &&
          lastRecord.fallbackOutcome === "deterministic-rules";
        break;
    }
    outcomeMatched =
      outcomeMatched && output.includes(benchmarkCase.expectedTranscriptIncludes);
    if (!outcomeMatched) outcomeMismatches.push(benchmarkCase.id);

    if (
      benchmarkCase.expected === "accepted-action" ||
      benchmarkCase.expected === "acknowledged" ||
      benchmarkCase.expected === "rules-explained"
    ) {
      measurements.correctInterpretation.total += 1;
      if (outcomeMatched) measurements.correctInterpretation.passed += 1;
    }
    if (benchmarkCase.expected === "clarification") {
      measurements.correctAmbiguity.total += 1;
      if (outcomeMatched) measurements.correctAmbiguity.passed += 1;
    }
    if (
      benchmarkCase.expected === "safe-rejection" &&
      [
        "unknown-entity",
        "unavailable-capability",
        "unsupported-fact",
        "invented-mechanic",
      ].includes(benchmarkCase.category)
    ) {
      measurements.unsupportedClaimRejection.total += 1;
      if (outcomeMatched) measurements.unsupportedClaimRejection.passed += 1;
    }
    if (
      benchmarkCase.expected === "rules-explained" ||
      benchmarkCase.expected === "deterministic-rules"
    ) {
      measurements.citationValidity.total += 1;
      if (outcomeMatched) measurements.citationValidity.passed += 1;
    }
    measurements.eventSafety.total += 1;
    if (eventDelta === benchmarkCase.expectedEventDelta) {
      measurements.eventSafety.passed += 1;
    }
    for (const record of result.modelCallRecords) {
      assert.ok(
        record.durationMs <= fixture.thresholds.maxDeterministicLatencyMs,
        `${benchmarkCase.id} took ${record.durationMs}ms`,
      );
    }
  }

  const rate = ({ passed, total }: { passed: number; total: number }): number =>
    total === 0 ? 0 : passed / total;
  assert.ok(
    rate(measurements.correctInterpretation) >=
      fixture.thresholds.correctInterpretationRate,
    JSON.stringify({ ...measurements.correctInterpretation, outcomeMismatches }),
  );
  assert.ok(
    rate(measurements.correctAmbiguity) >=
      fixture.thresholds.correctAmbiguityRate,
    JSON.stringify(measurements.correctAmbiguity),
  );
  assert.ok(
    rate(measurements.unsupportedClaimRejection) >=
      fixture.thresholds.unsupportedClaimRejectionRate,
    JSON.stringify(measurements.unsupportedClaimRejection),
  );
  assert.ok(
    rate(measurements.citationValidity) >=
      fixture.thresholds.citationValidityRate,
    JSON.stringify(measurements.citationValidity),
  );
  assert.ok(
    rate(measurements.eventSafety) >= fixture.thresholds.eventSafetyRate,
    JSON.stringify(measurements.eventSafety),
  );
});
