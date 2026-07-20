import {
  ingestAnchoredRuleSource,
  type ExtractedRuleDraft,
} from "../../src/rule-authoring.js";
import {
  createRuleReview,
  publishApprovedRulePackage,
  recordRuleApproval,
} from "../../src/rule-publication.js";

const cited = <Value>(value: Value, ...passageAnchors: string[]) => ({
  value,
  attribution: { kind: "source-citation" as const, passageAnchors },
});

export const publishedCheckPackage = (version = "1.0.0") => {
  const source = {
    format: "ai-ttrpg-rule-source-v1" as const,
    document: {
      id: "micro-ruleset",
      title: "AI TTRPG Micro-ruleset",
      version,
    },
    sections: [
      {
        anchor: "checks",
        heading: "Checks",
        layout: { page: 3, order: 1 },
        passages: [
          {
            anchor: "checks.definition",
            kind: "definition" as const,
            text: "A Check resolves an uncertain Player Character action.",
            layout: { page: 3, order: 1 },
          },
          {
            anchor: "checks.procedure",
            kind: "procedure" as const,
            text: "Roll 2d6 and add the relevant Trait.",
            layout: { page: 3, order: 2 },
          },
          {
            anchor: "checks.outcomes",
            kind: "outcome" as const,
            text: "6 or less is a Setback; 7-9 is Success with Cost; 10 or more is a Clean Success.",
            layout: { page: 3, order: 3 },
          },
          {
            anchor: "checks.exception",
            kind: "exception" as const,
            text: "A Free Action proceeds without a Check.",
            layout: { page: 3, order: 4 },
          },
        ],
      },
    ],
  };
  const extraction: ExtractedRuleDraft = {
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
  };
  const candidate = ingestAnchoredRuleSource({ source, extraction });
  const review = createRuleReview(candidate);
  const decision = recordRuleApproval({
    review,
    reviewerId: "reviewer:rules",
    decision: "approved",
    decidedAt: "2026-07-20T00:00:00.000Z",
  });
  return publishApprovedRulePackage({
    candidate,
    review,
    decision,
    packageVersion: version,
    license: { spdxId: "CC-BY-4.0", sourceUrl: "https://example.test/rules" },
  });
};
