import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  ModelProviderError,
  type ModelProvider,
} from "../src/model-gateway.js";
import { createDeterministicPlayerSession } from "../src/player-ui/deterministic-player-session.js";
import type { PlayerAdventureProjection } from "../src/player-ui/application-client.js";

const normalizeGeneratedIds = (value: unknown): unknown => {
  const ids = new Map<string, string>();
  return JSON.parse(JSON.stringify(value, (_key, candidate: unknown) => {
    if (typeof candidate !== "string") return candidate;
    return candidate.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|evidence:[0-9a-f]{64}/gi,
      (id) => {
        const existing = ids.get(id);
        if (existing !== undefined) return existing;
        const replacement = `generated:${ids.size + 1}`;
        ids.set(id, replacement);
        return replacement;
      },
    );
  }));
};

const canonicalProjectionForParity = (
  projection: PlayerAdventureProjection,
): unknown => ({
  ...projection,
  inputMode: "structured",
  naturalLanguage: {
    available: false,
    pendingProposal: null,
    response: null,
  },
  ledger: projection.ledger.map((entry) => ({
    ...entry,
    inputMode: "Structured Play",
    interpretation: null,
  })),
});

const setup = async (
  session: ReturnType<typeof createDeterministicPlayerSession>,
) => {
  await session.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  await session.submit({ type: "begin-adventure" });
};

const establishArrivalExitConditions = async (
  session: ReturnType<typeof createDeterministicPlayerSession>,
) => {
  await session.submit({ type: "choose-action", actionId: "survey-manor" });
  await session.submit({ type: "choose-action", actionId: "ask-someone-inside-manor" });
  const oracle = session.projection().oracleConfirmation;
  assert.ok(oracle);
  await session.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: oracle.id,
    likelihood: "Likely",
  });
};

const surveyProvider: ModelProvider = {
  provider: "parity-script",
  model: "parity-v1",
  invoke: async (task) => {
    if (task.type === "classify-discourse") {
      return { output: { classification: "player-action" }, usage: null };
    }
    if (task.type === "extract-intent") {
      return {
        output: {
          capabilityId: "pick-side-door-lock",
          referencedEntityIds: ["scene:arrival"],
          evidenceItemIds: [
            "entity:scene:arrival",
            "capability:pick-side-door-lock",
          ],
        },
        usage: null,
      };
    }
    if (task.type === "propose-state-change") {
      const intent = task.evidenceBundle.items.find(
        (item) => item.sourceKind === "validated-intent",
      );
      const rule = task.evidenceBundle.items.find(
        (item) => item.sourceKind === "authority-rule",
      );
      assert.ok(intent);
      assert.ok(rule);
      return {
        output: {
          status: "proposed",
          capabilityId: "pick-side-door-lock",
          referencedEntityIds: ["scene:arrival"],
          evidenceItemIds: [
            "entity:scene:arrival",
            "capability:pick-side-door-lock",
            rule.id,
            intent.id,
          ],
          intentEvidenceItemId: intent.id,
          ruleEvidenceItemIds: [rule.id],
          stateEvidenceItemIds: ["entity:scene:arrival"],
          rulesetVersion: "1.0.0",
          command: { type: "choose-action", actionId: "pick-side-door-lock" },
        },
        usage: null,
      };
    }
    throw new Error(`Unexpected task: ${task.type}`);
  },
};

