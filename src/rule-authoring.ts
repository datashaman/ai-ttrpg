import { createHash } from "node:crypto";

import {
  hasExactKeys,
  immutableSnapshot,
  isRecord,
} from "./model-boundary.js";

export const RULE_SOURCE_FORMAT = "ai-ttrpg-rule-source-v1" as const;

export type RulePassageKind =
  | "definition"
  | "procedure"
  | "outcome"
  | "example"
  | "exception"
  | "table"
  | "cross-reference";

export interface RuleSourceLayout {
  readonly page: number;
  readonly order: number;
  readonly table?: {
    readonly columns: number;
    readonly row: number;
  };
}

export interface AnchoredRuleSourcePassage {
  readonly anchor: string;
  readonly kind: RulePassageKind;
  readonly text: string;
  readonly layout: RuleSourceLayout;
}

export interface AnchoredRuleSourceSection {
  readonly anchor: string;
  readonly heading: string;
  readonly layout: RuleSourceLayout;
  readonly passages: readonly AnchoredRuleSourcePassage[];
}

export interface AnchoredRuleSourceDocument {
  readonly format: typeof RULE_SOURCE_FORMAT;
  readonly document: {
    readonly id: string;
    readonly title: string;
    readonly version: string;
  };
  readonly sections: readonly AnchoredRuleSourceSection[];
}

export interface SourceCitationAttribution {
  readonly kind: "source-citation";
  readonly passageAnchors: readonly string[];
}

export interface AuthoredInterpretationAttribution {
  readonly kind: "authored-interpretation";
  readonly reviewerId: string;
}

export type RuleFieldAttribution =
  | SourceCitationAttribution
  | AuthoredInterpretationAttribution;

export interface ExtractedRuleField<Value> {
  readonly value: Value;
  readonly attribution: RuleFieldAttribution;
}

const MICRO_RULESET_OUTCOME_NAMES = [
  "Setback",
  "Success with Cost",
  "Clean Success",
] as const;

type MicroRulesetOutcomeName = (typeof MICRO_RULESET_OUTCOME_NAMES)[number];

export interface RuleOutcomeDraft {
  readonly name: MicroRulesetOutcomeName;
  readonly range: string;
}

export interface ExtractedRuleDraft {
  readonly ruleId: "micro-ruleset.check";
  readonly name: ExtractedRuleField<string>;
  readonly trigger: ExtractedRuleField<string>;
  readonly prerequisites: ExtractedRuleField<readonly string[]>;
  readonly inputs: ExtractedRuleField<readonly string[]>;
  readonly procedure: ExtractedRuleField<string>;
  readonly outcomes: ExtractedRuleField<readonly RuleOutcomeDraft[]>;
}

export interface StableRuleSourcePassage {
  readonly documentId: string;
  readonly documentVersion: string;
  readonly sectionAnchor: string;
  readonly passageAnchor: string;
  readonly text: string;
  readonly layout: RuleSourceLayout;
}

export type CandidateRuleField<Value> =
  | {
      readonly value: Value;
      readonly attribution: "source-citation";
      readonly passages: readonly StableRuleSourcePassage[];
    }
  | {
      readonly value: Value;
      readonly attribution: "authored-interpretation";
      readonly reviewerId: string;
      readonly passages: readonly [];
    };

export interface CitedRuleCandidate {
  readonly status: "candidate";
  readonly executable: false;
  readonly version: string;
  readonly source: AnchoredRuleSourceDocument;
  readonly rule: {
    readonly id: "micro-ruleset.check";
    readonly name: CandidateRuleField<string>;
    readonly trigger: CandidateRuleField<string>;
    readonly prerequisites: CandidateRuleField<readonly string[]>;
    readonly inputs: CandidateRuleField<readonly string[]>;
    readonly procedure: CandidateRuleField<string>;
    readonly outcomes: CandidateRuleField<readonly RuleOutcomeDraft[]>;
  };
}

export type RuleSourceIngestionErrorCode =
  | "malformed-source"
  | "missing-anchor"
  | "unsupported-structure"
  | "invalid-candidate";

export class RuleSourceIngestionError extends Error {
  constructor(
    readonly code: RuleSourceIngestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuleSourceIngestionError";
  }
}

const PASSAGE_KINDS = new Set<RulePassageKind>([
  "definition",
  "procedure",
  "outcome",
  "example",
  "exception",
  "table",
  "cross-reference",
]);

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const positiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

const isMicroRulesetOutcomeName = (
  value: unknown,
): value is MicroRulesetOutcomeName =>
  typeof value === "string" &&
  (MICRO_RULESET_OUTCOME_NAMES as readonly string[]).includes(value);

const validateLayout = (
  value: unknown,
  context: string,
): void => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, value.table === undefined ? ["page", "order"] : ["page", "order", "table"]) ||
    !positiveInteger(value.page) ||
    !positiveInteger(value.order)
  ) {
    throw new RuleSourceIngestionError(
      "malformed-source",
      `${context} has invalid layout metadata.`,
    );
  }
  if (
    value.table !== undefined &&
    (!isRecord(value.table) ||
      !hasExactKeys(value.table, ["columns", "row"]) ||
      !positiveInteger(value.table.columns) ||
      !positiveInteger(value.table.row))
  ) {
    throw new RuleSourceIngestionError(
      "malformed-source",
      `${context} has invalid table layout metadata.`,
    );
  }
};

