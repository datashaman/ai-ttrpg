import { createHash } from "node:crypto";

import { canonicalJson, immutableSnapshot } from "./model-boundary.js";
import type {
  CandidateRuleField,
  CitedRuleCandidate,
  RuleOutcomeDraft,
  StableRuleSourcePassage,
} from "./rule-authoring.js";
import {
  CHECK_OUTCOME_RANGES,
  checkOutcomeFor,
  type CheckOutcome,
} from "./check-rule.js";

export interface ReviewExtractedField<Value> {
  readonly value: Value;
  readonly attribution: "source-citation" | "authored-interpretation";
  readonly passageAnchors: readonly string[];
  readonly reviewerId?: string;
}

export interface RuleValidationFinding {
  readonly code:
    | "unsupported-procedure"
    | "unsupported-outcome-range"
    | "unresolved-reference"
    | "source-contradiction";
  readonly severity: "error";
  readonly field: "source" | "procedure" | "outcomes";
  readonly message: string;
}

export interface RuleConformanceExample {
  readonly dice: readonly [number, number];
  readonly traitModifier: 0 | 1 | 2;
  readonly total: number;
  readonly outcome: CheckOutcome;
  readonly passed: boolean;
}

export interface RuleReview {
  readonly candidateVersion: string;
  readonly source: CitedRuleCandidate["source"];
  readonly extractedFields: {
    readonly name: ReviewExtractedField<string>;
    readonly trigger: ReviewExtractedField<string>;
    readonly prerequisites: ReviewExtractedField<readonly string[]>;
    readonly inputs: ReviewExtractedField<readonly string[]>;
    readonly procedure: ReviewExtractedField<string>;
    readonly outcomes: ReviewExtractedField<readonly RuleOutcomeDraft[]>;
  };
  readonly normalizedRule: CitedRuleCandidate["rule"];
  readonly validationFindings: readonly RuleValidationFinding[];
  readonly conformanceExamples: readonly RuleConformanceExample[];
  readonly valid: boolean;
}

export type RuleApprovalDecision = "approved" | "rejected" | "superseded";

export interface AuthoredInterpretationRecord {
  readonly field:
    | "name"
    | "trigger"
    | "prerequisites"
    | "inputs"
    | "procedure"
    | "outcomes";
  readonly reviewerId: string;
  readonly value: unknown;
}

export interface RuleApproval {
  readonly candidateVersion: string;
  readonly reviewerId: string;
  readonly decision: RuleApprovalDecision;
  readonly decidedAt: string;
  readonly authoredInterpretations: readonly AuthoredInterpretationRecord[];
}

export type RulePublicationErrorCode =
  | "candidate-not-approved"
  | "candidate-invalid"
  | "review-mismatch"
  | "invalid-approval"
  | "invalid-package-metadata";

export class RulePublicationError extends Error {
  constructor(
    readonly code: RulePublicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RulePublicationError";
  }
}

export type PublishedRuleField<Value> =
  | {
      readonly value: Value;
      readonly attribution: "source-citation";
      readonly citations: readonly StableRuleSourcePassage[];
    }
  | {
      readonly value: Value;
      readonly attribution: "authored-interpretation";
      readonly reviewerId: string;
      readonly citations: readonly [];
    };

export interface ExecutableRulesetPackage {
  readonly format: "ai-ttrpg-ruleset-package-v1";
  readonly executable: true;
  readonly manifest: {
    readonly id: "micro-ruleset";
    readonly version: string;
    readonly rules: readonly [
      {
        readonly id: "micro-ruleset.check";
        readonly version: string;
        readonly candidateVersion: string;
      },
    ];
  };
  readonly license: {
    readonly spdxId: string;
    readonly sourceUrl: string;
  };
  readonly approval: RuleApproval & { readonly decision: "approved" };
  readonly rule: {
    readonly id: "micro-ruleset.check";
    readonly name: PublishedRuleField<string>;
    readonly trigger: PublishedRuleField<string>;
    readonly prerequisites: PublishedRuleField<readonly string[]>;
    readonly inputs: PublishedRuleField<readonly string[]>;
    readonly procedure: PublishedRuleField<string>;
    readonly outcomes: PublishedRuleField<readonly RuleOutcomeDraft[]>;
  };
  readonly checksum: string;
}

