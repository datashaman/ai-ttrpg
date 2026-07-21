import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assembleActorScopedEvidence,
  type RetrievalEntity,
} from "../src/actor-scoped-retrieval.js";
import {
  evaluateRetrieval,
  type RetrievalEvaluationCase,
  type RetrievalEvaluationReport,
} from "../src/retrieval-evaluation.js";
import {
  ingestAnchoredRuleSource,
  type ExtractedRuleDraft,
} from "../src/rule-authoring.js";
import {
  createRuleReview,
  publishApprovedRulePackage,
  recordRuleApproval,
} from "../src/rule-publication.js";
import type { CanonicalEvent } from "../src/structured-play.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type WorldKnowledgeEstablishedPayload,
} from "../src/world-knowledge.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";

test("retrieval evaluation reports ranked quality and forbidden leakage by kind", () => {
  const report = evaluateRetrieval({
    evaluationId: "worked-example",
    k: 2,
    thresholds: {
      minimumPrecisionAtK: 0.75,
      minimumRecallAtK: 0.75,
      minimumMeanReciprocalRank: 0.75,
      minimumUnambiguousEntityLinkAccuracy: 0.95,
      maximumForbiddenDataLeakage: 0,
    },
    cases: [
      {
        id: "entity-hit",
        retrievalKind: "entity",
        referenceKind: "unambiguous",
        expectedUnambiguousEntityId: "entity:mara",
        expectedItemIds: ["entity:mara"],
        retrievedItemIds: ["entity:mara", "entity:porter"],
        forbiddenItemIds: ["entity:secret"],
      },
      {
        id: "entity-miss",
        retrievalKind: "entity",
        referenceKind: "unambiguous",
        expectedUnambiguousEntityId: "entity:elias",
        expectedItemIds: ["entity:elias"],
        retrievedItemIds: ["entity:porter", "entity:elias"],
        forbiddenItemIds: ["entity:secret"],
      },
      {
        id: "rule-leak",
        retrievalKind: "rule",
        expectedItemIds: ["rule:check"],
        retrievedItemIds: ["rule:hidden", "rule:check"],
        forbiddenItemIds: ["rule:hidden"],
      },
    ],
  });

  assert.deepEqual(report.byKind, {
    entity: {
      caseCount: 2,
      precisionAtK: 0.5,
      recallAtK: 1,
      meanReciprocalRank: 0.75,
      forbiddenDataLeakage: 0,
    },
    rule: {
      caseCount: 1,
      precisionAtK: 0.5,
      recallAtK: 1,
      meanReciprocalRank: 0.5,
      forbiddenDataLeakage: 1,
    },
  });
  assert.equal(report.unambiguousEntityLinkAccuracy, 0.5);
  assert.equal(report.totalForbiddenDataLeakage, 1);
  assert.equal(report.passed, false);
  assert.deepEqual(report.failedThresholds, [
    "entity precision@2 0.5000 < 0.7500",
    "rule precision@2 0.5000 < 0.7500",
    "rule mean reciprocal rank 0.5000 < 0.7500",
    "unambiguous entity-link accuracy 0.5000 < 0.9500",
    "forbidden-data leakage 1 > 0",
  ]);
});

test("retrieval evaluation rejects an unambiguous mention without one labelled target", () => {
  assert.throws(
    () =>
      evaluateRetrieval({
        evaluationId: "invalid-label",
        k: 1,
        thresholds: {
          minimumPrecisionAtK: 0,
          minimumRecallAtK: 0,
          minimumMeanReciprocalRank: 0,
          minimumUnambiguousEntityLinkAccuracy: 0,
          maximumForbiddenDataLeakage: 0,
        },
        cases: [
          {
            id: "blank-target",
            retrievalKind: "entity",
            referenceKind: "unambiguous",
            expectedUnambiguousEntityId: "",
            expectedItemIds: [],
            retrievedItemIds: [],
            forbiddenItemIds: [],
          },
        ],
      }),
    /requires one expected entity ID/,
  );
});

interface BenchmarkCaseBase {
  readonly id: string;
  readonly coverage: string;
  readonly taskType?: "interpret-player-input" | "explain-rules";
  readonly utterance: string;
  readonly maxItems?: number;
  readonly expectedItemIds: readonly string[];
  readonly forbiddenItemIds: readonly string[];
}

