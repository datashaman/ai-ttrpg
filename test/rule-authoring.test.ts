import assert from "node:assert/strict";
import test from "node:test";

import {
  ingestAnchoredRuleSource,
  RuleSourceIngestionError,
  type AnchoredRuleSourceDocument,
  type ExtractedRuleDraft,
} from "../src/rule-authoring.js";

const checkSource = (): AnchoredRuleSourceDocument => ({
  format: "ai-ttrpg-rule-source-v1",
  document: {
    id: "micro-ruleset",
    title: "AI TTRPG Micro-ruleset",
    version: "1.0.0",
  },
  sections: [
    {
      anchor: "checks",
      heading: "Checks",
      layout: { page: 3, order: 1 },
      passages: [
        {
          anchor: "checks.definition",
          kind: "definition",
          text: "A Check resolves an uncertain Player Character action.",
          layout: { page: 3, order: 1 },
        },
        {
          anchor: "checks.procedure",
          kind: "procedure",
          text: "Roll 2d6 and add the relevant Trait.",
          layout: { page: 3, order: 2 },
        },
        {
          anchor: "checks.outcomes",
          kind: "outcome",
          text: "6 or less is a Setback; 7-9 is Success with Cost; 10 or more is a Clean Success.",
          layout: { page: 3, order: 3 },
        },
        {
          anchor: "checks.example",
          kind: "example",
          text: "A total of 8 opens the door with a meaningful cost.",
          layout: { page: 3, order: 4 },
        },
        {
          anchor: "checks.exception",
          kind: "exception",
          text: "A Free Action proceeds without a Check.",
          layout: { page: 3, order: 5 },
        },
        {
          anchor: "checks.table",
          kind: "table",
          text: "Setback | 6-; Success with Cost | 7-9; Clean Success | 10+",
          layout: { page: 3, order: 6, table: { columns: 2, row: 1 } },
        },
        {
          anchor: "checks.cross-reference",
          kind: "cross-reference",
          text: "See Traits and Resolve.",
          layout: { page: 3, order: 7 },
        },
      ],
    },
  ],
});

const cited = <Value>(value: Value, ...passageAnchors: string[]) => ({
  value,
  attribution: {
    kind: "source-citation" as const,
    passageAnchors,
  },
});

const checkDraft = (): ExtractedRuleDraft => ({
  ruleId: "micro-ruleset.check",
  name: cited("Check", "checks.definition"),
  trigger: cited(
    "An uncertain Player Character action has meaningful consequences.",
    "checks.definition",
    "checks.exception",
  ),
  prerequisites: cited(
    ["The attempted goal and relevant Trait are confirmed."],
    "checks.cross-reference",
  ),
  inputs: cited(["2d6", "relevant Trait"], "checks.procedure"),
  procedure: cited("Roll 2d6 and add the relevant Trait.", "checks.procedure"),
  outcomes: cited(
    [
      { name: "Setback", range: "6 or less" },
      { name: "Success with Cost", range: "7-9" },
      { name: "Clean Success", range: "10 or more" },
    ],
    "checks.outcomes",
    "checks.table",
  ),
});

test("an anchored Micro-ruleset document becomes an immutable cited candidate", () => {
  const source = checkSource();
  const candidate = ingestAnchoredRuleSource({
    source,
    extraction: checkDraft(),
  });

  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.executable, false);
  assert.deepEqual(candidate.source.document, {
    id: "micro-ruleset",
    title: "AI TTRPG Micro-ruleset",
    version: "1.0.0",
  });
  assert.deepEqual(
    candidate.source.sections[0]?.passages.map(({ kind }) => kind),
    [
      "definition",
      "procedure",
      "outcome",
      "example",
      "exception",
      "table",
      "cross-reference",
    ],
  );
  assert.equal(candidate.rule.id, "micro-ruleset.check");
  assert.equal(candidate.rule.procedure.value, "Roll 2d6 and add the relevant Trait.");
  assert.deepEqual(candidate.rule.procedure.passages, [
    {
      documentId: "micro-ruleset",
      documentVersion: "1.0.0",
      sectionAnchor: "checks",
      passageAnchor: "checks.procedure",
      text: "Roll 2d6 and add the relevant Trait.",
      layout: { page: 3, order: 2 },
    },
  ]);
  assert.match(candidate.version, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.source.sections[0]?.passages), true);
  assert.equal(Object.isFrozen(candidate.rule.outcomes.value), true);

  (source.sections[0]!.passages[1] as { text: string }).text =
    "Changed after ingestion.";
  assert.equal(
    candidate.source.sections[0]?.passages[1]?.text,
    "Roll 2d6 and add the relevant Trait.",
  );
});

