import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type CheckActionDefinition,
  type Likelihood,
} from "../src/structured-play.js";

const beginArrivalWithEvidence = (seed: number) => {
  const app = createStructuredPlayApplication({
    randomSource: createSeededRandomSource(seed),
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  return app;
};

const proposition = {
  id: "someone-inside-manor",
  text: "Is someone currently inside the manor?",
  answers: {
    Yes: {
      id: "someone-inside-manor-yes",
      text: "Someone is currently inside the manor.",
    },
    No: {
      id: "someone-inside-manor-no",
      text: "No one is currently inside the manor.",
    },
  },
  exceptionalConsequences: {
    favourable: {
      kind: "favourable",
      establishedFact: {
        id: "brass-key-by-footprints",
        text: "A recently dropped brass key lies beside the fresh footprints.",
      },
    },
    adverse: {
      kind: "adverse",
      establishedFact: {
        id: "sprung-warning-bell",
        text: "The fresh footprints cross a sprung warning bell at the side entrance.",
      },
    },
  },
} as const;

const recommend = (seed: number, likelihood: Likelihood) => {
  const app = beginArrivalWithEvidence(seed);
  const result = app.submit({
    type: "recommend-likelihood",
    proposition,
    likelihood,
    supportingFactIds: ["fresh-footprints"],
  });
  assert.equal(result.status, "accepted");
  const recommendation = result.state.pendingNarratorRecommendation;
  assert.ok(recommendation);
  return { app, recommendation };
};

test("Player confirms a grounded Likelihood before the Oracle establishes an answer", () => {
  const app = beginArrivalWithEvidence(140);

  const recommended = app.submit({
    type: "recommend-likelihood",
    proposition,
    likelihood: "Likely",
    supportingFactIds: ["fresh-footprints"],
  });

  assert.equal(recommended.status, "accepted");
  const recommendation = recommended.state.pendingNarratorRecommendation;
  assert.ok(recommendation);
  assert.equal(recommended.state.lastOracleResolution, null);
  assert.deepEqual(recommendation.evidence, [
    {
      id: "fresh-footprints",
      text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
    },
  ]);
  assert.deepEqual(
    recommended.appendedEvents.map((event) => event.type),
    ["NarratorLikelihoodRecommended"],
  );

  const answered = app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood: "Likely",
  });

  assert.equal(answered.status, "accepted");
  assert.equal(answered.state.pendingNarratorRecommendation, null);
  assert.deepEqual(answered.state.lastOracleResolution, {
    recommendationId: recommendation.id,
    establishedFact: {
      id: "someone-inside-manor-yes",
      text: "Someone is currently inside the manor.",
    },
    trace: {
      rule: { id: "micro-ruleset.oracle", version: "1.0.0" },
      random: { source: "seeded-lcg", seed: 140, inputs: [30] },
      proposition: recommendation.proposition,
      recommendation: {
        likelihood: "Likely",
        evidence: recommendation.evidence,
      },
      confirmedLikelihood: "Likely",
      result: {
        roll: 30,
        yesThreshold: 75,
        answer: "Yes",
        exceptionalConsequence: null,
      },
    },
  });
  assert.deepEqual(
    answered.appendedEvents.map((event) => event.type),
    ["OracleAnswered"],
  );
  assert.ok(
    answered.state.establishedFacts.some(
      (fact) =>
        fact.id === "someone-inside-manor-yes" &&
        fact.text === "Someone is currently inside the manor.",
    ),
  );
});

for (const example of [
  { likelihood: "Unlikely", threshold: 25, yesSeed: 11, noSeed: 36 },
  { likelihood: "Even", threshold: 50, yesSeed: 656, noSeed: 682 },
  { likelihood: "Likely", threshold: 75, yesSeed: 1301, noSeed: 1327 },
] as const satisfies readonly {
  likelihood: Likelihood;
  threshold: 25 | 50 | 75;
  yesSeed: number;
  noSeed: number;
}[]) {
  for (const answerExample of [
    { answer: "Yes", seed: example.yesSeed, roll: example.threshold },
    { answer: "No", seed: example.noSeed, roll: example.threshold + 1 },
  ] as const) {
    test(`${example.likelihood} answers ${answerExample.answer} at roll ${answerExample.roll}`, () => {
      const { app, recommendation } = recommend(
        answerExample.seed,
        example.likelihood,
      );

      const result = app.submit({
        type: "confirm-oracle-likelihood",
        recommendationId: recommendation.id,
        likelihood: example.likelihood,
      });

      assert.equal(result.status, "accepted");
      assert.equal(
        result.state.lastOracleResolution?.trace.result.roll,
        answerExample.roll,
      );
      assert.equal(
        result.state.lastOracleResolution?.trace.result.yesThreshold,
        example.threshold,
      );
      assert.equal(
        result.state.lastOracleResolution?.trace.result.answer,
        answerExample.answer,
      );
    });
  }
}

