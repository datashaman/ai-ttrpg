import { canonicalJson, immutableSnapshot } from "./model-boundary.js";
import {
  ingestAnchoredRuleSource,
  type AnchoredRuleSourceDocument,
  type CandidateRuleField,
  type CitedRuleCandidate,
  type ExtractedRuleDraft,
} from "./rule-authoring.js";
import {
  createRuleReview,
  publishApprovedRulePackage,
  recordRuleApproval,
  type ExecutableRulesetPackage,
  type RuleApproval,
  type RuleApprovalDecision,
  type RuleReview,
} from "./rule-publication.js";

const RULE_FIELDS = [
  "name",
  "trigger",
  "prerequisites",
  "inputs",
  "procedure",
  "outcomes",
] as const;

type RuleFieldName = (typeof RULE_FIELDS)[number];

const normalizedText = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const semanticField = (field: CandidateRuleField<unknown>) =>
  field.attribution === "authored-interpretation"
    ? {
        value: field.value,
        attribution: field.attribution,
        reviewerId: field.reviewerId,
      }
    : {
        value: field.value,
        attribution: field.attribution,
        passages: field.passages.map((passage) => ({
          documentId: passage.documentId,
          sectionAnchor: passage.sectionAnchor,
          passageAnchor: passage.passageAnchor,
          text: normalizedText(passage.text),
        })),
      };

const semanticCandidate = (candidate: CitedRuleCandidate): string =>
  canonicalJson({
    ruleId: candidate.rule.id,
    fields: Object.fromEntries(
      RULE_FIELDS.map((field) => [field, semanticField(candidate.rule[field])]),
    ),
  });

const candidateDiff = (
  previous: CitedRuleCandidate,
  current: CitedRuleCandidate,
): RuleCandidateDiff => ({
  previousCandidateVersion: previous.version,
  candidateVersion: current.version,
  changes: RULE_FIELDS.flatMap((field) =>
    canonicalJson(semanticField(previous.rule[field])) ===
    canonicalJson(semanticField(current.rule[field]))
      ? []
      : [
          {
            field,
            previous: previous.rule[field],
            current: current.rule[field],
          },
        ],
  ),
});

export interface RuleCandidateDiff {
  readonly previousCandidateVersion: string;
  readonly candidateVersion: string;
  readonly changes: readonly {
    readonly field: RuleFieldName;
    readonly previous: CandidateRuleField<unknown>;
    readonly current: CandidateRuleField<unknown>;
  }[];
}

export type RuleReingestionResult =
  | {
      readonly status: "unchanged";
      readonly candidateVersion: string;
      readonly packageVersion: string;
      readonly packageChecksum: string;
    }
  | {
      readonly status: "review-required";
      readonly candidate: CitedRuleCandidate;
      readonly review: RuleReview;
      readonly diff: RuleCandidateDiff | null;
    }
  | {
      readonly status: "blocked";
      readonly candidate: CitedRuleCandidate;
      readonly review: RuleReview;
      readonly diff: RuleCandidateDiff | null;
      readonly diagnostics: RuleReview["validationFindings"];
    };

export interface RuleAuthoringWorkflowView {
  readonly reviews: readonly RuleReview[];
  readonly decisions: readonly RuleApproval[];
  readonly packages: readonly ExecutableRulesetPackage[];
}

interface CandidateRecord {
  readonly candidate: CitedRuleCandidate;
  readonly review: RuleReview;
  decision?: RuleApproval;
  package?: ExecutableRulesetPackage;
}

export type RuleAuthoringWorkflowErrorCode =
  | "unknown-candidate"
  | "candidate-invalid"
  | "decision-required"
  | "package-version-conflict"
  | "decision-already-recorded"
  | "candidate-already-published";

export class RuleAuthoringWorkflowError extends Error {
  constructor(
    readonly code: RuleAuthoringWorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuleAuthoringWorkflowError";
  }
}

