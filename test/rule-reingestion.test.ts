import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedExecutableRulesetPackage,
  RulePublicationError,
} from "../src/rule-publication.js";
import {
  createRuleAuthoringWorkflow,
  RuleAuthoringWorkflowError,
} from "../src/rule-reingestion.js";
import type {
  AnchoredRuleSourceDocument,
  ExtractedRuleDraft,
} from "../src/rule-authoring.js";

const source = (): AnchoredRuleSourceDocument => ({
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
          anchor: "checks.trigger",
          kind: "definition",
          text: "Use a Check when uncertainty has meaningful consequences.",
          layout: { page: 3, order: 2 },
        },
        {
          anchor: "checks.prerequisites",
          kind: "procedure",
          text: "Confirm the attempted goal and relevant Trait before rolling.",
          layout: { page: 3, order: 3 },
        },
        {
          anchor: "checks.procedure",
          kind: "procedure",
          text: "Roll 2d6 and add the relevant Trait.",
          layout: { page: 3, order: 4 },
        },
        {
          anchor: "checks.outcomes",
          kind: "outcome",
          text: "6 or less is a Setback; 7-9 is Success with Cost; 10 or more is a Clean Success.",
          layout: { page: 3, order: 5 },
        },
      ],
    },
  ],
});

const cited = <Value>(value: Value, ...passageAnchors: string[]) => ({
  value,
  attribution: { kind: "source-citation" as const, passageAnchors },
});

const extraction = (): ExtractedRuleDraft => ({
  ruleId: "micro-ruleset.check",
  name: cited("Check", "checks.definition"),
  trigger: cited(
    "An uncertain Player Character action has meaningful consequences.",
    "checks.trigger",
  ),
  prerequisites: cited(
    ["The attempted goal and relevant Trait are confirmed."],
    "checks.prerequisites",
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
  ),
});

const license = {
  spdxId: "CC-BY-4.0",
  sourceUrl: "https://example.invalid/micro-ruleset/1.0.0",
} as const;

test("semantically unchanged rule re-ingestion preserves the published executable version", () => {
  const workflow = createRuleAuthoringWorkflow();
  const initial = workflow.reingest({ source: source(), extraction: extraction() });
  assert.equal(initial.status, "review-required");
  if (initial.status !== "review-required") return;

  workflow.recordDecision({
    candidateVersion: initial.candidate.version,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
  });
  const published = workflow.publish({
    candidateVersion: initial.candidate.version,
    packageVersion: "1.0.0",
    license,
  });

  assert.deepEqual(
    workflow.reingest({ source: source(), extraction: extraction() }),
    {
      status: "unchanged",
      candidateVersion: initial.candidate.version,
      packageVersion: "1.0.0",
      packageChecksum: published.checksum,
    },
  );

  const reformattedSource = structuredClone(source()) as unknown as {
    document: { version: string };
    sections: { layout: { page: number; order: number }; passages: { layout: { page: number; order: number } }[] }[];
  } & AnchoredRuleSourceDocument;
  reformattedSource.document.version = "1.0.1";
  reformattedSource.sections[0]!.layout = { page: 7, order: 1 };
  reformattedSource.sections[0]!.passages[0]!.layout = { page: 7, order: 1 };
  const unchanged = workflow.reingest({
    source: reformattedSource,
    extraction: extraction(),
  });

  assert.deepEqual(unchanged, {
    status: "unchanged",
    candidateVersion: initial.candidate.version,
    packageVersion: "1.0.0",
    packageChecksum: published.checksum,
  });
  assert.deepEqual(workflow.view().packages, [published]);
  assert.equal(workflow.view().reviews.length, 1);
});