const rejectsWith = (
  code: RuleSourceIngestionError["code"],
  ingest: () => unknown,
): void => {
  assert.throws(ingest, (error: unknown) => {
    assert.ok(error instanceof RuleSourceIngestionError);
    assert.equal(error.code, code);
    return true;
  });
};

test("malformed source is rejected deterministically", () => {
  const source = structuredClone(checkSource()) as unknown as Record<
    string,
    unknown
  >;
  source.document = { id: "micro-ruleset", title: "Missing version" };

  rejectsWith("malformed-source", () =>
    ingestAnchoredRuleSource({
      source: source as unknown as AnchoredRuleSourceDocument,
      extraction: checkDraft(),
    }),
  );
});

test("missing source and citation anchors are rejected deterministically", async (t) => {
  await t.test("source passage without an anchor", () => {
    const source = structuredClone(checkSource());
    (source.sections[0]!.passages[0] as { anchor: string }).anchor = "";

    rejectsWith("missing-anchor", () =>
      ingestAnchoredRuleSource({ source, extraction: checkDraft() }),
    );
  });

  await t.test("candidate citation to an absent passage", () => {
    const extraction = structuredClone(checkDraft());
    (
      extraction.procedure.attribution as unknown as {
        passageAnchors: string[];
      }
    ).passageAnchors = ["checks.absent"];

    rejectsWith("missing-anchor", () =>
      ingestAnchoredRuleSource({ source: checkSource(), extraction }),
    );
  });
});

test("unsupported segmented source structure is rejected deterministically", () => {
  const source = structuredClone(checkSource());
  (source.sections[0]!.passages[0] as { kind: string }).kind = "illustration";

  rejectsWith("unsupported-structure", () =>
    ingestAnchoredRuleSource({ source, extraction: checkDraft() }),
  );
});

test("a table passage requires table-specific layout metadata", () => {
  const source = structuredClone(checkSource());
  const table = source.sections[0]!.passages.find(
    ({ kind }) => kind === "table",
  );
  assert.ok(table);
  (table as unknown as { layout: { page: number; order: number } }).layout = {
    page: 3,
    order: 6,
  };

  rejectsWith("unsupported-structure", () =>
    ingestAnchoredRuleSource({ source, extraction: checkDraft() }),
  );
});

test("the candidate schema requires each Micro-ruleset outcome exactly once", () => {
  const extraction = structuredClone(checkDraft());
  const outcomes = extraction.outcomes.value as Array<{
    name: "Setback" | "Success with Cost" | "Clean Success";
    range: string;
  }>;
  outcomes[1] = { name: "Setback", range: "7-9" };

  rejectsWith("invalid-candidate", () =>
    ingestAnchoredRuleSource({ source: checkSource(), extraction }),
  );
});

test("an authored interpretation requires and preserves reviewer identity", () => {
  const extraction = structuredClone(checkDraft()) as ExtractedRuleDraft;
  (extraction.trigger as unknown as Record<string, unknown>).attribution = {
    kind: "authored-interpretation",
    reviewerId: "reviewer:game-master:marlin",
  };

  const candidate = ingestAnchoredRuleSource({
    source: checkSource(),
    extraction,
  });

  assert.deepEqual(candidate.rule.trigger, {
    value: "An uncertain Player Character action has meaningful consequences.",
    attribution: "authored-interpretation",
    reviewerId: "reviewer:game-master:marlin",
    passages: [],
  });

  const anonymous = structuredClone(extraction);
  if (anonymous.trigger.attribution.kind === "authored-interpretation") {
    (anonymous.trigger.attribution as { reviewerId: string }).reviewerId = "";
  }
  rejectsWith("invalid-candidate", () =>
    ingestAnchoredRuleSource({ source: checkSource(), extraction: anonymous }),
  );
});

test("candidate snapshots are deterministic and expose no execution surface", () => {
  const first = ingestAnchoredRuleSource({
    source: checkSource(),
    extraction: checkDraft(),
  });
  const second = ingestAnchoredRuleSource({
    source: checkSource(),
    extraction: checkDraft(),
  });

  assert.deepEqual(first, second);
  assert.equal("execute" in first, false);
  assert.equal("register" in first, false);
  assert.equal("approve" in first, false);
  assert.equal(first.executable, false);
});