type BenchmarkCase = BenchmarkCaseBase &
  (
    | {
        readonly retrievalKind: "entity";
        readonly referenceKind: "unambiguous";
        readonly expectedUnambiguousEntityId: string;
      }
    | {
        readonly retrievalKind: "entity";
        readonly referenceKind?: "ambiguous";
        readonly expectedUnambiguousEntityId?: never;
      }
    | {
        readonly retrievalKind: "relationship" | "rule" | "event";
        readonly referenceKind?: never;
        readonly expectedUnambiguousEntityId?: never;
      }
  );

interface RetrievalBenchmark {
  readonly id: string;
  readonly schemaVersion: number;
  readonly k: number;
  readonly corpusScale: {
    readonly entities: number;
    readonly visibleRelationships: number;
    readonly forbiddenRelationships: number;
    readonly approvedRulePackages: number;
    readonly acceptedEventDistractors: number;
  };
  readonly semanticFallbackDecision: "accept" | "reject";
  readonly expectedDeterministicBaselineFailures: readonly string[];
  readonly expectedMeasurements: {
    readonly byKind: RetrievalEvaluationReport["byKind"];
    readonly unambiguousEntityLinkAccuracy: number;
    readonly totalForbiddenDataLeakage: number;
  };
  readonly thresholds: {
    readonly minimumPrecisionAtK: number;
    readonly minimumRecallAtK: number;
    readonly minimumMeanReciprocalRank: number;
    readonly minimumUnambiguousEntityLinkAccuracy: number;
    readonly maximumForbiddenDataLeakage: number;
  };
  readonly cases: readonly BenchmarkCase[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isRate = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 1;

const parseBenchmark = (json: string): RetrievalBenchmark => {
  const value: unknown = JSON.parse(json);
  const thresholds = isRecord(value) && isRecord(value.thresholds)
    ? value.thresholds
    : null;
  const corpusScale = isRecord(value) && isRecord(value.corpusScale)
    ? value.corpusScale
    : null;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.schemaVersion !== 1 ||
    !Number.isInteger(value.k) ||
    thresholds === null ||
    !isRate(thresholds.minimumPrecisionAtK) ||
    !isRate(thresholds.minimumRecallAtK) ||
    !isRate(thresholds.minimumMeanReciprocalRank) ||
    !isRate(thresholds.minimumUnambiguousEntityLinkAccuracy) ||
    !Number.isInteger(thresholds.maximumForbiddenDataLeakage) ||
    Number(thresholds.maximumForbiddenDataLeakage) < 0 ||
    corpusScale === null ||
    !Number.isInteger(corpusScale.entities) ||
    Number(corpusScale.entities) < 1 ||
    !Number.isInteger(corpusScale.visibleRelationships) ||
    Number(corpusScale.visibleRelationships) < 1 ||
    !Number.isInteger(corpusScale.forbiddenRelationships) ||
    Number(corpusScale.forbiddenRelationships) < 1 ||
    !Number.isInteger(corpusScale.approvedRulePackages) ||
    Number(corpusScale.approvedRulePackages) < 1 ||
    !Number.isInteger(corpusScale.acceptedEventDistractors) ||
    Number(corpusScale.acceptedEventDistractors) < 1 ||
    (value.semanticFallbackDecision !== "accept" &&
      value.semanticFallbackDecision !== "reject") ||
    !isStringArray(value.expectedDeterministicBaselineFailures) ||
    !Array.isArray(value.cases)
  ) {
    throw new TypeError("Invalid retrieval benchmark header.");
  }

  value.cases.forEach((candidate, index) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.coverage !== "string" ||
      typeof candidate.utterance !== "string" ||
      !["entity", "relationship", "rule", "event"].includes(
        String(candidate.retrievalKind),
      ) ||
      !isStringArray(candidate.expectedItemIds) ||
      !isStringArray(candidate.forbiddenItemIds) ||
      (candidate.maxItems !== undefined &&
        (!Number.isInteger(candidate.maxItems) || Number(candidate.maxItems) < 1)) ||
      (candidate.taskType !== undefined &&
        candidate.taskType !== "interpret-player-input" &&
        candidate.taskType !== "explain-rules")
    ) {
      throw new TypeError(`Invalid retrieval benchmark case at index ${index}.`);
    }
    const unambiguous =
      candidate.retrievalKind === "entity" &&
      candidate.referenceKind === "unambiguous";
    if (
      (unambiguous &&
        (typeof candidate.expectedUnambiguousEntityId !== "string" ||
          candidate.expectedUnambiguousEntityId.trim() === "")) ||
      (!unambiguous && candidate.expectedUnambiguousEntityId !== undefined) ||
      (candidate.referenceKind !== undefined &&
        candidate.referenceKind !== "unambiguous" &&
        candidate.referenceKind !== "ambiguous") ||
      (candidate.retrievalKind !== "entity" &&
        candidate.referenceKind !== undefined)
    ) {
      throw new TypeError(
        `Invalid labelled entity reference in benchmark case ${candidate.id}.`,
      );
    }
  });

  return value as unknown as RetrievalBenchmark;
};

