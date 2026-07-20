import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createRuleReview,
  publishApprovedRulePackage,
  recordRuleApproval,
  RulePublicationError,
} from "../src/rule-publication.js";
import { assembleRulesExplanationEvidence } from "../src/evidence-bundle.js";
import { explainCommittedRules } from "../src/presentation.js";
import { canonicalJson } from "../src/model-boundary.js";
import {
  ingestAnchoredRuleSource,
  type AnchoredRuleSourcePassage,
  type AnchoredRuleSourceDocument,
  type ExtractedRuleDraft,
} from "../src/rule-authoring.js";
import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
} from "../src/structured-play.js";

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
          anchor: "checks.exception",
          kind: "exception",
          text: "A Free Action proceeds without a Check.",
          layout: { page: 3, order: 4 },
        },
      ],
    },
  ],
});

const cited = <Value>(value: Value, ...passageAnchors: string[]) => ({
  value,
  attribution: { kind: "source-citation" as const, passageAnchors },
});

const draft = (): ExtractedRuleDraft => ({
  ruleId: "micro-ruleset.check",
  name: cited("Check", "checks.definition"),
  trigger: cited(
    "An uncertain Player Character action has meaningful consequences.",
    "checks.definition",
    "checks.exception",
  ),
  prerequisites: cited(
    ["The attempted goal and relevant Trait are confirmed."],
    "checks.definition",
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

const candidate = () =>
  ingestAnchoredRuleSource({ source: source(), extraction: draft() });

test("review correlates source, extraction, normalized rule, validation, and conformance examples", () => {
  const review = createRuleReview(candidate());

  assert.equal(review.candidateVersion, candidate().version);
  assert.equal(review.source.document.id, "micro-ruleset");
  assert.deepEqual(review.extractedFields.procedure, {
    value: "Roll 2d6 and add the relevant Trait.",
    attribution: "source-citation",
    passageAnchors: ["checks.procedure"],
  });
  assert.equal(review.normalizedRule.id, "micro-ruleset.check");
  assert.deepEqual(review.validationFindings, []);
  assert.equal(review.valid, true);
  assert.deepEqual(
    review.conformanceExamples.map(({ total, outcome, passed }) => ({
      total,
      outcome,
      passed,
    })),
    [
      { total: 6, outcome: "Setback", passed: true },
      { total: 8, outcome: "Success with Cost", passed: true },
      { total: 10, outcome: "Clean Success", passed: true },
    ],
  );
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.conformanceExamples), true);
});

test("unresolved cross-references and contradictory cited mechanics block publication", async (t) => {
  await t.test("unresolved cross-reference", () => {
    const unresolvedSource = structuredClone(source());
    (unresolvedSource.sections[0]!.passages as AnchoredRuleSourcePassage[]).push({
      anchor: "checks.cross-reference",
      kind: "cross-reference",
      text: "See Missing Rules.",
      layout: { page: 3, order: 5 },
    });
    const unresolved = ingestAnchoredRuleSource({
      source: unresolvedSource,
      extraction: draft(),
    });

    const review = createRuleReview(unresolved);

    assert.equal(review.valid, false);
    assert.equal(review.validationFindings[0]?.code, "unresolved-reference");
  });

  await t.test("contradictory cited mechanics", () => {
    const contradictorySource = structuredClone(source());
    (contradictorySource.sections[0]!.passages as AnchoredRuleSourcePassage[]).push({
      anchor: "checks.contradiction",
      kind: "outcome",
      text: "A total of 7-9 is a Setback.",
      layout: { page: 3, order: 5 },
    });
    const contradictoryDraft = structuredClone(draft());
    if (contradictoryDraft.outcomes.attribution.kind === "source-citation") {
      (contradictoryDraft.outcomes.attribution.passageAnchors as string[]).push(
        "checks.contradiction",
      );
    }
    const contradictory = ingestAnchoredRuleSource({
      source: contradictorySource,
      extraction: contradictoryDraft,
    });

    const review = createRuleReview(contradictory);

    assert.equal(review.valid, false);
    assert.equal(review.validationFindings[0]?.code, "source-contradiction");
  });

  await t.test("contradictory cited procedure", () => {
    const contradictorySource = structuredClone(source());
    (contradictorySource.sections[0]!.passages as AnchoredRuleSourcePassage[])[1] = {
      anchor: "checks.procedure",
      kind: "procedure",
      text: "Roll 1d20 and add the relevant Trait.",
      layout: { page: 3, order: 2 },
    };
    const contradictory = ingestAnchoredRuleSource({
      source: contradictorySource,
      extraction: draft(),
    });

    const review = createRuleReview(contradictory);

    assert.equal(review.valid, false);
    assert.ok(
      review.validationFindings.some(
        ({ code, field }) => code === "source-contradiction" && field === "procedure",
      ),
    );
  });
});

test("approval records the reviewer, candidate version, decision, time, and authored interpretations", () => {
  const extraction = structuredClone(draft());
  (extraction.trigger as unknown as { attribution: ExtractedRuleDraft["trigger"]["attribution"] }).attribution = {
    kind: "authored-interpretation",
    reviewerId: "reviewer:game-master:marlin",
  };
  const reviewedCandidate = ingestAnchoredRuleSource({
    source: source(),
    extraction,
  });
  const review = createRuleReview(reviewedCandidate);

  const approval = recordRuleApproval({
    review,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
  });

  assert.deepEqual(approval, {
    candidateVersion: reviewedCandidate.version,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
    authoredInterpretations: [
      {
        field: "trigger",
        reviewerId: "reviewer:game-master:marlin",
        value: "An uncertain Player Character action has meaningful consequences.",
      },
    ],
  });
  assert.equal(Object.isFrozen(approval), true);
});

const approved = () => {
  const approvedCandidate = candidate();
  const review = createRuleReview(approvedCandidate);
  const approval = recordRuleApproval({
    review,
    reviewerId: "reviewer:game-master:marlin",
    decision: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
  });
  return { approvedCandidate, review, approval };
};

const published = () => {
  const { approvedCandidate, review, approval } = approved();
  return publishApprovedRulePackage({
    candidate: approvedCandidate,
    review,
    decision: approval,
    packageVersion: "1.0.0-reviewed.1",
    license: {
      spdxId: "CC-BY-4.0",
      sourceUrl: "https://example.invalid/micro-ruleset/1.0.0",
    },
  });
};

test("an approved valid candidate publishes as a deterministic cited executable package", () => {
  const { approvedCandidate, review, approval } = approved();
  const publication = {
    candidate: approvedCandidate,
    review,
    decision: approval,
    packageVersion: "1.0.0",
    license: {
      spdxId: "CC-BY-4.0",
      sourceUrl: "https://example.invalid/micro-ruleset/1.0.0",
    },
  } as const;

  const rulesetPackage = publishApprovedRulePackage(publication);

  assert.equal(rulesetPackage.format, "ai-ttrpg-ruleset-package-v1");
  assert.equal(rulesetPackage.executable, true);
  assert.deepEqual(rulesetPackage.manifest, {
    id: "micro-ruleset",
    version: "1.0.0",
    rules: [
      {
        id: "micro-ruleset.check",
        version: "1.0.0",
        candidateVersion: approvedCandidate.version,
      },
    ],
  });
  assert.deepEqual(rulesetPackage.license, publication.license);
  assert.equal(rulesetPackage.rule.procedure.value, "Roll 2d6 and add the relevant Trait.");
  assert.deepEqual(
    rulesetPackage.rule.procedure.citations.map(({ passageAnchor }) => passageAnchor),
    ["checks.procedure"],
  );
  assert.match(rulesetPackage.checksum, /^[0-9a-f]{64}$/);
  assert.equal(
    publishApprovedRulePackage(publication).checksum,
    rulesetPackage.checksum,
  );
  assert.equal(Object.isFrozen(rulesetPackage.rule.outcomes.citations), true);
});

test("rejected, superseded, unapproved, invalid, and mismatched candidates cannot publish", async (t) => {
  const { approvedCandidate, review } = approved();
  const publishWith = (
    decision: "approved" | "rejected" | "superseded",
    overrides: Partial<Parameters<typeof publishApprovedRulePackage>[0]> = {},
  ) =>
    publishApprovedRulePackage({
      candidate: approvedCandidate,
      review,
      decision: recordRuleApproval({
        review,
        reviewerId: "reviewer:game-master:marlin",
        decision,
        decidedAt: "2026-07-20T10:00:00.000Z",
      }),
      packageVersion: "1.0.0",
      license: {
        spdxId: "CC-BY-4.0",
        sourceUrl: "https://example.invalid/micro-ruleset/1.0.0",
      },
      ...overrides,
    });
  const rejects = (code: RulePublicationError["code"], action: () => unknown) =>
    assert.throws(action, (error: unknown) => {
      assert.ok(error instanceof RulePublicationError);
      assert.equal(error.code, code);
      return true;
    });

  await t.test("rejected", () => rejects("candidate-not-approved", () => publishWith("rejected")));
  await t.test("superseded", () => rejects("candidate-not-approved", () => publishWith("superseded")));
  await t.test("unapproved", () =>
    rejects("candidate-not-approved", () =>
      publishWith("approved", {
        decision: undefined as unknown as Parameters<typeof publishApprovedRulePackage>[0]["decision"],
      }),
    ));

  const invalidDraft = structuredClone(draft());
  (invalidDraft.procedure as unknown as { value: string }).value = "Flip a coin.";
  const invalidCandidate = ingestAnchoredRuleSource({
    source: source(),
    extraction: invalidDraft,
  });
  const invalidReview = createRuleReview(invalidCandidate);
  await t.test("invalid", () =>
    rejects("candidate-invalid", () =>
      publishWith("approved", {
        candidate: invalidCandidate,
        review: invalidReview,
        decision: recordRuleApproval({
          review: invalidReview,
          reviewerId: "reviewer:game-master:marlin",
          decision: "approved",
          decidedAt: "2026-07-20T10:00:00.000Z",
        }),
      }),
    ));

  const differentDraft = structuredClone(draft());
  (differentDraft.trigger as unknown as { value: string }).value =
    "A different but valid trigger.";
  const differentCandidate = ingestAnchoredRuleSource({
    source: source(),
    extraction: differentDraft,
  });
  await t.test("mismatched version", () =>
    rejects("review-mismatch", () =>
      publishWith("approved", { candidate: differentCandidate }),
    ));

  await t.test("forged approval record", () =>
    rejects("invalid-approval", () =>
      publishWith("approved", {
        decision: {
          candidateVersion: approvedCandidate.version,
          reviewerId: "",
          decision: "approved",
          decidedAt: "not-a-timestamp",
          authoredInterpretations: [{ field: "procedure", reviewerId: "", value: "Flip a coin." }],
        },
      }),
    ));
});

test("the approved package governs deterministic play and exact Player-facing rule citations", async () => {
  const rulesetPackage = published();
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(5),
    checkRulesetPackage: rulesetPackage,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const proposed = app.submit({ type: "choose-action", actionId: "force-side-door" });
  assert.equal(proposed.status, "accepted");
  assert.ok(proposed.state.pendingCheckProposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  assert.equal(revealed.status, "accepted");
  assert.ok(revealed.state.pendingChoice);
  const resolved = app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: revealed.state.pendingChoice.id,
    choice: "decline",
  });
  assert.equal(resolved.status, "accepted");
  const traceRule = resolved.state.lastCheckResolution?.trace.rule;
  assert.deepEqual(traceRule, {
    id: "micro-ruleset.check",
    version: "1.0.0-reviewed.1",
    packageChecksum: rulesetPackage.checksum,
    sourcePassages: [
      {
        documentId: "micro-ruleset",
        documentVersion: "1.0.0",
        sectionAnchor: "checks",
        passageAnchor: "checks.procedure",
        text: "Roll 2d6 and add the relevant Trait.",
        layout: { page: 3, order: 2 },
      },
      {
        documentId: "micro-ruleset",
        documentVersion: "1.0.0",
        sectionAnchor: "checks",
        passageAnchor: "checks.outcomes",
        text: "6 or less is a Setback; 7-9 is Success with Cost; 10 or more is a Clean Success.",
        layout: { page: 3, order: 3 },
      },
    ],
  });

  const rulesEvidence = assembleRulesExplanationEvidence({
    actorScope: { kind: "Player", playerCharacterId: "player-character:primary" },
    utterance: "How did this Check outcome work?",
    view: app.view(),
    acceptedEvents: eventStore.readAll(),
  });
  const citedRule = rulesEvidence.items.find(
    ({ id }) => id === "rule:micro-ruleset.check@1.0.0-reviewed.1",
  );
  assert.ok(citedRule);
  assert.equal(
    citedRule.sourceReference,
    "rule-package:micro-ruleset@1.0.0-reviewed.1#checks.procedure,checks.outcomes",
  );
  assert.match(citedRule.content, /Roll 2d6/);
  assert.match(citedRule.content, /6 or less is a Setback/);

  const answer = await explainCommittedRules(
    {
      narrate: async () => ({ segments: [] }),
      explainRules: async () => ({
        segments: [
          { kind: "rule", id: "micro-ruleset.check@1.0.0-reviewed.1" },
        ],
      }),
    },
    {
      visibleEvidence: [],
      resolutionTrace: resolved.state.lastCheckResolution?.trace ?? null,
      committedEvents: resolved.appendedEvents,
      deterministicSummary: resolved.message,
    },
    "How did this Check outcome work?",
    100,
  );
  assert.equal(answer.source, "model");
  assert.match(answer.text, /micro-ruleset\.check@1\.0\.0-reviewed\.1/);
  assert.match(answer.text, /micro-ruleset@1\.0\.0#checks\.procedure/);
  assert.match(answer.text, /micro-ruleset@1\.0\.0#checks\.outcomes/);

  const reopened = createStructuredPlayApplication({ eventStore }).view();
  assert.deepEqual(
    reopened.state.lastCheckResolution?.trace,
    resolved.state.lastCheckResolution?.trace,
  );
});

test("a candidate or tampered package cannot enter the runtime or append gameplay events", async (t) => {
  const eventStore = createInMemoryEventStore();

  await t.test("candidate", () =>
    assert.throws(
      () =>
        createStructuredPlayApplication({
          eventStore,
          checkRulesetPackage: candidate() as unknown as ReturnType<typeof published>,
        }),
      /approved executable ruleset package/,
    ));

  const tampered = structuredClone(published());
  (tampered.rule.procedure as unknown as { value: string }).value = "Flip a coin.";
  await t.test("tampered package", () =>
    assert.throws(
      () =>
        createStructuredPlayApplication({
          eventStore,
          checkRulesetPackage: tampered,
        }),
      /approved executable ruleset package/,
    ));

  const forged = structuredClone(published());
  (forged.rule.procedure as unknown as { value: string }).value = "Flip a coin.";
  const { checksum: _checksum, ...forgedWithoutChecksum } = forged;
  (forged as { checksum: string }).checksum = createHash("sha256")
    .update(canonicalJson(forgedWithoutChecksum))
    .digest("hex");
  await t.test("unsupported package with a recomputed checksum", () =>
    assert.throws(
      () =>
        createStructuredPlayApplication({
          eventStore,
          checkRulesetPackage: forged,
        }),
      /approved executable ruleset package/,
    ));
  assert.deepEqual(eventStore.readAll(), []);
});
