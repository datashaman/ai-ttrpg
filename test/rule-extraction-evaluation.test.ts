import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractRuleCandidate,
  type AnchoredRuleSourceDocument,
  type CandidateRuleField,
  type ExtractedRuleDraft,
} from "../src/rule-authoring.js";

type ExtractionCategory =
  | "trigger"
  | "prerequisites"
  | "procedure"
  | "outcomes"
  | "tables"
  | "exceptions";

interface ExtractionBenchmark {
  readonly id: string;
  readonly schemaVersion: number;
  readonly source: AnchoredRuleSourceDocument;
  readonly scriptedExtraction: ExtractedRuleDraft;
  readonly thresholds: {
    readonly minimumPrecision: number;
    readonly minimumRecall: number;
  };
  readonly labels: Readonly<Record<ExtractionCategory, readonly string[]>>;
}

const anchors = <Value>(
  field: CandidateRuleField<Value>,
): readonly string[] => field.passages.map(({ passageAnchor }) => passageAnchor);

test("the versioned rule-extraction benchmark measures extractor precision and recall by required field kind", async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../benchmarks/rule-extraction-v1.json", import.meta.url),
      "utf8",
    ),
  ) as ExtractionBenchmark;
  let receivedSource: AnchoredRuleSourceDocument | undefined;
  const candidate = await extractRuleCandidate({
    source: fixture.source,
    extractor: {
      extract: async (source) => {
        receivedSource = source;
        assert.equal(Object.isFrozen(source), true);
        return structuredClone(fixture.scriptedExtraction);
      },
    },
  });
  assert.deepEqual(receivedSource, fixture.source);
  assert.equal(candidate.executable, false);

  const passageKindByAnchor = new Map(
    candidate.source.sections.flatMap((section) =>
      section.passages.map((passage) => [passage.anchor, passage.kind] as const),
    ),
  );
  const citedAnchors = Object.values(candidate.rule).flatMap((field) =>
    typeof field === "object" && field !== null && "passages" in field
      ? field.passages.map(({ passageAnchor }) => passageAnchor)
      : [],
  );
  const predictions: Readonly<Record<ExtractionCategory, readonly string[]>> = {
    trigger: anchors(candidate.rule.trigger),
    prerequisites: anchors(candidate.rule.prerequisites),
    procedure: anchors(candidate.rule.procedure),
    outcomes: anchors(candidate.rule.outcomes),
    tables: citedAnchors.filter(
      (anchor) => passageKindByAnchor.get(anchor) === "table",
    ),
    exceptions: citedAnchors.filter(
      (anchor) => passageKindByAnchor.get(anchor) === "exception",
    ),
  };

  assert.equal(fixture.id, "rule-extraction-v1");
  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(Object.keys(fixture.labels).sort(), [
    "exceptions",
    "outcomes",
    "prerequisites",
    "procedure",
    "tables",
    "trigger",
  ]);

  for (const category of Object.keys(fixture.labels) as ExtractionCategory[]) {
    const expected = new Set(fixture.labels[category]);
    const predicted = new Set(predictions[category]);
    const truePositives = [...predicted].filter((anchor) => expected.has(anchor));
    const precision = predicted.size === 0 ? 1 : truePositives.length / predicted.size;
    const recall = expected.size === 0 ? 1 : truePositives.length / expected.size;
    assert.ok(
      precision >= fixture.thresholds.minimumPrecision,
      `${category} precision ${precision} is below ${fixture.thresholds.minimumPrecision}`,
    );
    assert.ok(
      recall >= fixture.thresholds.minimumRecall,
      `${category} recall ${recall} is below ${fixture.thresholds.minimumRecall}`,
    );
  }
});
