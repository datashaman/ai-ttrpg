import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  createScriptedModelProvider,
  type ModelProvider,
} from "../src/model-gateway.js";
import { assembleRulesExplanationEvidence } from "../src/evidence-bundle.js";
import { runNaturalLanguagePlay } from "../src/natural-language-play.js";
import { createStructuredPlayApplication } from "../src/structured-play.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import {
  assertLockedManorHiddenKnowledgeAbsent,
  LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID,
  LOCKED_MANOR_HIDDEN_KNOWLEDGE_TEXT,
} from "./support/hidden-world-knowledge.js";
import { scriptedIO } from "./support/scripted-io.js";

const LOCKPICK_QUERY = "Can I use my Lockpick Set to open the side door?";
const INVENTORY_RULE =
  "A distinct object carried by the Player Character that may permit an approach or become an explicit outcome stake without granting an automatic numeric bonus. An Inventory Item is either carried or removed; consumption, loss, surrender, or breakage removes it rather than creating a damaged state. The first inventory contains a Lantern, Lockpick Set, Short Blade, and Field Kit.";

test("a scripted provider answers a locked-manor rules question from attributable evidence", async () => {
  const { eventStore } = beginAdventureFixture();
  const beforeEvents = JSON.stringify(eventStore.readAll());
  const beforeState = JSON.stringify(
    createStructuredPlayApplication({ eventStore }).view().state,
  );
  const modelCallStore = createInMemoryModelCallRecordStore();
  const scriptedProvider = createScriptedModelProvider({
    model: "locked-manor-rules-v1",
    responses: {
      [`interpret-player-input:${LOCKPICK_QUERY}`]: {
        status: "interpreted",
        classification: "rules-query",
        referencedEntityIds: [
          "scene:arrival",
          "inventory:Lockpick Set",
        ],
      },
      [`explain-rules:${LOCKPICK_QUERY}`]: {
        segments: [
          {
            text: INVENTORY_RULE,
            evidenceItemIds: [
              "rule:inventory-items@1.0.0",
              "entity:inventory:Lockpick Set",
              "capability:pick-side-door-lock",
            ],
          },
        ],
      },
    },
  });
  const provider: ModelProvider = {
    ...scriptedProvider,
    invoke: async (task) => {
      assertLockedManorHiddenKnowledgeAbsent(task);
      return scriptedProvider.invoke(task);
    },
  };
  const script = scriptedIO([LOCKPICK_QUERY]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    modelGateway: createModelGateway({ provider }),
    modelCallStore,
    eventStore,
  });

  const output = script.output.join("");
  assert.match(output, /Rules explanation/);
  assert.match(
    output,
    /may permit an approach or become an explicit outcome stake without granting an automatic numeric bonus/,
  );
  assert.match(output, /Lockpick Set/);
  assert.match(output, /Pick the side-door lock/);
  assert.equal(JSON.stringify(eventStore.readAll()), beforeEvents);
  assert.equal(
    JSON.stringify(createStructuredPlayApplication({ eventStore }).view().state),
    beforeState,
  );
  assert.deepEqual(result.interpretedCommands, []);

  const records = modelCallStore.readAll();
  assert.deepEqual(
    records.map((record) => record.taskType),
    ["interpret-player-input", "explain-rules"],
  );
  const explanationRecord = records[1];
  assert.ok(explanationRecord);
  assert.equal(explanationRecord.validation.status, "accepted");
  assert.equal(explanationRecord.fallbackOutcome, "none");
  assert.equal(explanationRecord.promptVersion, "explain-rules-v1");
  assert.match(explanationRecord.evidenceBundleHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(explanationRecord.command, null);
  assert.deepEqual(explanationRecord.acceptedEventIds, []);
  assert.ok(
    explanationRecord.evidenceReferences.some(
      (reference) => reference.itemId === "rule:inventory-items@1.0.0",
    ),
  );
});