for (const example of [
  {
    seed: 2023,
    roll: 3,
    answer: "Yes",
    kind: "favourable",
    consequenceText:
      "A recently dropped brass key lies beside the fresh footprints.",
  },
  {
    seed: 1894,
    roll: 98,
    answer: "No",
    kind: "adverse",
    consequenceText:
      "The fresh footprints cross a sprung warning bell at the side entrance.",
  },
] as const) {
  test(`roll ${example.roll} attaches an ${example.kind} Exceptional Consequence without reversing ${example.answer}`, () => {
    const { app, recommendation } = recommend(example.seed, "Even");

    const result = app.submit({
      type: "confirm-oracle-likelihood",
      recommendationId: recommendation.id,
      likelihood: "Even",
    });

    assert.equal(result.status, "accepted");
    assert.equal(
      result.state.lastOracleResolution?.trace.result.roll,
      example.roll,
    );
    assert.equal(
      result.state.lastOracleResolution?.trace.result.answer,
      example.answer,
    );
    assert.equal(
      result.state.lastOracleResolution?.trace.result.exceptionalConsequence
        ?.kind,
      example.kind,
    );
    assert.equal(
      result.state.lastOracleResolution?.trace.result.exceptionalConsequence
        ?.establishedFact.text,
      example.consequenceText,
    );
    assert.ok(
      result.state.establishedFacts.some(
        (fact) =>
          fact.id ===
          result.state.lastOracleResolution?.trace.result.exceptionalConsequence
            ?.establishedFact.id,
      ),
    );
  });
}

test("Player can change the recommended Likelihood before the percentile roll", () => {
  const { app, recommendation } = recommend(140, "Likely");

  const result = app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood: "Unlikely",
  });

  assert.equal(result.status, "accepted");
  assert.equal(
    result.state.lastOracleResolution?.trace.recommendation.likelihood,
    "Likely",
  );
  assert.equal(
    result.state.lastOracleResolution?.trace.confirmedLikelihood,
    "Unlikely",
  );
  assert.equal(result.state.lastOracleResolution?.trace.result.roll, 30);
  assert.equal(result.state.lastOracleResolution?.trace.result.yesThreshold, 25);
  assert.equal(result.state.lastOracleResolution?.trace.result.answer, "No");
});

test("Narrator recommendation cannot roll or establish the proposition", () => {
  const randomSource = createSeededRandomSource(140);
  const app = createStructuredPlayApplication({ randomSource });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });

  const result = app.submit({
    type: "recommend-likelihood",
    proposition,
    likelihood: "Likely",
    supportingFactIds: ["fresh-footprints"],
  });

  assert.equal(result.status, "accepted");
  assert.equal(randomSource.position(), 0);
  assert.equal(result.state.lastOracleResolution, null);
  assert.equal(
    result.state.establishedFacts.some((fact) =>
      Object.values(proposition.answers).some((answer) => answer.id === fact.id),
    ),
    false,
  );
});

test("Narrator recommendation rejects hidden or absent evidence without persisting it", () => {
  const app = beginArrivalWithEvidence(140);

  const result = app.submit({
    type: "recommend-likelihood",
    proposition,
    likelihood: "Likely",
    supportingFactIds: ["hidden-cultist-allegiance"],
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.code, "invalid-likelihood-recommendation");
  assert.deepEqual(result.appendedEvents, []);
  assert.equal(result.state.pendingNarratorRecommendation, null);
  assert.equal(
    result.state.establishedFacts.some(
      (fact) => fact.id === "hidden-cultist-allegiance",
    ),
    false,
  );
});

test("Oracle answer and Established Fact rebuild from canonical events", () => {
  const eventStore = createInMemoryEventStore();
  const firstSession = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(140),
  });
  firstSession.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  firstSession.submit({ type: "begin-adventure" });
  firstSession.submit({ type: "choose-action", actionId: "survey-manor" });
  const recommended = firstSession.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  });
  const recommendation = recommended.state.pendingNarratorRecommendation;
  assert.ok(recommendation);
  firstSession.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood: "Likely",
  });
  const beforeRestart = firstSession.view();

  const resumed = createStructuredPlayApplication({ eventStore }).view();

  assert.equal(JSON.stringify(resumed), JSON.stringify(beforeRestart));
  assert.deepEqual(
    eventStore.readAll().map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "SceneStarted",
      "FreeActionCompleted",
      "NarratorLikelihoodRecommended",
      "OracleAnswered",
    ],
  );
  assert.equal(
    resumed.state.lastOracleResolution?.trace.rule.id,
    "micro-ruleset.oracle",
  );
  assert.equal(resumed.state.lastCheckResolution, null);
});

test("an Established Proposition cannot be sent back through the Oracle", () => {
  const { app, recommendation } = recommend(140, "Likely");
  app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood: "Likely",
  });

  const repeated = app.submit({
    type: "recommend-likelihood",
    proposition: {
      ...proposition,
      answers: {
        Yes: { id: "alternate-yes", text: "A contradictory Yes answer." },
        No: { id: "alternate-no", text: "A contradictory No answer." },
      },
    },
    likelihood: "Likely",
    supportingFactIds: ["fresh-footprints"],
  });

  assert.equal(repeated.status, "rejected");
  assert.equal(repeated.code, "invalid-likelihood-recommendation");
  assert.deepEqual(repeated.appendedEvents, []);
});

test("Check action definitions cannot establish authored Oracle answer facts", () => {
  const invalidCheckAction: CheckActionDefinition = {
    id: "decide-who-is-inside",
    label: "Decide who is inside with a Check",
    kind: "Check",
    goal: "Determine whether someone is inside the manor",
    trait: "Wits",
    stakes: {
      Setback: {
        summary: "Decide No through Check rules.",
        consequences: [
          { type: "establish-fact", fact: proposition.answers.No },
        ],
      },
      "Success with Cost": {
        summary: "Decide Yes through Check rules with a cost.",
        consequences: [
          { type: "establish-fact", fact: proposition.answers.Yes },
        ],
      },
      "Clean Success": {
        summary: "Decide Yes through Check rules.",
        consequences: [
          { type: "establish-fact", fact: proposition.answers.Yes },
        ],
      },
    },
  };

  assert.throws(
    () => createStructuredPlayApplication({ checkActions: [invalidCheckAction] }),
    /Check actions cannot establish Oracle-owned fact/,
  );
});