test("changed cited rule meaning produces a candidate diff with old and new passages", () => {
  const workflow = createRuleAuthoringWorkflow();
  const initial = workflow.reingest({ source: source(), extraction: extraction() });
  assert.equal(initial.status, "review-required");
  if (initial.status !== "review-required") return;
  workflow.recordDecision({
    candidateVersion: initial.candidate.version,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
  });
  workflow.publish({
    candidateVersion: initial.candidate.version,
    packageVersion: "1.0.0",
    license,
  });

  const changedSource = structuredClone(source()) as unknown as {
    document: { version: string };
    sections: { passages: { anchor: string; text: string }[] }[];
  } & AnchoredRuleSourceDocument;
  changedSource.document.version = "1.1.0";
  changedSource.sections[0]!.passages.find(
    ({ anchor }) => anchor === "checks.trigger",
  )!.text = "Use a Check when an uncertain action carries meaningful stakes.";
  const changedExtraction = structuredClone(extraction()) as unknown as {
    trigger: { value: string };
  } & ExtractedRuleDraft;
  changedExtraction.trigger.value =
    "An uncertain Player Character action carries meaningful stakes.";

  const changed = workflow.reingest({
    source: changedSource,
    extraction: changedExtraction,
  });

  assert.equal(changed.status, "review-required");
  if (changed.status !== "review-required") return;
  assert.equal(changed.diff?.previousCandidateVersion, initial.candidate.version);
  assert.equal(changed.diff?.candidateVersion, changed.candidate.version);
  assert.deepEqual(
    changed.diff?.changes.map(({ field, previous, current }) => ({
      field,
      previousValue: previous.value,
      previousPassages: previous.passages.map(
        ({ documentVersion, passageAnchor, text }) => ({
          documentVersion,
          passageAnchor,
          text,
        }),
      ),
      currentValue: current.value,
      currentPassages: current.passages.map(
        ({ documentVersion, passageAnchor, text }) => ({
          documentVersion,
          passageAnchor,
          text,
        }),
      ),
    })),
    [
      {
        field: "trigger",
        previousValue:
          "An uncertain Player Character action has meaningful consequences.",
        previousPassages: [
          {
            documentVersion: "1.0.0",
            passageAnchor: "checks.trigger",
            text: "Use a Check when uncertainty has meaningful consequences.",
          },
        ],
        currentValue:
          "An uncertain Player Character action carries meaningful stakes.",
        currentPassages: [
          {
            documentVersion: "1.1.0",
            passageAnchor: "checks.trigger",
            text: "Use a Check when an uncertain action carries meaningful stakes.",
          },
        ],
      },
    ],
  );
});

test("missing deterministic Check inputs block approval with attributable diagnostics", () => {
  const workflow = createRuleAuthoringWorkflow();
  const missingInputExtraction = structuredClone(extraction()) as unknown as {
    inputs: { value: string[] };
  } & ExtractedRuleDraft;
  missingInputExtraction.inputs.value = ["relevant Trait"];

  const result = workflow.reingest({
    source: source(),
    extraction: missingInputExtraction,
  });

  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") return;
  assert.deepEqual(result.diagnostics, [
    {
      code: "missing-input",
      severity: "error",
      field: "inputs",
      message: "The deterministic Check requires inputs 2d6 and relevant Trait.",
      supportingPassages: [
        {
          documentId: "micro-ruleset",
          documentVersion: "1.0.0",
          sectionAnchor: "checks",
          passageAnchor: "checks.procedure",
          text: "Roll 2d6 and add the relevant Trait.",
          layout: { page: 3, order: 4 },
        },
      ],
    },
  ]);
  assert.throws(
    () =>
      workflow.recordDecision({
        candidateVersion: result.candidate.version,
        reviewerId: "reviewer:game-master:marlin",
        decision: "approved",
        decidedAt: "2026-07-20T10:00:00.000Z",
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuleAuthoringWorkflowError);
      assert.equal(error.code, "candidate-invalid");
      return true;
    },
  );
  assert.deepEqual(workflow.view().decisions, []);
  assert.deepEqual(workflow.view().packages, []);
});

test("cyclic cross-references block unchanged re-ingestion before it can bypass review", () => {
  const workflow = createRuleAuthoringWorkflow();
  const initial = workflow.reingest({ source: source(), extraction: extraction() });
  assert.equal(initial.status, "review-required");
  if (initial.status !== "review-required") return;
  workflow.recordDecision({
    candidateVersion: initial.candidate.version,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
  });
  workflow.publish({
    candidateVersion: initial.candidate.version,
    packageVersion: "1.0.0",
    license,
  });

  const cyclicSource = structuredClone(source()) as unknown as {
    document: { version: string };
    sections: {
      passages: {
        anchor: string;
        kind: string;
        text: string;
        layout: { page: number; order: number };
      }[];
    }[];
  } & AnchoredRuleSourceDocument;
  cyclicSource.document.version = "1.1.0";
  cyclicSource.sections[0]!.passages.push(
    {
      anchor: "checks.reference-a",
      kind: "cross-reference",
      text: "See checks.reference-b.",
      layout: { page: 3, order: 6 },
    },
    {
      anchor: "checks.reference-b",
      kind: "cross-reference",
      text: "See checks.reference-a.",
      layout: { page: 3, order: 7 },
    },
  );

  const result = workflow.reingest({
    source: cyclicSource,
    extraction: extraction(),
  });

  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") return;
  const cycle = result.diagnostics.find(({ code }) => code === "cyclic-reference");
  assert.deepEqual(cycle, {
    code: "cyclic-reference",
    severity: "error",
    field: "prerequisites",
    message:
      "Rule Source cross-references contain a cycle: checks.reference-a, checks.reference-b.",
    supportingPassages: [
      {
        documentId: "micro-ruleset",
        documentVersion: "1.1.0",
        sectionAnchor: "checks",
        passageAnchor: "checks.reference-a",
        text: "See checks.reference-b.",
        layout: { page: 3, order: 6 },
      },
      {
        documentId: "micro-ruleset",
        documentVersion: "1.1.0",
        sectionAnchor: "checks",
        passageAnchor: "checks.reference-b",
        text: "See checks.reference-a.",
        layout: { page: 3, order: 7 },
      },
    ],
  });
  assert.equal(workflow.view().packages.length, 1);
});