const benchmarkJson = (): string =>
  readFileSync(
    new URL(
      "../benchmarks/actor-scoped-retrieval-v1.json",
      import.meta.url,
    ),
    "utf8",
  );

const mutableBenchmarkRecord = (): Record<string, unknown> =>
  JSON.parse(benchmarkJson()) as Record<string, unknown>;

const benchmark = (): RetrievalBenchmark => parseBenchmark(benchmarkJson());

test("the benchmark schema rejects an unambiguous JSON case without one labelled target", () => {
  const fixture = mutableBenchmarkRecord();
  const cases = fixture.cases as Record<string, unknown>[];
  delete cases[0]!.expectedUnambiguousEntityId;

  assert.throws(
    () => parseBenchmark(JSON.stringify(fixture)),
    /Invalid labelled entity reference/,
  );
});

test("the benchmark schema rejects missing approved threshold fields", () => {
  const fixture = mutableBenchmarkRecord();
  delete (fixture.thresholds as Record<string, unknown>).minimumRecallAtK;

  assert.throws(
    () => parseBenchmark(JSON.stringify(fixture)),
    /Invalid retrieval benchmark header/,
  );
});

const cited = <Value>(value: Value, ...passageAnchors: string[]) => ({
  value,
  attribution: { kind: "source-citation" as const, passageAnchors },
});

const publishedCheckPackage = (version: string) => {
  const candidate = ingestAnchoredRuleSource({
    source: {
      format: "ai-ttrpg-rule-source-v1",
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
          ],
        },
      ],
    },
    extraction: {
      ruleId: "micro-ruleset.check",
      name: cited("Check", "checks.definition"),
      trigger: cited(
        "An uncertain Player Character action has meaningful consequences.",
        "checks.definition",
      ),
      prerequisites: cited(
        ["The attempted goal and relevant Trait are confirmed."],
        "checks.definition",
      ),
      inputs: cited(["2d6", "relevant Trait"], "checks.procedure"),
      procedure: cited(
        "Roll 2d6 and add the relevant Trait.",
        "checks.procedure",
      ),
      outcomes: cited(
        [
          { name: "Setback", range: "6 or less" },
          { name: "Success with Cost", range: "7-9" },
          { name: "Clean Success", range: "10 or more" },
        ],
        "checks.outcomes",
      ),
    } satisfies ExtractedRuleDraft,
  });
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