export interface PublishedCheckRuleReference {
  readonly id: "micro-ruleset.check";
  readonly version: string;
  readonly packageChecksum: string;
  readonly sourcePassages: readonly StableRuleSourcePassage[];
}

const reviewField = <Value>(
  field: CandidateRuleField<Value>,
): ReviewExtractedField<Value> =>
  field.attribution === "source-citation"
    ? {
        value: field.value,
        attribution: field.attribution,
        passageAnchors: field.passages.map(({ passageAnchor }) => passageAnchor),
      }
    : {
        value: field.value,
        attribution: field.attribution,
        passageAnchors: [],
        reviewerId: field.reviewerId,
      };

const validationFindings = (
  candidate: CitedRuleCandidate,
): readonly RuleValidationFinding[] => {
  const findings: RuleValidationFinding[] = [];
  const referenceTargets = new Set(
    candidate.source.sections.flatMap((section) => [
      section.anchor.toLocaleLowerCase("en"),
      section.heading.toLocaleLowerCase("en"),
      ...section.passages.map(({ anchor }) => anchor.toLocaleLowerCase("en")),
    ]),
  );
  for (const passage of candidate.source.sections.flatMap(
    ({ passages }) => passages,
  )) {
    if (passage.kind !== "cross-reference") continue;
    const targets = passage.text
      .replace(/^see\s+/i, "")
      .replace(/[.]$/, "")
      .split(/\s*(?:,|\band\b)\s*/i)
      .map((target) => target.trim().toLocaleLowerCase("en"))
      .filter((target) => target !== "");
    const unresolved = targets.filter((target) => !referenceTargets.has(target));
    if (unresolved.length > 0) {
      findings.push({
        code: "unresolved-reference",
        severity: "error",
        field: "source",
        message: `Source passage ${passage.anchor} has unresolved references: ${unresolved.join(", ")}.`,
      });
    }
  }
  if (candidate.rule.procedure.value !== "Roll 2d6 and add the relevant Trait.") {
    findings.push({
      code: "unsupported-procedure",
      severity: "error",
      field: "procedure",
      message: "The deterministic runtime supports exactly 2d6 plus the relevant Trait.",
    });
  }
  for (const outcome of candidate.rule.outcomes.value) {
    if (outcome.range !== CHECK_OUTCOME_RANGES[outcome.name]) {
      findings.push({
        code: "unsupported-outcome-range",
        severity: "error",
        field: "outcomes",
        message: `${outcome.name} must use range ${CHECK_OUTCOME_RANGES[outcome.name]}.`,
      });
    }
  }
  if (
    candidate.rule.procedure.attribution === "source-citation" &&
    !candidate.rule.procedure.passages.some(({ text }) => {
      const normalized = text.toLocaleLowerCase("en");
      return normalized.includes("roll 2d6") && normalized.includes("relevant trait");
    })
  ) {
    findings.push({
      code: "source-contradiction",
      severity: "error",
      field: "procedure",
      message: "The cited source passages do not support the normalized Check procedure.",
    });
  }
  if (
    candidate.rule.outcomes.attribution === "source-citation" &&
    candidate.rule.outcomes.passages.some(({ text }) => {
      const contradictoryPatterns = [
          /(?:6 or less|6-)\D{0,24}(?:success with cost|clean success)/,
          /(?:success with cost|clean success)\D{0,24}(?:6 or less|6-)/,
          /7\s*[-–]\s*9\D{0,24}(?:setback|clean success)/,
          /(?:setback|clean success)\D{0,24}7\s*[-–]\s*9/,
          /(?:10 or more|10\+)\D{0,24}(?:setback|success with cost)/,
          /(?:setback|success with cost)\D{0,24}(?:10 or more|10\+)/,
        ];
      return text
        .toLocaleLowerCase("en")
        .split(/[;\n]/)
        .some((clause) =>
          contradictoryPatterns.some((pattern) => pattern.test(clause)),
        );
    })
  ) {
    findings.push({
      code: "source-contradiction",
      severity: "error",
      field: "outcomes",
      message: "A cited source passage contradicts the normalized Check outcome ranges.",
    });
  }
  return findings;
};