test("cross-references between source sections are detected as a cycle", () => {
  const workflow = createRuleAuthoringWorkflow();
  const sectionCycleSource = structuredClone(source()) as unknown as {
    sections: {
      anchor: string;
      heading: string;
      layout: { page: number; order: number };
      passages: {
        anchor: string;
        kind: string;
        text: string;
        layout: { page: number; order: number };
      }[];
    }[];
  } & AnchoredRuleSourceDocument;
  sectionCycleSource.sections.push(
    {
      anchor: "advantage",
      heading: "Advantage",
      layout: { page: 4, order: 2 },
      passages: [
        {
          anchor: "advantage.reference",
          kind: "cross-reference",
          text: "See Disadvantage.",
          layout: { page: 4, order: 1 },
        },
      ],
    },
    {
      anchor: "disadvantage",
      heading: "Disadvantage",
      layout: { page: 5, order: 3 },
      passages: [
        {
          anchor: "disadvantage.reference",
          kind: "cross-reference",
          text: "See Advantage.",
          layout: { page: 5, order: 1 },
        },
      ],
    },
  );

  const result = workflow.reingest({
    source: sectionCycleSource,
    extraction: extraction(),
  });

  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") return;
  assert.deepEqual(
    result.diagnostics
      .find(({ code }) => code === "cyclic-reference")
      ?.supportingPassages.map(({ passageAnchor }) => passageAnchor),
    ["advantage.reference", "disadvantage.reference"],
  );
});

test("unresolved and contradictory source diagnostics expose only supporting passages", async (t) => {
  await t.test("unresolved cross-reference", () => {
    const workflow = createRuleAuthoringWorkflow();
    const unresolvedSource = structuredClone(source()) as unknown as {
      sections: {
        passages: {
          anchor: string;
          kind: string;
          text: string;
          layout: { page: number; order: number };
        }[];
      }[];
    } & AnchoredRuleSourceDocument;
    unresolvedSource.sections[0]!.passages.push({
      anchor: "checks.missing-reference",
      kind: "cross-reference",
      text: "See privileged.optional-rule.",
      layout: { page: 3, order: 5 },
    });

    const result = workflow.reingest({
      source: unresolvedSource,
      extraction: extraction(),
    });

    assert.equal(result.status, "blocked");
    if (result.status !== "blocked") return;
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "unresolved-reference",
    );
    assert.equal(diagnostic?.field, "prerequisites");
    assert.deepEqual(
      diagnostic?.supportingPassages.map(({ passageAnchor }) => passageAnchor),
      ["checks.missing-reference"],
    );
    assert.equal(
      diagnostic?.supportingPassages.some(
        ({ passageAnchor }) => passageAnchor === "checks.outcomes",
      ),
      false,
    );
  });

  await t.test("contradictory cited candidate", () => {
    const workflow = createRuleAuthoringWorkflow();
    const contradictorySource = structuredClone(source()) as unknown as {
      sections: { passages: { anchor: string; text: string }[] }[];
    } & AnchoredRuleSourceDocument;
    contradictorySource.sections[0]!.passages.find(
      ({ anchor }) => anchor === "checks.outcomes",
    )!.text =
      "6 or less is a Clean Success; 7-9 is Success with Cost; 10 or more is a Setback.";

    const result = workflow.reingest({
      source: contradictorySource,
      extraction: extraction(),
    });

    assert.equal(result.status, "blocked");
    if (result.status !== "blocked") return;
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "source-contradiction",
    );
    assert.equal(diagnostic?.field, "outcomes");
    assert.deepEqual(
      diagnostic?.supportingPassages.map(({ passageAnchor }) => passageAnchor),
      ["checks.outcomes"],
    );
  });
});

