import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleActorScopedEvidence,
  RetrievalScopeError,
  type RetrievalEntity,
} from "../src/actor-scoped-retrieval.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import { DEFAULT_PLAYER_ACTOR_SCOPE } from "../src/world-knowledge.js";
import {
  ingestAnchoredRuleSource,
  type ExtractedRuleDraft,
} from "../src/rule-authoring.js";
import {
  createRuleReview,
  publishApprovedRulePackage,
  recordRuleApproval,
} from "../src/rule-publication.js";

const entities: readonly RetrievalEntity[] = [
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
    aliases: ["the gate", "front gate"],
    sourceReference: "campaign:locked-manor/location:manor-gate",
    visibility: "Player-visible",
    playerCharacterIds: ["player-character:primary"],
  },
] as const;

const retrievalInput = () => {
  const { app, eventStore } = beginAdventureFixture();
  return {
    scope: {
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      playerCharacterId: "player-character:primary",
      campaignId: "campaign:locked-manor",
      taskType: "interpret-player-input" as const,
      rulesetVersion: "1.0.0",
    },
    corpus: {
      campaignId: "campaign:locked-manor",
      entities,
      acceptedEvents: eventStore.readAll(),
      approvedRules: [],
    },
    utterance:
      "At the front gate, ask the groundskeeper if he saw Mara; character:mara-vey can answer too.",
    view: app.view(),
  };
};

const cited = <Value>(value: Value, ...passageAnchors: string[]) => ({
  value,
  attribution: { kind: "source-citation" as const, passageAnchors },
});

const publishedCheckPackage = (version: string) => {
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

test("actor-scoped retrieval requires matching actor, Player Character, campaign, task, and ruleset scope", () => {
  const input = retrievalInput();

  assert.throws(
    () =>
      assembleActorScopedEvidence({
        ...input,
        scope: { ...input.scope, campaignId: "campaign:elsewhere" },
      }),
    (error: unknown) =>
      error instanceof RetrievalScopeError &&
      error.code === "CAMPAIGN_SCOPE_MISMATCH",
  );
  assert.throws(
    () =>
      assembleActorScopedEvidence({
        ...input,
        scope: { ...input.scope, playerCharacterId: "player-character:other" },
      }),
    (error: unknown) =>
      error instanceof RetrievalScopeError &&
      error.code === "ACTOR_SCOPE_MISMATCH",
  );
});

test("entity linking resolves IDs, aliases, names, pronouns, locations, and active participants deterministically", () => {
  const input = retrievalInput();

  const first = assembleActorScopedEvidence(input);
  const second = assembleActorScopedEvidence(input);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.items
      .filter((item) => item.sourceKind === "retrieved-entity")
      .map((item) => item.id),
    [
      "entity:character:mara-vey",
      "entity:character:groundskeeper",
      "entity:location:manor-gate",
    ],
  );
  assert.ok(
    first.items.every(
      (item) =>
        item.visibility === "Player-visible" &&
        item.sourceReference.length > 0 &&
        item.inclusionReason.length > 0,
    ),
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.items), true);
});

test("location and Scene context expand to visible participants without naming them", () => {
  const input = retrievalInput();

  const atLocation = assembleActorScopedEvidence({
    ...input,
    utterance: "Who is at the front gate?",
  });
  assert.deepEqual(
    atLocation.items
      .filter((item) => item.sourceKind === "retrieved-entity")
      .map((item) => item.id),
    [
      "entity:character:mara-vey",
      "entity:character:groundskeeper",
      "entity:location:manor-gate",
    ],
  );

  const activeParticipants = assembleActorScopedEvidence({
    ...input,
    utterance: "Who is here?",
  });
  assert.deepEqual(
    activeParticipants.items
      .filter((item) => item.sourceKind === "retrieved-entity")
      .map((item) => item.id),
    ["entity:character:mara-vey", "entity:character:groundskeeper"],
  );
});