const conformanceExamples = (
  candidate: CitedRuleCandidate,
): readonly RuleConformanceExample[] =>
  [
    { dice: [2, 3] as const, traitModifier: 1 as const, total: 6 },
    { dice: [3, 4] as const, traitModifier: 1 as const, total: 8 },
    { dice: [4, 5] as const, traitModifier: 1 as const, total: 10 },
  ].map((example) => {
    const outcome = checkOutcomeFor(example.total);
    return {
      ...example,
      outcome,
      passed:
        candidate.rule.outcomes.value.find(({ name }) => name === outcome)
          ?.range === CHECK_OUTCOME_RANGES[outcome],
    };
  });

export const createRuleReview = (
  candidate: CitedRuleCandidate,
): RuleReview => {
  const findings = validationFindings(candidate);
  const examples = conformanceExamples(candidate);
  return immutableSnapshot({
    candidateVersion: candidate.version,
    source: candidate.source,
    extractedFields: {
      name: reviewField(candidate.rule.name),
      trigger: reviewField(candidate.rule.trigger),
      prerequisites: reviewField(candidate.rule.prerequisites),
      inputs: reviewField(candidate.rule.inputs),
      procedure: reviewField(candidate.rule.procedure),
      outcomes: reviewField(candidate.rule.outcomes),
    },
    normalizedRule: candidate.rule,
    validationFindings: findings,
    conformanceExamples: examples,
    valid: findings.length === 0 && examples.every(({ passed }) => passed),
  });
};

export const recordRuleApproval = (input: {
  readonly review: RuleReview;
  readonly reviewerId: string;
  readonly decision: RuleApprovalDecision;
  readonly decidedAt: string;
}): RuleApproval => {
  const parsedTime = new Date(input.decidedAt);
  if (
    input.reviewerId.trim() === "" ||
    Number.isNaN(parsedTime.valueOf()) ||
    parsedTime.toISOString() !== input.decidedAt
  ) {
    throw new Error("A rule decision requires reviewer identity and a valid timestamp.");
  }
  const ruleFields = [
    ["name", input.review.normalizedRule.name],
    ["trigger", input.review.normalizedRule.trigger],
    ["prerequisites", input.review.normalizedRule.prerequisites],
    ["inputs", input.review.normalizedRule.inputs],
    ["procedure", input.review.normalizedRule.procedure],
    ["outcomes", input.review.normalizedRule.outcomes],
  ] as const;
  const authoredInterpretations = ruleFields.flatMap(([field, value]) =>
      value.attribution === "authored-interpretation"
        ? [
            {
              field,
              reviewerId: value.reviewerId,
              value: value.value,
            },
          ]
        : [],
    );
  return immutableSnapshot({
    candidateVersion: input.review.candidateVersion,
    reviewerId: input.reviewerId,
    decision: input.decision,
    decidedAt: input.decidedAt,
    authoredInterpretations,
  });
};

const publishField = <Value>(
  field: CandidateRuleField<Value>,
): PublishedRuleField<Value> =>
  field.attribution === "source-citation"
    ? {
        value: field.value,
        attribution: field.attribution,
        citations: field.passages,
      }
    : {
        value: field.value,
        attribution: field.attribution,
        reviewerId: field.reviewerId,
        citations: [],
      };