test("contradictory cited descriptive fields cannot be approved", async (t) => {
  const assertBlockedField = (
    changedExtraction: ExtractedRuleDraft,
    field: "name" | "trigger" | "prerequisites" | "inputs",
    supportingPassageAnchor: string,
  ): void => {
    const workflow = createRuleAuthoringWorkflow();
    const result = workflow.reingest({
      source: source(),
      extraction: changedExtraction,
    });
    assert.equal(result.status, "blocked");
    if (result.status !== "blocked") return;
    const diagnostic = result.diagnostics.find(
      (finding) =>
        finding.code === "source-contradiction" && finding.field === field,
    );
    assert.ok(diagnostic);
    assert.deepEqual(
      diagnostic.supportingPassages.map(({ passageAnchor }) => passageAnchor),
      [supportingPassageAnchor],
    );
  };

  await t.test("name", () => {
    const changed = structuredClone(extraction()) as unknown as {
      name: { value: string };
    } & ExtractedRuleDraft;
    changed.name.value = "Attack Roll";
    assertBlockedField(changed, "name", "checks.definition");
  });

  await t.test("trigger", () => {
    const changed = structuredClone(extraction()) as unknown as {
      trigger: { value: string };
    } & ExtractedRuleDraft;
    changed.trigger.value = "A Check is always required.";
    assertBlockedField(changed, "trigger", "checks.trigger");
  });

  await t.test("prerequisites", () => {
    const changed = structuredClone(extraction()) as unknown as {
      prerequisites: { value: string[] };
    } & ExtractedRuleDraft;
    changed.prerequisites.value = [
      "The attempted goal and relevant Trait must not be confirmed.",
    ];
    assertBlockedField(changed, "prerequisites", "checks.prerequisites");
  });

  await t.test("inputs", () => {
    const changed = structuredClone(extraction()) as unknown as {
      inputs: { value: string[] };
    } & ExtractedRuleDraft;
    changed.inputs.value = ["2d6", "relevant Trait", "d20"];
    assertBlockedField(changed, "inputs", "checks.procedure");
  });

  await t.test("name negated by source", () => {
    const changedSource = structuredClone(source()) as unknown as {
      sections: { passages: { anchor: string; text: string }[] }[];
    } & AnchoredRuleSourceDocument;
    changedSource.sections[0]!.passages.find(
      ({ anchor }) => anchor === "checks.definition",
    )!.text = "A Check is not an Attack Roll.";
    const changed = structuredClone(extraction()) as unknown as {
      name: { value: string };
    } & ExtractedRuleDraft;
    changed.name.value = "Attack Roll";

    const result = createRuleAuthoringWorkflow().reingest({
      source: changedSource,
      extraction: changed,
    });

    assert.equal(result.status, "blocked");
    if (result.status !== "blocked") return;
    assert.ok(
      result.diagnostics.some(
        ({ code, field }) => code === "source-contradiction" && field === "name",
      ),
    );
  });

  await t.test("prerequisite negated by source", () => {
    const changedSource = structuredClone(source()) as unknown as {
      sections: { passages: { anchor: string; text: string }[] }[];
    } & AnchoredRuleSourceDocument;
    changedSource.sections[0]!.passages.find(
      ({ anchor }) => anchor === "checks.prerequisites",
    )!.text =
      "The attempted goal and relevant Trait must not be confirmed before rolling.";

    const result = createRuleAuthoringWorkflow().reingest({
      source: changedSource,
      extraction: extraction(),
    });

    assert.equal(result.status, "blocked");
    if (result.status !== "blocked") return;
    assert.ok(
      result.diagnostics.some(
        ({ code, field }) =>
          code === "source-contradiction" && field === "prerequisites",
      ),
    );
  });
});