test("forbidden knowledge is filtered before relationship ranking and budgeting", () => {
  const { app, eventStore } = beginAdventureFixture({
    applicationOptions: {
      authoredWorldKnowledge: [
        {
          fact: { id: "visible-clue", text: "A brass key lies beside the gate." },
          provenance: {
            originKind: "authored-content",
            sourceReference: "locked-manor:visible-clue",
          },
          visibility: "Player-visible",
          knowledgeScope: ["Player Character"],
          endpointFacts: [
            {
              fact: { id: "manor-gate", text: "The manor has a locked gate." },
              provenance: {
                originKind: "authored-content",
                sourceReference: "locked-manor:manor-gate",
              },
              visibility: "Player-visible",
              knowledgeScope: ["Player Character"],
            },
          ],
          relationships: [
            {
              relationship: {
                id: "key-opens-gate",
                type: "opens",
                sourceId: "visible-clue",
                targetId: "manor-gate",
                content: "The brass key opens the manor gate.",
                requiredWorldKnowledgeIds: ["visible-clue", "manor-gate"],
              },
              provenance: {
                originKind: "authored-content",
                sourceReference: "locked-manor:key-opens-gate",
              },
              visibility: "Player-visible",
              knowledgeScope: ["Player Character"],
            },
          ],
        },
      ],
    },
  });
  const input = retrievalInput();
  const hiddenEntity: RetrievalEntity = {
    ...entities[1]!,
    id: "character:hidden-cultist",
    name: "Hidden Cultist",
    aliases: ["cultist"],
    sourceReference: "campaign:locked-manor/character:hidden-cultist",
    visibility: "Game Master-only",
    playerCharacterIds: [],
  };

  const bundle = assembleActorScopedEvidence({
    ...input,
    utterance:
      "character:hidden-cultist cultist: how does the brass key open the manor gate?",
    view: app.view(),
    corpus: {
      ...input.corpus,
      entities: [hiddenEntity, ...entities],
      acceptedEvents: eventStore.readAll(),
    },
    maxItems: 3,
  });
  const serialized = JSON.stringify(bundle);

  assert.doesNotMatch(serialized, /hidden-cultist|Hidden Cultist/);
  assert.deepEqual(
    bundle.items.map((item) => item.id),
    ["relationship:key-opens-gate", "fact:visible-clue", "fact:manor-gate"],
  );
  assert.ok(
    bundle.items.every(
      (item) => item.citation?.startsWith("locked-manor:") === true,
    ),
  );
});

test("retrieval selects only the scoped approved rule version with exact citations", () => {
  const input = retrievalInput();
  const bundle = assembleActorScopedEvidence({
    ...input,
    scope: { ...input.scope, taskType: "explain-rules" },
    utterance: "Can I pick the side-door lock?",
    corpus: {
      ...input.corpus,
      approvedRules: [publishedCheckPackage("0.9.0"), publishedCheckPackage("1.0.0")],
    },
  });
  const rules = bundle.items.filter(
    (item) => item.sourceKind === "authority-rule",
  );

  assert.deepEqual(rules.map((item) => item.id), ["rule:micro-ruleset.check@1.0.0"]);
  assert.match(rules[0]?.content ?? "", /uncertain Player Character action/);
  assert.match(rules[0]?.content ?? "", /relevant Trait/);
  assert.match(rules[0]?.citation ?? "", /checks\.definition/);
  assert.match(rules[0]?.citation ?? "", /checks\.procedure/);

  const unrelatedCondition = assembleActorScopedEvidence({
    ...input,
    scope: { ...input.scope, taskType: "explain-rules" },
    utterance: "What does Shaken do?",
    corpus: {
      ...input.corpus,
      approvedRules: [publishedCheckPackage("1.0.0")],
    },
  });
  assert.equal(
    unrelatedCondition.items.some(
      (item) => item.sourceKind === "authority-rule",
    ),
    false,
  );
  const genericVocabulary = assembleActorScopedEvidence({
    ...input,
    scope: { ...input.scope, taskType: "explain-rules" },
    utterance: "What can my Player Character do?",
    corpus: {
      ...input.corpus,
      approvedRules: [publishedCheckPackage("1.0.0")],
    },
  });
  assert.equal(
    genericVocabulary.items.some(
      (item) => item.sourceKind === "authority-rule",
    ),
    false,
  );
});