test("the rules provider receives one deeply immutable stateless Model Task", async () => {
  const { eventStore } = beginAdventureFixture();
  let invocation = 0;
  const provider: ModelProvider = {
    provider: "rules-task-inspector",
    model: "immutable-rules-v1",
    invoke: async (task) => {
      invocation += 1;
      if (invocation === 1) {
        return {
          output: {
            status: "interpreted",
            classification: "rules-query",
            referencedEntityIds: ["inventory:Lockpick Set"],
          },
          usage: null,
        };
      }
      assert.equal(task.type, "explain-rules");
      assert.equal(Object.isFrozen(task), true);
      assert.equal(Object.isFrozen(task.input), true);
      assert.equal(Object.isFrozen(task.evidenceBundle), true);
      assert.equal(Object.isFrozen(task.evidenceBundle.items), true);
      assert.equal(Object.isFrozen(task.evidenceBundle.items[0]), true);
      assert.deepEqual(Object.keys(task).sort(), [
        "evidenceBundle",
        "input",
        "type",
      ]);
      assert.deepEqual(Object.keys(task.input), ["utterance"]);
      assert.throws(() => {
        (task.input as { utterance: string }).utterance = "Different question";
      }, TypeError);
      return {
        output: {
          segments: [
            {
              text: INVENTORY_RULE,
              evidenceItemIds: [
                "rule:inventory-items@1.0.0",
                "entity:inventory:Lockpick Set",
              ],
            },
          ],
        },
        usage: null,
      };
    },
  };

  await runNaturalLanguagePlay({
    io: scriptedIO([LOCKPICK_QUERY]).io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.equal(invocation, 2);
});

test("rules evidence budgeting preserves the exact rule before older events", () => {
  const { app, eventStore } = beginAdventureFixture();

  const bundle = assembleRulesExplanationEvidence({
    utterance: LOCKPICK_QUERY,
    view: app.view(),
    acceptedEvents: eventStore.readAll(),
    maxItems: 2,
  });

  assert.deepEqual(
    bundle.items.map((item) => item.id),
    ["rule:inventory-items@1.0.0", "entity:inventory:Lockpick Set"],
  );
  assert.equal(
    bundle.items.some((item) => item.sourceKind === "accepted-event"),
    false,
  );
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.items), true);
  assert.equal(Object.isFrozen(bundle.items[0]), true);
});

for (const [kind, explanation] of [
  [
    "unknown",
    {
      segments: [
        { text: INVENTORY_RULE, evidenceItemIds: ["rule:not-authored"] },
      ],
    },
  ],
  [
    "invisible",
    {
      segments: [
        {
          text: INVENTORY_RULE,
          evidenceItemIds: ["fact:hidden-cult-ritual"],
        },
      ],
    },
  ],
  [
    "missing authored-rule",
    {
      segments: [
        {
          text: INVENTORY_RULE,
          evidenceItemIds: ["entity:inventory:Lockpick Set"],
        },
      ],
    },
  ],
] as const) {
  test(`${kind} rules citations select deterministic presentation`, async () => {
    const { eventStore } = beginAdventureFixture();
    const before = JSON.stringify(eventStore.readAll());
    const provider = createScriptedModelProvider({
      model: "invalid-rules-citations-v1",
      responses: {
        [`interpret-player-input:${LOCKPICK_QUERY}`]: {
          status: "interpreted",
          classification: "rules-query",
          referencedEntityIds: ["inventory:Lockpick Set"],
        },
        [`explain-rules:${LOCKPICK_QUERY}`]: explanation,
      },
    });
    const script = scriptedIO([LOCKPICK_QUERY]);

    const result = await runNaturalLanguagePlay({
      io: script.io,
      modelGateway: createModelGateway({ provider }),
      eventStore,
    });

    assert.match(
      script.output.join(""),
      /Rules explanation \(deterministic fallback\)/,
    );
    assert.equal(JSON.stringify(eventStore.readAll()), before);
    assert.equal(result.modelCallRecords[1]?.validation.status, "rejected");
    assert.equal(
      result.modelCallRecords[1]?.fallbackOutcome,
      "deterministic-rules",
    );
  });
}

test("hidden World Knowledge cannot become a rules answer or citation", async () => {
  const { eventStore } = beginAdventureFixture();
  const before = eventStore.readAll();
  const provider = createScriptedModelProvider({
    model: "hidden-rules-answer-v1",
    responses: {
      [`interpret-player-input:${LOCKPICK_QUERY}`]: {
        status: "interpreted",
        classification: "rules-query",
        referencedEntityIds: ["inventory:Lockpick Set"],
      },
      [`explain-rules:${LOCKPICK_QUERY}`]: {
        segments: [
          {
            text: LOCKED_MANOR_HIDDEN_KNOWLEDGE_TEXT,
            evidenceItemIds: [
              `fact:${LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID}`,
            ],
          },
        ],
      },
    },
  });
  const script = scriptedIO([LOCKPICK_QUERY]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.deepEqual(eventStore.readAll(), before);
  assert.match(script.output.join(""), /deterministic fallback/);
  const explanationRecord = result.modelCallRecords[1];
  assert.ok(explanationRecord);
  assert.equal(explanationRecord.validation.status, "rejected");
  assert.equal(explanationRecord.validatedOutput, null);
  assert.equal(explanationRecord.fallbackOutcome, "deterministic-rules");
  const playerVisibleResult = JSON.stringify({
    output: script.output,
    records: result.modelCallRecords,
  });
  assertLockedManorHiddenKnowledgeAbsent(playerVisibleResult);
});

test("an irrelevant in-bundle citation selects deterministic presentation", async () => {
  const { app, eventStore } = beginAdventureFixture();
  const proposed = app.submit({
    type: "choose-action",
    actionId: "inspect-dark-entryway",
  });
  const proposal = proposed.state.pendingCheckProposal;
  assert.ok(proposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });
  const pendingChoice = revealed.state.pendingChoice;
  assert.ok(pendingChoice);
  app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "decline",
  });
  const provider = createScriptedModelProvider({
    model: "mismatched-rules-citation-v1",
    responses: {
      [`interpret-player-input:${LOCKPICK_QUERY}`]: {
        status: "interpreted",
        classification: "rules-query",
        referencedEntityIds: ["inventory:Lockpick Set"],
      },
      [`explain-rules:${LOCKPICK_QUERY}`]: {
        segments: [
          {
            text: INVENTORY_RULE,
            evidenceItemIds: [
              "rule:inventory-items@1.0.0",
              "resolution:current",
            ],
          },
        ],
      },
    },
  });
  const script = scriptedIO([LOCKPICK_QUERY]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.match(script.output.join(""), /deterministic fallback/);
  assert.ok(
    result.modelCallRecords[1]?.evidenceReferences.some(
      (reference) => reference.itemId === "resolution:current",
    ),
  );
  assert.equal(result.modelCallRecords[1]?.validation.status, "rejected");
});