interface IndexedPassage {
  readonly sectionAnchor: string;
  readonly passage: AnchoredRuleSourcePassage;
}

const validateSource = (
  value: unknown,
): Map<string, IndexedPassage> => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["format", "document", "sections"]) ||
    value.format !== RULE_SOURCE_FORMAT ||
    !isRecord(value.document) ||
    !hasExactKeys(value.document, ["id", "title", "version"]) ||
    !nonEmpty(value.document.id) ||
    !nonEmpty(value.document.title) ||
    !nonEmpty(value.document.version) ||
    !Array.isArray(value.sections) ||
    value.sections.length === 0
  ) {
    throw new RuleSourceIngestionError(
      "malformed-source",
      "The rule source does not match the supported document schema.",
    );
  }

  const sectionAnchors = new Set<string>();
  const passages = new Map<string, IndexedPassage>();
  for (const sectionValue of value.sections) {
    if (
      !isRecord(sectionValue) ||
      !hasExactKeys(sectionValue, ["anchor", "heading", "layout", "passages"]) ||
      !nonEmpty(sectionValue.heading) ||
      !Array.isArray(sectionValue.passages) ||
      sectionValue.passages.length === 0
    ) {
      throw new RuleSourceIngestionError(
        "malformed-source",
        "A rule source section is malformed.",
      );
    }
    if (!nonEmpty(sectionValue.anchor)) {
      throw new RuleSourceIngestionError(
        "missing-anchor",
        "Every source section requires a stable anchor.",
      );
    }
    if (sectionAnchors.has(sectionValue.anchor)) {
      throw new RuleSourceIngestionError(
        "malformed-source",
        `Duplicate section anchor: ${sectionValue.anchor}.`,
      );
    }
    sectionAnchors.add(sectionValue.anchor);
    validateLayout(sectionValue.layout, `Section ${sectionValue.anchor}`);

    for (const passageValue of sectionValue.passages) {
      if (
        !isRecord(passageValue) ||
        !hasExactKeys(passageValue, ["anchor", "kind", "text", "layout"]) ||
        !nonEmpty(passageValue.text)
      ) {
        throw new RuleSourceIngestionError(
          "malformed-source",
          `Section ${sectionValue.anchor} contains a malformed passage.`,
        );
      }
      if (!nonEmpty(passageValue.anchor)) {
        throw new RuleSourceIngestionError(
          "missing-anchor",
          `Section ${sectionValue.anchor} contains a passage without a stable anchor.`,
        );
      }
      if (!PASSAGE_KINDS.has(passageValue.kind as RulePassageKind)) {
        throw new RuleSourceIngestionError(
          "unsupported-structure",
          `Unsupported passage structure: ${String(passageValue.kind)}.`,
        );
      }
      validateLayout(
        passageValue.layout,
        `Passage ${passageValue.anchor}`,
      );
      if (
        passageValue.kind !== "table" &&
        (passageValue.layout as RuleSourceLayout).table !== undefined
      ) {
        throw new RuleSourceIngestionError(
          "unsupported-structure",
          `Only table passages may carry table layout metadata: ${passageValue.anchor}.`,
        );
      }
      if (
        passageValue.kind === "table" &&
        (passageValue.layout as RuleSourceLayout).table === undefined
      ) {
        throw new RuleSourceIngestionError(
          "unsupported-structure",
          `Table passage requires table layout metadata: ${passageValue.anchor}.`,
        );
      }
      if (passages.has(passageValue.anchor)) {
        throw new RuleSourceIngestionError(
          "malformed-source",
          `Duplicate passage anchor: ${passageValue.anchor}.`,
        );
      }
      passages.set(passageValue.anchor, {
        sectionAnchor: sectionValue.anchor,
        passage: passageValue as unknown as AnchoredRuleSourcePassage,
      });
    }
  }
  return passages;
};

const sourcePassage = (
  source: AnchoredRuleSourceDocument,
  indexed: IndexedPassage,
): StableRuleSourcePassage => ({
  documentId: source.document.id,
  documentVersion: source.document.version,
  sectionAnchor: indexed.sectionAnchor,
  passageAnchor: indexed.passage.anchor,
  text: indexed.passage.text,
  layout: indexed.passage.layout,
});