export interface RuleAuthoringWorkflow {
  reingest(input: {
    readonly source: AnchoredRuleSourceDocument;
    readonly extraction: ExtractedRuleDraft;
  }): RuleReingestionResult;
  recordDecision(input: {
    readonly candidateVersion: string;
    readonly reviewerId: string;
    readonly decision: RuleApprovalDecision;
    readonly decidedAt: string;
  }): RuleApproval;
  publish(input: {
    readonly candidateVersion: string;
    readonly packageVersion: string;
    readonly license: {
      readonly spdxId: string;
      readonly sourceUrl: string;
    };
  }): ExecutableRulesetPackage;
  view(): RuleAuthoringWorkflowView;
}

export const createRuleAuthoringWorkflow = (): RuleAuthoringWorkflow => {
  const records: CandidateRecord[] = [];

  const findRecord = (candidateVersion: string): CandidateRecord => {
    const record = records.find(
      ({ candidate }) => candidate.version === candidateVersion,
    );
    if (record === undefined) {
      throw new RuleAuthoringWorkflowError(
        "unknown-candidate",
        `Unknown Rule Candidate version: ${candidateVersion}.`,
      );
    }
    return record;
  };

  return {
    reingest(input) {
      const candidate = ingestAnchoredRuleSource(input);
      const review = createRuleReview(candidate);
      const latestPublished = [...records]
        .reverse()
        .find((record) => record.package !== undefined);
      const diff = latestPublished === undefined
        ? null
        : candidateDiff(latestPublished.candidate, candidate);
      if (!review.valid) {
        records.push({ candidate, review });
        return immutableSnapshot({
          status: "blocked" as const,
          candidate,
          review,
          diff,
          diagnostics: review.validationFindings,
        });
      }
      if (
        latestPublished?.package !== undefined &&
        semanticCandidate(latestPublished.candidate) === semanticCandidate(candidate)
      ) {
        return immutableSnapshot({
          status: "unchanged" as const,
          candidateVersion: latestPublished.candidate.version,
          packageVersion: latestPublished.package.manifest.version,
          packageChecksum: latestPublished.package.checksum,
        });
      }

      records.push({ candidate, review });
      return immutableSnapshot({
        status: "review-required" as const,
        candidate,
        review,
        diff,
      });
    },

    recordDecision(input) {
      const record = findRecord(input.candidateVersion);
      if (record.decision !== undefined) {
        throw new RuleAuthoringWorkflowError(
          "decision-already-recorded",
          "A Rule Candidate decision is immutable once recorded.",
        );
      }
      if (input.decision === "approved" && !record.review.valid) {
        throw new RuleAuthoringWorkflowError(
          "candidate-invalid",
          "A Rule Candidate with validation findings cannot be approved.",
        );
      }
      const decision = recordRuleApproval({
        review: record.review,
        reviewerId: input.reviewerId,
        decision: input.decision,
        decidedAt: input.decidedAt,
      });
      record.decision = decision;
      return decision;
    },

    publish(input) {
      const record = findRecord(input.candidateVersion);
      if (record.package !== undefined) {
        throw new RuleAuthoringWorkflowError(
          "candidate-already-published",
          "A Rule Candidate can publish only one Executable Ruleset Package.",
        );
      }
      if (record.decision === undefined) {
        throw new RuleAuthoringWorkflowError(
          "decision-required",
          "A Rule Candidate requires a recorded decision before publication.",
        );
      }
      if (
        records.some(
          ({ package: existingPackage }) =>
            existingPackage?.manifest.version === input.packageVersion,
        )
      ) {
        throw new RuleAuthoringWorkflowError(
          "package-version-conflict",
          `Executable Ruleset Package version ${input.packageVersion} already exists.`,
        );
      }
      const rulesetPackage = publishApprovedRulePackage({
        candidate: record.candidate,
        review: record.review,
        decision: record.decision,
        packageVersion: input.packageVersion,
        license: input.license,
      });
      record.package = rulesetPackage;
      return rulesetPackage;
    },

    view() {
      return immutableSnapshot({
        reviews: records.map(({ review }) => review),
        decisions: records.flatMap(({ decision }) =>
          decision === undefined ? [] : [decision],
        ),
        packages: records.flatMap(({ package: rulesetPackage }) =>
          rulesetPackage === undefined ? [] : [rulesetPackage],
        ),
      });
    },
  };
};