test("a rejected candidate preserves package history and a corrected candidate can recover", () => {
  const workflow = createRuleAuthoringWorkflow();
  const initial = workflow.reingest({ source: source(), extraction: extraction() });
  assert.equal(initial.status, "review-required");
  if (initial.status !== "review-required") return;
  workflow.recordDecision({
    candidateVersion: initial.candidate.version,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
  });
  const firstPackage = workflow.publish({
    candidateVersion: initial.candidate.version,
    packageVersion: "1.0.0",
    license,
  });
  assert.throws(
    () =>
      workflow.publish({
        candidateVersion: initial.candidate.version,
        packageVersion: "1.0.1",
        license,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuleAuthoringWorkflowError);
      assert.equal(error.code, "candidate-already-published");
      return true;
    },
  );

  const rejectedExtraction = structuredClone(extraction()) as unknown as {
    trigger: { value: string };
  } & ExtractedRuleDraft;
  rejectedExtraction.trigger.value =
    "An uncertain Player Character action carries meaningful stakes.";
  const rejectedSource = structuredClone(source()) as unknown as {
    document: { version: string };
    sections: { passages: { anchor: string; text: string }[] }[];
  } & AnchoredRuleSourceDocument;
  rejectedSource.document.version = "1.0.1";
  rejectedSource.sections[0]!.passages.find(
    ({ anchor }) => anchor === "checks.trigger",
  )!.text = "Use a Check when an uncertain action carries meaningful stakes.";
  const rejected = workflow.reingest({
    source: rejectedSource,
    extraction: rejectedExtraction,
  });
  assert.equal(rejected.status, "review-required");
  if (rejected.status !== "review-required") return;
  workflow.recordDecision({
    candidateVersion: rejected.candidate.version,
    reviewerId: "reviewer:game-master:marlin",
    decision: "rejected",
    decidedAt: "2026-07-20T11:00:00.000Z",
  });
  assert.throws(
    () =>
      workflow.recordDecision({
        candidateVersion: rejected.candidate.version,
        reviewerId: "reviewer:game-master:other",
        decision: "approved",
        decidedAt: "2026-07-20T11:30:00.000Z",
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuleAuthoringWorkflowError);
      assert.equal(error.code, "decision-already-recorded");
      return true;
    },
  );
  assert.throws(
    () =>
      workflow.publish({
        candidateVersion: rejected.candidate.version,
        packageVersion: "1.1.0",
        license,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RulePublicationError);
      assert.equal(error.code, "candidate-not-approved");
      return true;
    },
  );
  assert.doesNotThrow(() =>
    assertApprovedExecutableRulesetPackage(firstPackage),
  );

  const correctedSource = structuredClone(source()) as unknown as {
    document: { version: string };
    sections: { passages: { anchor: string; text: string }[] }[];
  } & AnchoredRuleSourceDocument;
  correctedSource.document.version = "1.1.0";
  correctedSource.sections[0]!.passages.find(
    ({ anchor }) => anchor === "checks.trigger",
  )!.text = "Use a Check when uncertainty creates meaningful risk.";
  const correctedExtraction = structuredClone(extraction()) as unknown as {
    trigger: { value: string };
  } & ExtractedRuleDraft;
  correctedExtraction.trigger.value =
    "An uncertain Player Character action creates meaningful risk.";
  const corrected = workflow.reingest({
    source: correctedSource,
    extraction: correctedExtraction,
  });
  assert.equal(corrected.status, "review-required");
  if (corrected.status !== "review-required") return;
  workflow.recordDecision({
    candidateVersion: corrected.candidate.version,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T12:00:00.000Z",
  });
  assert.throws(
    () =>
      workflow.publish({
        candidateVersion: corrected.candidate.version,
        packageVersion: "1.0.0",
        license,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuleAuthoringWorkflowError);
      assert.equal(error.code, "package-version-conflict");
      return true;
    },
  );
  const recoveredPackage = workflow.publish({
    candidateVersion: corrected.candidate.version,
    packageVersion: "1.1.0",
    license: { ...license, sourceUrl: "https://example.invalid/micro-ruleset/1.1.0" },
  });

  const history = workflow.view();
  assert.deepEqual(
    history.decisions.map(({ candidateVersion, decision }) => ({
      candidateVersion,
      decision,
    })),
    [
      { candidateVersion: initial.candidate.version, decision: "approved" },
      { candidateVersion: rejected.candidate.version, decision: "rejected" },
      { candidateVersion: corrected.candidate.version, decision: "approved" },
    ],
  );
  assert.deepEqual(
    history.packages.map(({ manifest, checksum }) => ({
      version: manifest.version,
      checksum,
    })),
    [
      { version: "1.0.0", checksum: firstPackage.checksum },
      { version: "1.1.0", checksum: recoveredPackage.checksum },
    ],
  );
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(history.packages), true);
  assert.doesNotThrow(() =>
    assertApprovedExecutableRulesetPackage(firstPackage),
  );
  assert.doesNotThrow(() =>
    assertApprovedExecutableRulesetPackage(recoveredPackage),
  );
});