test("confirmed Natural Language Play and Structured Play share one canonical outcome", async () => {
  const structured = createDeterministicPlayerSession();
  const natural = createDeterministicPlayerSession("locked-manor", {
    modelGateway: createModelGateway({ provider: surveyProvider }),
    modelCallStore: createInMemoryModelCallRecordStore(),
  });
  await setup(structured);
  await setup(natural);
  await establishArrivalExitConditions(structured);
  await establishArrivalExitConditions(natural);

  const structuredChoice = structured
    .projection()
    .availableActions.find((action) => action.id === "pick-side-door-lock");
  assert.ok(structuredChoice);
  const structuredResult = await structured.submit({
    type: "choose-action",
    actionId: structuredChoice.id,
  });

  const beforeInterpretation = natural.projection();
  await natural.submit({ type: "set-input-mode", mode: "natural-language" });
  assert.deepEqual(
    natural.projection().ledger,
    beforeInterpretation.ledger,
    "switching modes must not commit Adventure state",
  );
  const interpreted = await natural.submit({
    type: "submit-natural-language",
    utterance: "I pick the side-door lock with a Check.",
  });

  assert.equal(interpreted.canonicalCommand, null);
  assert.deepEqual(interpreted.projection.ledger, beforeInterpretation.ledger);
  const proposal = interpreted.projection.naturalLanguage.pendingProposal;
  assert.ok(proposal);
  assert.deepEqual(proposal.command, {
    type: "choose-action",
    actionId: "pick-side-door-lock",
  });
  assert.equal(proposal.modelCallIds.length, 3);
  assert.ok(proposal.citedEvidenceItemIds.includes("capability:pick-side-door-lock"));
  assert.ok(
    proposal.evidence.some(
      (item) => item.sourceKind === "authority-rule" && item.citation !== null,
    ),
  );

  const naturalResult = await natural.submit({
    type: "confirm-natural-language-command",
    proposalId: proposal.id,
  });

  assert.deepEqual(naturalResult.canonicalCommand, structuredResult.canonicalCommand);
  assert.deepEqual(
    normalizeGeneratedIds(naturalResult.canonicalEvents),
    normalizeGeneratedIds(structuredResult.canonicalEvents),
  );
  assert.ok(naturalResult.projection.pendingCheckProposal);
  assert.ok(structuredResult.projection.pendingCheckProposal);

  const structuredRoll = await structured.submit({
    type: "confirm-check-proposal",
    proposalId: structuredResult.projection.pendingCheckProposal.id,
  });
  const naturalRoll = await natural.submit({
    type: "confirm-check-proposal",
    proposalId: naturalResult.projection.pendingCheckProposal.id,
  });
  assert.deepEqual(
    normalizeGeneratedIds(naturalRoll.canonicalEvents),
    normalizeGeneratedIds(structuredRoll.canonicalEvents),
  );
  assert.equal(
    naturalRoll.projection.pendingChoice?.formula,
    structuredRoll.projection.pendingChoice?.formula,
  );
  assert.equal(
    naturalRoll.projection.pendingChoice?.total,
    structuredRoll.projection.pendingChoice?.total,
  );
  assert.ok(naturalRoll.projection.pendingChoice);
  assert.ok(structuredRoll.projection.pendingChoice);

  const structuredOutcome = await structured.submit({
    type: "resolve-pending-check",
    pendingChoiceId: structuredRoll.projection.pendingChoice.id,
    choice: "decline",
  });
  const naturalOutcome = await natural.submit({
    type: "resolve-pending-check",
    pendingChoiceId: naturalRoll.projection.pendingChoice.id,
    choice: "decline",
  });
  assert.deepEqual(
    normalizeGeneratedIds(naturalOutcome.canonicalEvents),
    normalizeGeneratedIds(structuredOutcome.canonicalEvents),
  );
  assert.ok(naturalOutcome.canonicalEventTypes.includes("SceneTransitioned"));
  assert.deepEqual(
    normalizeGeneratedIds(canonicalProjectionForParity(naturalOutcome.projection)),
    normalizeGeneratedIds(canonicalProjectionForParity(structuredOutcome.projection)),
  );
  assert.equal(naturalOutcome.projection.ledger.at(-1)?.inputMode, "Natural Language Play");
  assert.equal(structuredOutcome.projection.ledger.at(-1)?.inputMode, "Structured Play");
});