test("an unavailable rules provider uses deterministic rules without changing state", async () => {
  const { eventStore } = beginAdventureFixture();
  const beforeEvents = JSON.stringify(eventStore.readAll());
  const beforeState = JSON.stringify(
    createStructuredPlayApplication({ eventStore }).view().state,
  );
  const provider = createScriptedModelProvider({
    model: "unavailable-rules-v1",
    responses: {
      [`interpret-player-input:${LOCKPICK_QUERY}`]: {
        status: "interpreted",
        classification: "rules-query",
        referencedEntityIds: ["inventory:Lockpick Set"],
      },
    },
  });
  const script = scriptedIO([LOCKPICK_QUERY]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  assert.match(
    script.output.join(""),
    /Rules explanation \(deterministic fallback\)/,
  );
  assert.equal(JSON.stringify(eventStore.readAll()), beforeEvents);
  assert.equal(
    JSON.stringify(createStructuredPlayApplication({ eventStore }).view().state),
    beforeState,
  );
  assert.equal(result.modelCallRecords[1]?.validation.status, "rejected");
  assert.equal(
    result.modelCallRecords[1]?.fallbackOutcome,
    "deterministic-rules",
  );
});

test("rules explanation output cannot select Likelihood or apply Mechanical Effects", async () => {
  const { eventStore } = beginAdventureFixture();
  const before = JSON.stringify(eventStore.readAll());
  const provider = createScriptedModelProvider({
    model: "rules-injection-v1",
    responses: {
      [`interpret-player-input:${LOCKPICK_QUERY}`]: {
        status: "interpreted",
        classification: "rules-query",
        referencedEntityIds: ["inventory:Lockpick Set"],
      },
      [`explain-rules:${LOCKPICK_QUERY}`]: {
        segments: [
          {
            text: INVENTORY_RULE,
            evidenceItemIds: ["rule:inventory-items@1.0.0"],
          },
        ],
        likelihood: "Likely",
        mechanicalEffects: [{ type: "gain-health", amount: 99 }],
        replacementRule: "Lockpicks always grant +10.",
      },
    },
  });
  const script = scriptedIO([LOCKPICK_QUERY]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  const output = script.output.join("");
  assert.match(output, /deterministic fallback/);
  assert.doesNotMatch(output, /Likely|gain-health|\+10/);
  assert.equal(JSON.stringify(eventStore.readAll()), before);
  assert.equal(result.modelCallRecords[1]?.validatedOutput, null);
});

test("rules explanation text cannot override the cited authored rule", async () => {
  const { eventStore } = beginAdventureFixture();
  const provider = createScriptedModelProvider({
    model: "rules-override-v1",
    responses: {
      [`interpret-player-input:${LOCKPICK_QUERY}`]: {
        status: "interpreted",
        classification: "rules-query",
        referencedEntityIds: ["inventory:Lockpick Set"],
      },
      [`explain-rules:${LOCKPICK_QUERY}`]: {
        segments: [
          {
            text: "The Lockpick Set grants +10 to every Check.",
            evidenceItemIds: ["rule:inventory-items@1.0.0"],
          },
        ],
      },
    },
  });
  const script = scriptedIO([LOCKPICK_QUERY]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    modelGateway: createModelGateway({ provider }),
    eventStore,
  });

  const output = script.output.join("");
  assert.match(output, /deterministic fallback/);
  assert.doesNotMatch(output, /grants \+10/);
  assert.equal(result.modelCallRecords[1]?.validation.status, "rejected");
  assert.equal(result.modelCallRecords[1]?.validatedOutput, null);
});