test("event retrieval keeps causal matches and bounded recent context instead of the whole Timeline", () => {
  const input = retrievalInput();
  const { app, eventStore } = beginAdventureFixture();
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const allEvents = eventStore.readAll();

  const bundle = assembleActorScopedEvidence({
    ...input,
    utterance: "What happened when I used survey-manor at the gate?",
    view: app.view(),
    corpus: { ...input.corpus, acceptedEvents: allEvents },
  });
  const events = bundle.items.filter(
    (item) => item.sourceKind === "accepted-event",
  );

  assert.ok(events.length > 0);
  assert.ok(events.length <= 8);
  assert.ok(events.some((item) => item.content.includes("survey-manor")));
  assert.ok(events.every((item) => item.id.startsWith("event:")));
  assert.ok(events.every((item) => item.citation === item.sourceReference));
  assert.ok(events.length < allEvents.length);
});

test("a lexical event match retrieves its accepted causal chain", () => {
  const input = retrievalInput();
  const sourceEvents = input.corpus.acceptedEvents;
  const action = {
    ...sourceEvents[0]!,
    id: "event:survey-action",
    sequence: 20,
    correlationId: "command:survey",
    causationId: "command:survey",
    type: "FreeActionCompleted" as const,
    payload: {
      actionId: "survey-manor",
      establishedFact: {
        id: "survey-complete",
        text: "The grounds were surveyed.",
      },
    },
  };
  const consequence = {
    ...sourceEvents.at(-1)!,
    id: "event:survey-consequence",
    sequence: 21,
    correlationId: "command:survey",
    causationId: action.id,
    type: "SceneStarted" as const,
    payload: { scene: "discovery" as const },
  };

  const bundle = assembleActorScopedEvidence({
    ...input,
    utterance: "What resulted from survey-manor?",
    corpus: {
      ...input.corpus,
      acceptedEvents: [...sourceEvents, action, consequence],
    },
  });

  assert.deepEqual(
    bundle.items
      .filter((item) => item.sourceKind === "accepted-event")
      .map((item) => item.id),
    ["event:event:survey-action", "event:event:survey-consequence"],
  );
});

test("a pronoun resolves to a recently evidenced referent and duplicate candidates collapse", () => {
  const recentElias: RetrievalEntity = {
    ...entities[1]!,
    activeInScene: "discovery",
  };
  const unrelatedHe: RetrievalEntity = {
    ...entities[1]!,
    id: "character:porter",
    name: "Jon Vale",
    aliases: ["the porter"],
    activeInScene: "discovery",
    sourceReference: "campaign:locked-manor/character:porter",
  };
  const { app, eventStore } = beginAdventureFixture({
    applicationOptions: {
      authoredWorldKnowledge: [
        {
          fact: {
            id: "elias-arrived",
            text: "Elias Thorn arrived at the manor gate.",
          },
          provenance: {
            originKind: "authored-content",
            sourceReference: "locked-manor:elias-arrived",
          },
          visibility: "Player-visible",
          knowledgeScope: ["Player Character"],
        },
      ],
    },
  });
  const input = retrievalInput();

  const bundle = assembleActorScopedEvidence({
    ...input,
    utterance: "Did he see anything?",
    view: app.view(),
    corpus: {
      ...input.corpus,
      entities: [unrelatedHe, recentElias, recentElias],
      acceptedEvents: eventStore.readAll(),
    },
  });

  assert.equal(
    bundle.items.filter((item) => item.id === "entity:character:groundskeeper")
      .length,
    1,
  );
  assert.equal(
    bundle.items.some((item) => item.id === "entity:character:porter"),
    false,
  );
});