export const publishApprovedRulePackage = (input: {
  readonly candidate: CitedRuleCandidate;
  readonly review: RuleReview;
  readonly decision: RuleApproval;
  readonly packageVersion: string;
  readonly license: {
    readonly spdxId: string;
    readonly sourceUrl: string;
  };
}): ExecutableRulesetPackage => {
  if (input.decision?.decision !== "approved") {
    throw new RulePublicationError(
      "candidate-not-approved",
      "Only an explicitly approved Rule Candidate can be published.",
    );
  }
  let expectedApproval: RuleApproval;
  try {
    expectedApproval = recordRuleApproval({
      review: input.review,
      reviewerId: input.decision.reviewerId,
      decision: input.decision.decision,
      decidedAt: input.decision.decidedAt,
    });
  } catch {
    throw new RulePublicationError(
      "invalid-approval",
      "The approval record is incomplete or malformed.",
    );
  }
  if (canonicalJson(input.decision) !== canonicalJson(expectedApproval)) {
    throw new RulePublicationError(
      "invalid-approval",
      "The approval record must preserve the reviewed Authored Interpretations.",
    );
  }
  const expectedReview = createRuleReview(input.candidate);
  if (
    input.review.candidateVersion !== input.candidate.version ||
    input.decision.candidateVersion !== input.candidate.version ||
    canonicalJson(input.review) !== canonicalJson(expectedReview)
  ) {
    throw new RulePublicationError(
      "review-mismatch",
      "The review and decision must identify the exact candidate version being published.",
    );
  }
  if (!input.review.valid) {
    throw new RulePublicationError(
      "candidate-invalid",
      "A Rule Candidate with validation findings cannot be published.",
    );
  }
  if (
    input.packageVersion.trim() === "" ||
    input.license.spdxId.trim() === "" ||
    input.license.sourceUrl.trim() === ""
  ) {
    throw new RulePublicationError(
      "invalid-package-metadata",
      "A published package requires version and licensing metadata.",
    );
  }
  const packageWithoutChecksum = {
    format: "ai-ttrpg-ruleset-package-v1" as const,
    executable: true as const,
    manifest: {
      id: "micro-ruleset" as const,
      version: input.packageVersion,
      rules: [
        {
          id: input.candidate.rule.id,
          version: input.packageVersion,
          candidateVersion: input.candidate.version,
        },
      ] as const,
    },
    license: input.license,
    approval: input.decision as RuleApproval & {
      readonly decision: "approved";
    },
    rule: {
      id: input.candidate.rule.id,
      name: publishField(input.candidate.rule.name),
      trigger: publishField(input.candidate.rule.trigger),
      prerequisites: publishField(input.candidate.rule.prerequisites),
      inputs: publishField(input.candidate.rule.inputs),
      procedure: publishField(input.candidate.rule.procedure),
      outcomes: publishField(input.candidate.rule.outcomes),
    },
  };
  const checksum = createHash("sha256")
    .update(canonicalJson(packageWithoutChecksum))
    .digest("hex");
  return immutableSnapshot({ ...packageWithoutChecksum, checksum });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const positiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

const isStableSourcePassage = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !nonEmpty(value.documentId) ||
    !nonEmpty(value.documentVersion) ||
    !nonEmpty(value.sectionAnchor) ||
    !nonEmpty(value.passageAnchor) ||
    !nonEmpty(value.text) ||
    !isRecord(value.layout) ||
    !positiveInteger(value.layout.page) ||
    !positiveInteger(value.layout.order)
  ) {
    return false;
  }
  return value.layout.table === undefined ||
    (isRecord(value.layout.table) &&
      positiveInteger(value.layout.table.columns) &&
      positiveInteger(value.layout.table.row));
};

const hasPublishedField = (
  value: unknown,
  validValue: (fieldValue: unknown) => boolean,
): boolean => {
  if (!isRecord(value) || !validValue(value.value) || !Array.isArray(value.citations)) {
    return false;
  }
  return value.attribution === "source-citation"
    ? value.citations.length > 0 && value.citations.every(isStableSourcePassage)
    : value.attribution === "authored-interpretation" &&
      nonEmpty(value.reviewerId) &&
      value.citations.length === 0;
};

const isNonEmptyStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0 && value.every(nonEmpty);

const isExecutableOutcomes = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 3 &&
  Object.entries(CHECK_OUTCOME_RANGES).every(
    ([name, range]) =>
      value.filter(
        (outcome) =>
          isRecord(outcome) && outcome.name === name && outcome.range === range,
      ).length === 1,
  );

const PUBLISHED_RULE_FIELDS = [
  "name",
  "trigger",
  "prerequisites",
  "inputs",
  "procedure",
  "outcomes",
] as const;

const authoredInterpretationsFromPackage = (
  rule: Record<string, unknown>,
): readonly AuthoredInterpretationRecord[] =>
  PUBLISHED_RULE_FIELDS.flatMap((field) => {
    const value = rule[field];
    return isRecord(value) && value.attribution === "authored-interpretation"
      ? [
          {
            field,
            reviewerId: value.reviewerId as string,
            value: value.value,
          },
        ]
      : [];
  });