const attributedField = <Value>(
  source: AnchoredRuleSourceDocument,
  passages: ReadonlyMap<string, IndexedPassage>,
  fieldName: string,
  field: ExtractedRuleField<Value>,
): CandidateRuleField<Value> => {
  if (!isRecord(field) || !hasExactKeys(field, ["value", "attribution"]) || !isRecord(field.attribution)) {
    throw new RuleSourceIngestionError(
      "invalid-candidate",
      `Candidate field ${fieldName} is malformed.`,
    );
  }
  if (field.attribution.kind === "source-citation") {
    if (
      !hasExactKeys(field.attribution, ["kind", "passageAnchors"]) ||
      !Array.isArray(field.attribution.passageAnchors) ||
      field.attribution.passageAnchors.length === 0 ||
      !field.attribution.passageAnchors.every(nonEmpty)
    ) {
      throw new RuleSourceIngestionError(
        "invalid-candidate",
        `Candidate field ${fieldName} requires at least one source passage.`,
      );
    }
    const cited = field.attribution.passageAnchors.map((anchor) => {
      const indexed = passages.get(anchor);
      if (indexed === undefined) {
        throw new RuleSourceIngestionError(
          "missing-anchor",
          `Candidate field ${fieldName} cites missing passage ${anchor}.`,
        );
      }
      return sourcePassage(source, indexed);
    });
    return {
      value: field.value,
      attribution: "source-citation",
      passages: cited,
    };
  }
  if (
    field.attribution.kind === "authored-interpretation" &&
    hasExactKeys(field.attribution, ["kind", "reviewerId"]) &&
    nonEmpty(field.attribution.reviewerId)
  ) {
    return {
      value: field.value,
      attribution: "authored-interpretation",
      reviewerId: field.attribution.reviewerId,
      passages: [],
    };
  }
  throw new RuleSourceIngestionError(
    "invalid-candidate",
    `Candidate field ${fieldName} has invalid attribution.`,
  );
};

const stringField = (fieldName: string, field: unknown): void => {
  if (!isRecord(field) || !nonEmpty(field.value)) {
    throw new RuleSourceIngestionError(
      "invalid-candidate",
      `Candidate field ${fieldName} requires a non-empty string.`,
    );
  }
};

const stringArrayField = (fieldName: string, field: unknown): void => {
  if (
    !isRecord(field) ||
    !Array.isArray(field.value) ||
    field.value.length === 0 ||
    !field.value.every(nonEmpty)
  ) {
    throw new RuleSourceIngestionError(
      "invalid-candidate",
      `Candidate field ${fieldName} requires non-empty strings.`,
    );
  }
};

const validateExtraction = (value: unknown): void => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "ruleId",
      "name",
      "trigger",
      "prerequisites",
      "inputs",
      "procedure",
      "outcomes",
    ])
  ) {
    throw new RuleSourceIngestionError(
      "invalid-candidate",
      "The extracted rule does not match the candidate schema.",
    );
  }
  if (value.ruleId !== "micro-ruleset.check") {
    throw new RuleSourceIngestionError(
      "unsupported-structure",
      `Unsupported rule candidate: ${String(value.ruleId)}.`,
    );
  }
  stringField("name", value.name);
  stringField("trigger", value.trigger);
  stringArrayField("prerequisites", value.prerequisites);
  stringArrayField("inputs", value.inputs);
  stringField("procedure", value.procedure);
  const outcomeValues =
    isRecord(value.outcomes) && Array.isArray(value.outcomes.value)
      ? value.outcomes.value
      : null;
  if (
    outcomeValues === null ||
    outcomeValues.length !== 3 ||
    !outcomeValues.every(
      (outcome) =>
        isRecord(outcome) &&
        hasExactKeys(outcome, ["name", "range"]) &&
        isMicroRulesetOutcomeName(outcome.name) &&
        nonEmpty(outcome.range),
    ) ||
    !MICRO_RULESET_OUTCOME_NAMES.every(
      (expectedName) =>
        outcomeValues.filter(
          (outcome) => isRecord(outcome) && outcome.name === expectedName,
        ).length === 1,
    )
  ) {
    throw new RuleSourceIngestionError(
      "invalid-candidate",
      "Candidate field outcomes requires the three Micro-ruleset outcomes.",
    );
  }
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const ingestAnchoredRuleSource = (input: {
  readonly source: AnchoredRuleSourceDocument;
  readonly extraction: ExtractedRuleDraft;
}): CitedRuleCandidate => {
  const passages = validateSource(input.source);
  validateExtraction(input.extraction);

  const candidateWithoutVersion = {
    status: "candidate" as const,
    executable: false as const,
    source: input.source,
    rule: {
      id: input.extraction.ruleId,
      name: attributedField(input.source, passages, "name", input.extraction.name),
      trigger: attributedField(input.source, passages, "trigger", input.extraction.trigger),
      prerequisites: attributedField(
        input.source,
        passages,
        "prerequisites",
        input.extraction.prerequisites,
      ),
      inputs: attributedField(input.source, passages, "inputs", input.extraction.inputs),
      procedure: attributedField(
        input.source,
        passages,
        "procedure",
        input.extraction.procedure,
      ),
      outcomes: attributedField(
        input.source,
        passages,
        "outcomes",
        input.extraction.outcomes,
      ),
    },
  };
  const version = createHash("sha256")
    .update(canonicalJson(candidateWithoutVersion))
    .digest("hex");
  return immutableSnapshot({ ...candidateWithoutVersion, version });
};