test("the versioned campaign corpus measures retrieval gaps against approved thresholds and drives fallback policy", () => {
  const fixture = benchmark();
  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(
    new Set(fixture.cases.map(({ coverage }) => coverage)),
    new Set([
      "unambiguous-reference",
      "ambiguous-reference",
      "relationship",
      "rule",
      "causal-event",
      "budget-pressure",
      "forbidden-knowledge",
      "semantic-gap",
      "confusable-ranking",
    ]),
  );

  const visibleRelationshipDistractors: readonly WorldKnowledgeEstablishedPayload[] =
    Array.from({ length: 12 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return {
        fact: {
          id: `gallery-token-${suffix}`,
          text: `Gallery token ${suffix} rests in display case ${suffix}.`,
        },
        provenance: {
          originKind: "authored-content" as const,
          sourceReference: `locked-manor:gallery-token-${suffix}`,
        },
        visibility: "Player-visible" as const,
        knowledgeScope: ["Player Character" as const],
        endpointFacts: [
          {
            fact: {
              id: `gallery-case-${suffix}`,
              text: `Display case ${suffix} stands in the east gallery.`,
            },
            provenance: {
              originKind: "authored-content" as const,
              sourceReference: `locked-manor:gallery-case-${suffix}`,
            },
            visibility: "Player-visible" as const,
            knowledgeScope: ["Player Character" as const],
          },
        ],
        relationships: [
          {
            relationship: {
              id: `gallery-token-opens-case-${suffix}`,
              type: "opens",
              sourceId: `gallery-token-${suffix}`,
              targetId: `gallery-case-${suffix}`,
              content: `Gallery token ${suffix} opens display case ${suffix}.`,
              requiredWorldKnowledgeIds: [
                `gallery-token-${suffix}`,
                `gallery-case-${suffix}`,
              ],
            },
            provenance: {
              originKind: "authored-content" as const,
              sourceReference: `locked-manor:gallery-token-opens-case-${suffix}`,
            },
            visibility: "Player-visible" as const,
            knowledgeScope: ["Player Character" as const],
          },
        ],
      };
    });

  const { app, eventStore } = beginAdventureFixture({
    applicationOptions: {
      authoredWorldKnowledge: [
        {
          fact: {
            id: "archive-key",
            text: "A spiral-toothed archive key rests in the curator's cabinet.",
          },
          provenance: {
            originKind: "authored-content",
            sourceReference: "locked-manor:archive-key",
          },
          visibility: "Player-visible",
          knowledgeScope: ["Player Character"],
          endpointFacts: [
            {
              fact: {
                id: "iron-archive-hatch",
                text: "An iron archive hatch seals the west alcove.",
              },
              provenance: {
                originKind: "authored-content",
                sourceReference: "locked-manor:iron-archive-hatch",
              },
              visibility: "Player-visible",
              knowledgeScope: ["Player Character"],
            },
          ],
          relationships: [
            {
              relationship: {
                id: "archive-key-unlocks-hatch",
                type: "unlocks",
                sourceId: "archive-key",
                targetId: "iron-archive-hatch",
                content: "The spiral-toothed archive key unlocks the iron archive hatch.",
                requiredWorldKnowledgeIds: [
                  "archive-key",
                  "iron-archive-hatch",
                ],
              },
              provenance: {
                originKind: "authored-content",
                sourceReference: "locked-manor:archive-key-unlocks-hatch",
              },
              visibility: "Player-visible",
              knowledgeScope: ["Player Character"],
            },
          ],
        },
        {
          fact: {
            id: "cultist-hatch-control",
            text: "A hidden cultist can seal the iron archive hatch remotely.",
          },
          provenance: {
            originKind: "authored-content",
            sourceReference: "locked-manor:cultist-hatch-control",
          },
          visibility: "Game Master-only",
          knowledgeScope: ["Game Master"],
          endpointFacts: [
            {
              fact: {
                id: "cultist-control-device",
                text: "A concealed control device is wired to the hatch.",
              },
              provenance: {
                originKind: "authored-content",
                sourceReference: "locked-manor:cultist-control-device",
              },
              visibility: "Game Master-only",
              knowledgeScope: ["Game Master"],
            },
          ],
          relationships: [
            {
              relationship: {
                id: "cultist-controls-hatch",
                type: "controls",
                sourceId: "cultist-hatch-control",
                targetId: "cultist-control-device",
                content: "The hidden cultist controls the iron archive hatch.",
                requiredWorldKnowledgeIds: [
                  "cultist-hatch-control",
                  "cultist-control-device",
                ],
              },
              provenance: {
                originKind: "authored-content",
                sourceReference: "locked-manor:cultist-controls-hatch",
              },
              visibility: "Game Master-only",
              knowledgeScope: ["Game Master"],
            },
          ],
        },
        ...visibleRelationshipDistractors,
      ],
    },
  });
  const coreEntities: readonly RetrievalEntity[] = [
    {
      id: "character:mara-vey",
      kind: "Player Character",
      name: "Mara Vey",
      aliases: ["Mara", "the investigator"],
      pronouns: ["she", "her"],
      locationId: "location:manor-gate",
      activeInScene: "arrival",
      sourceReference: "campaign:locked-manor/character:mara-vey",
      visibility: "Player-visible",
      playerCharacterIds: ["player-character:primary"],
    },
    {
      id: "character:groundskeeper",
      kind: "Non-Player Character",
      name: "Elias Thorn",
      aliases: ["the groundskeeper"],
      pronouns: ["he", "him"],
      locationId: "location:manor-gate",
      activeInScene: "arrival",
      sourceReference: "campaign:locked-manor/character:groundskeeper",
      visibility: "Player-visible",
      playerCharacterIds: ["player-character:primary"],
    },
    {
      id: "location:manor-gate",
      kind: "Location",
      name: "Manor Gate",
      aliases: ["the gate"],
      sourceReference: "campaign:locked-manor/location:manor-gate",
      visibility: "Player-visible",
      playerCharacterIds: ["player-character:primary"],
    },
    {
      id: "character:curator",
      kind: "Non-Player Character",
      name: "Iona Reed",
      aliases: ["the curator"],
      pronouns: ["she", "her"],
      locationId: "location:archive-hall",
      activeInScene: "arrival",
      sourceReference: "campaign:locked-manor/character:curator",
      visibility: "Player-visible",
      playerCharacterIds: ["player-character:primary"],
    },
    {
      id: "location:archive-hall",
      kind: "Location",
      name: "Archive Hall",
      aliases: ["the archive hall"],
      sourceReference: "campaign:locked-manor/location:archive-hall",
      visibility: "Player-visible",
      playerCharacterIds: ["player-character:primary"],
    },
    {
      id: "character:hidden-cultist",
      kind: "Non-Player Character",
      name: "Hidden Cultist",
      aliases: ["the hidden cultist"],
      pronouns: ["they", "them"],
      activeInScene: "arrival",
      sourceReference: "campaign:locked-manor/character:hidden-cultist",
      visibility: "Game Master-only",
      playerCharacterIds: [],
    },
  ];
  const entityDistractors: readonly RetrievalEntity[] = Array.from(
    { length: 40 },
    (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return index % 2 === 0
        ? {
            id: `character:resident-${suffix}`,
            kind: "Non-Player Character" as const,
            name: `Resident ${suffix}`,
            aliases: [`gallery resident ${suffix}`],
            locationId: `location:gallery-${suffix}`,
            activeInScene: "discovery" as const,
            sourceReference: `campaign:locked-manor/character:resident-${suffix}`,
            visibility: "Player-visible" as const,
            playerCharacterIds: ["player-character:primary"],
          }
        : {
            id: `location:gallery-${suffix}`,
            kind: "Location" as const,
            name: `Gallery ${suffix}`,
            aliases: [`gallery room ${suffix}`],
            sourceReference: `campaign:locked-manor/location:gallery-${suffix}`,
            visibility: "Player-visible" as const,
            playerCharacterIds: ["player-character:primary"],
          };
    },
  );
  const entities = [...coreEntities, ...entityDistractors];
  const sourceEvents = eventStore.readAll();
  const eventDistractors: readonly CanonicalEvent[] = Array.from(
    { length: 30 },
    (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return {
        ...sourceEvents[0]!,
        id: `event:catalogue-volume-${suffix}`,
        sequence: sourceEvents.length + index + 1,
        correlationId: `command:catalogue-volume-${suffix}`,
        causationId: `command:catalogue-volume-${suffix}`,
        type: "FreeActionCompleted" as const,
        payload: {
          actionId: `catalogue-volume-${suffix}`,
          establishedFact: {
            id: `volume-catalogued-${suffix}`,
            text: `Gallery volume ${suffix} was catalogued.`,
          },
        },
      };
    },
  );
  const hiddenCultistPlan: CanonicalEvent = {
    ...sourceEvents[0]!,
    id: "event:hidden-cultist-plan",
    sequence: sourceEvents.length + eventDistractors.length + 1,
    correlationId: "command:hidden-cultist-plan",
    causationId: "command:hidden-cultist-plan",
    type: "WorldKnowledgeEstablished",
    payload: {
      fact: {
        id: "hidden-archive-lantern-plan",
        text: "The hidden cultist plans to extinguish archive-lantern.",
      },
      provenance: {
        originKind: "authored-content",
        sourceReference: "locked-manor:hidden-archive-lantern-plan",
      },
      visibility: "Game Master-only",
      knowledgeScope: ["Game Master"],
    },
  };
  const archiveAction: CanonicalEvent = {
    ...sourceEvents[0]!,
    id: "event:archive-lantern-action",
    sequence: sourceEvents.length + eventDistractors.length + 2,
    correlationId: "command:archive-lantern",
    causationId: "command:archive-lantern",
    type: "FreeActionCompleted",
    payload: {
      actionId: "archive-lantern",
      establishedFact: {
        id: "archive-lantern-lit",
        text: "The archive lantern illuminates the west alcove.",
      },
    },
  };
  const archiveConsequence: CanonicalEvent = {
    ...sourceEvents.at(-1)!,
    id: "event:archive-lantern-consequence",
    sequence: sourceEvents.length + eventDistractors.length + 3,
    correlationId: "command:archive-lantern",
    causationId: archiveAction.id,
    type: "SceneStarted",
    payload: { scene: "discovery" },
  };

  const sourceKindByEvaluationKind = {
    entity: "retrieved-entity",
    relationship: "relationship",
    rule: "authority-rule",
    event: "accepted-event",
  } as const;
  const ruleDistractors = Array.from({ length: 8 }, (_, index) =>
    publishedCheckPackage(`0.${index + 1}.0`),
  );
  assert.equal(entities.length, fixture.corpusScale.entities);
  assert.equal(
    visibleRelationshipDistractors.length + 1,
    fixture.corpusScale.visibleRelationships,
  );
  assert.equal(fixture.corpusScale.forbiddenRelationships, 1);
  assert.equal(
    ruleDistractors.length + 2,
    fixture.corpusScale.approvedRulePackages,
  );
  assert.equal(
    eventDistractors.length,
    fixture.corpusScale.acceptedEventDistractors,
  );
  const measuredCases: readonly RetrievalEvaluationCase[] = fixture.cases.map((benchmarkCase) => {
    const bundle = assembleActorScopedEvidence({
      scope: {
        actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
        playerCharacterId: "player-character:primary",
        campaignId: "campaign:locked-manor",
        taskType: benchmarkCase.taskType ?? "interpret-player-input",
        rulesetVersion: "1.0.0",
      },
      corpus: {
        campaignId: "campaign:locked-manor",
        entities,
        acceptedEvents: [
          ...sourceEvents,
          ...eventDistractors,
          hiddenCultistPlan,
          archiveAction,
          archiveConsequence,
        ],
        approvedRules: [
          publishedCheckPackage("0.9.0"),
          publishedCheckPackage("1.0.0"),
          ...ruleDistractors,
        ],
      },
      utterance: benchmarkCase.utterance,
      view: app.view(),
      ...(benchmarkCase.maxItems === undefined
        ? {}
        : { maxItems: benchmarkCase.maxItems }),
    });
    const measurements = {
      id: benchmarkCase.id,
      expectedItemIds: benchmarkCase.expectedItemIds,
      retrievedItemIds: bundle.items
        .filter(
          (item) =>
            item.sourceKind ===
            sourceKindByEvaluationKind[benchmarkCase.retrievalKind],
        )
        .map(({ id }) => id),
      forbiddenItemIds: benchmarkCase.forbiddenItemIds,
    };
    if (
      benchmarkCase.retrievalKind === "entity" &&
      benchmarkCase.referenceKind === "unambiguous" &&
      benchmarkCase.expectedUnambiguousEntityId !== undefined
    ) {
      return {
        ...measurements,
        retrievalKind: "entity",
        referenceKind: "unambiguous",
        expectedUnambiguousEntityId:
          benchmarkCase.expectedUnambiguousEntityId,
      };
    }
    if (benchmarkCase.retrievalKind === "entity") {
      return {
        ...measurements,
        retrievalKind: "entity",
        ...(benchmarkCase.referenceKind === "ambiguous"
          ? { referenceKind: "ambiguous" as const }
          : {}),
      };
    }
    return {
      ...measurements,
      retrievalKind: benchmarkCase.retrievalKind,
    };
  });
  const report = evaluateRetrieval({
    evaluationId: fixture.id,
    k: fixture.k,
    thresholds: fixture.thresholds,
    cases: measuredCases,
  });

  assert.deepEqual(
    report.failedThresholds,
    fixture.expectedDeterministicBaselineFailures,
    JSON.stringify(measuredCases, null, 2),
  );
  assert.equal(report.passed, false);
  assert.equal(fixture.semanticFallbackDecision, "accept");
  assert.equal(
    report.unambiguousEntityLinkAccuracy,
    fixture.expectedMeasurements.unambiguousEntityLinkAccuracy,
  );
  assert.equal(
    report.totalForbiddenDataLeakage,
    fixture.expectedMeasurements.totalForbiddenDataLeakage,
  );
  assert.deepEqual(report.byKind, fixture.expectedMeasurements.byKind);
});