export function assertApprovedExecutableRulesetPackage(
  value: unknown,
): asserts value is ExecutableRulesetPackage {
  if (!isRecord(value)) {
    throw new Error("Check execution requires an approved executable ruleset package.");
  }
  const manifest = value.manifest;
  const rule = value.rule;
  const approval = value.approval;
  const license = value.license;
  const checksum = value.checksum;
  const rules = isRecord(manifest) && Array.isArray(manifest.rules)
    ? manifest.rules
    : [];
  const manifestRule = rules[0];
  const valid =
    value.format === "ai-ttrpg-ruleset-package-v1" &&
    value.executable === true &&
    typeof checksum === "string" &&
    /^[0-9a-f]{64}$/.test(checksum) &&
    isRecord(manifest) &&
    manifest.id === "micro-ruleset" &&
    typeof manifest.version === "string" &&
    manifest.version.trim() !== "" &&
    rules.length === 1 &&
    isRecord(manifestRule) &&
    manifestRule.id === "micro-ruleset.check" &&
    manifestRule.version === manifest.version &&
    typeof manifestRule.candidateVersion === "string" &&
    /^[0-9a-f]{64}$/.test(manifestRule.candidateVersion) &&
    isRecord(rule) &&
    rule.id === "micro-ruleset.check" &&
    hasPublishedField(rule.name, nonEmpty) &&
    hasPublishedField(rule.trigger, nonEmpty) &&
    hasPublishedField(rule.prerequisites, isNonEmptyStringArray) &&
    hasPublishedField(rule.inputs, isNonEmptyStringArray) &&
    hasPublishedField(
      rule.procedure,
      (procedure) => procedure === "Roll 2d6 and add the relevant Trait.",
    ) &&
    hasPublishedField(rule.outcomes, isExecutableOutcomes) &&
    PUBLISHED_RULE_FIELDS.some((field) => {
      const publishedField = rule[field];
      return isRecord(publishedField) && publishedField.attribution === "source-citation";
    }) &&
    isRecord(approval) &&
    approval.decision === "approved" &&
    approval.candidateVersion === manifestRule.candidateVersion &&
    nonEmpty(approval.reviewerId) &&
    typeof approval.decidedAt === "string" &&
    !Number.isNaN(new Date(approval.decidedAt).valueOf()) &&
    new Date(approval.decidedAt).toISOString() === approval.decidedAt &&
    Array.isArray(approval.authoredInterpretations) &&
    canonicalJson(approval.authoredInterpretations) ===
      canonicalJson(authoredInterpretationsFromPackage(rule)) &&
    isRecord(license) &&
    nonEmpty(license.spdxId) &&
    nonEmpty(license.sourceUrl);
  if (!valid) {
    throw new Error("Check execution requires an approved executable ruleset package.");
  }
  const { checksum: _checksum, ...withoutChecksum } = value;
  const expectedChecksum = createHash("sha256")
    .update(canonicalJson(withoutChecksum))
    .digest("hex");
  if (checksum !== expectedChecksum) {
    throw new Error("Check execution requires an approved executable ruleset package.");
  }
}

export const publishedCheckRuleReference = (
  rulesetPackage: ExecutableRulesetPackage,
): PublishedCheckRuleReference => {
  assertApprovedExecutableRulesetPackage(rulesetPackage);
  const mechanicalPassages = [
    ...rulesetPackage.rule.procedure.citations,
    ...rulesetPackage.rule.outcomes.citations,
  ];
  const citedPassages =
    mechanicalPassages.length > 0
      ? mechanicalPassages
      : PUBLISHED_RULE_FIELDS.flatMap(
          (field) => rulesetPackage.rule[field].citations,
        );
  const sourcePassages = citedPassages.filter(
    (passage, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.documentId === passage.documentId &&
          candidate.documentVersion === passage.documentVersion &&
          candidate.passageAnchor === passage.passageAnchor,
      ) === index,
  );
  return immutableSnapshot({
    id: rulesetPackage.rule.id,
    version: rulesetPackage.manifest.version,
    packageChecksum: rulesetPackage.checksum,
    sourcePassages,
  });
};