test("invalid Natural Language input clarifies without committing and keeps Structured choices", async () => {
  const invalidProvider: ModelProvider = {
    provider: "invalid-script",
    model: "invalid-v1",
    invoke: async () => ({ output: { classification: "player-action" }, usage: null }),
  };
  const session = createDeterministicPlayerSession("locked-manor", {
    modelGateway: createModelGateway({ provider: invalidProvider }),
    modelCallStore: createInMemoryModelCallRecordStore(),
  });
  await setup(session);
  const before = session.projection();

  const result = await session.submit({
    type: "submit-natural-language",
    utterance: "Do something with it.",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.canonicalCommand, null);
  assert.deepEqual(result.projection.ledger, before.ledger);
  assert.equal(result.projection.naturalLanguage.response?.kind, "clarification");
  assert.equal(result.projection.naturalLanguage.response?.status, "Action required");
  assert.deepEqual(result.projection.availableActions, before.availableActions);
});

test("a rules answer exposes its approved rule text, exact citation, and Model Call trace", async () => {
  const rulesProvider: ModelProvider = {
    provider: "rules-script",
    model: "rules-v1",
    invoke: async (task) => {
      if (task.type === "classify-discourse") {
        return { output: { classification: "rules-query" }, usage: null };
      }
      if (task.type === "suggest-rule-match") {
        const rule = task.evidenceBundle.items.find(
          (item) => item.sourceKind === "authority-rule",
        );
        assert.ok(rule);
        return {
          output: {
            status: "matched",
            ruleId: rule.id,
            evidenceItemIds: [rule.id],
          },
          usage: null,
        };
      }
      throw new Error(`Unexpected task: ${task.type}`);
    },
  };
  const session = createDeterministicPlayerSession("locked-manor", {
    modelGateway: createModelGateway({ provider: rulesProvider }),
    modelCallStore: createInMemoryModelCallRecordStore(),
  });
  await setup(session);
  const before = session.projection();

  const result = await session.submit({
    type: "submit-natural-language",
    utterance: "How does a Check work?",
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.canonicalCommand, null);
  assert.deepEqual(result.projection.ledger, before.ledger);
  const answer = result.projection.naturalLanguage.response;
  assert.equal(answer?.kind, "rules-answer");
  assert.equal(answer?.status, "Provisional");
  assert.match(answer?.message ?? "", /Roll 2d6 and add the relevant Trait/);
  assert.equal(answer?.modelCallIds.length, 2);
  const rule = answer?.evidence.find(
    (item) => item.sourceKind === "authority-rule",
  );
  assert.ok(rule);
  assert.match(rule.citation ?? "", /micro-ruleset@1\.0\.0#checks\.procedure/);
});

test("provider failure returns control to Structured Play without changing history", async () => {
  const failingProvider: ModelProvider = {
    provider: "failed-script",
    model: "failed-v1",
    invoke: async () => {
      throw new ModelProviderError("unavailable", "Provider offline.");
    },
  };
  const session = createDeterministicPlayerSession("locked-manor", {
    modelGateway: createModelGateway({ provider: failingProvider }),
    modelCallStore: createInMemoryModelCallRecordStore(),
  });
  await setup(session);
  await session.submit({ type: "set-input-mode", mode: "natural-language" });
  const before = session.projection();

  const result = await session.submit({
    type: "submit-natural-language",
    utterance: "I force the side door with a Check.",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.canonicalCommand, null);
  assert.deepEqual(result.projection.ledger, before.ledger);
  assert.equal(result.projection.inputMode, "structured");
  assert.equal(result.projection.naturalLanguage.response?.kind, "provider-failure");
  assert.equal(result.projection.naturalLanguage.response?.status, "Recoverable error");
  assert.deepEqual(result.projection.availableActions, before.availableActions);
});

test("a Free Action can be interpreted when no approved rule applies", async () => {
  const freeActionProvider: ModelProvider = {
    provider: "free-action-script",
    model: "free-action-v1",
    invoke: async (task) => {
      if (task.type === "classify-discourse") {
        return { output: { classification: "player-action" }, usage: null };
      }
      if (task.type === "extract-intent") {
        return {
          output: {
            capabilityId: "survey-manor",
            referencedEntityIds: ["scene:arrival"],
            evidenceItemIds: ["entity:scene:arrival", "capability:survey-manor"],
          },
          usage: null,
        };
      }
      if (task.type === "propose-state-change") {
        const intent = task.evidenceBundle.items.find(
          (item) => item.sourceKind === "validated-intent",
        );
        assert.ok(intent);
        return {
          output: {
            status: "proposed",
            capabilityId: "survey-manor",
            referencedEntityIds: ["scene:arrival"],
            evidenceItemIds: [
              "entity:scene:arrival",
              "capability:survey-manor",
              intent.id,
            ],
            intentEvidenceItemId: intent.id,
            ruleEvidenceItemIds: [],
            stateEvidenceItemIds: ["entity:scene:arrival"],
            rulesetVersion: "1.0.0",
            command: { type: "choose-action", actionId: "survey-manor" },
          },
          usage: null,
        };
      }
      throw new Error(`Unexpected task: ${task.type}`);
    },
  };
  const session = createDeterministicPlayerSession("locked-manor", {
    modelGateway: createModelGateway({ provider: freeActionProvider }),
  });
  await setup(session);

  const interpreted = await session.submit({
    type: "submit-natural-language",
    utterance: "I survey the manor grounds.",
  });
  const proposal = interpreted.projection.naturalLanguage.pendingProposal;
  assert.ok(proposal);

  const committed = await session.submit({
    type: "confirm-natural-language-command",
    proposalId: proposal.id,
  });
  assert.deepEqual(committed.canonicalEventTypes, ["FreeActionCompleted"]);
});
