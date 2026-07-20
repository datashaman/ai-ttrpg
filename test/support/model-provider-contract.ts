import assert from "node:assert/strict";

import type {
  ModelProvider,
  ModelProviderResult,
  ModelTask,
} from "../../src/model-gateway.js";

const evidenceBundle = <Task extends ModelTask["type"]>(taskType: Task) => ({
  id: `evidence:${taskType.padEnd(64, "0")}`,
  taskType,
  items: [],
});

export const modelProviderContractCases: readonly {
  readonly task: ModelTask;
  readonly expectedOutput: unknown;
}[] = [
  {
    task: {
      type: "interpret-player-input",
      input: { utterance: "I deal with the door." },
      evidenceBundle: evidenceBundle("interpret-player-input"),
    },
    expectedOutput: {
      status: "ambiguous",
      candidateCapabilityIds: ["inspect-door", "force-door"],
    },
  },
  {
    task: {
      type: "classify-discourse",
      input: { utterance: "I inspect the entryway." },
      evidenceBundle: evidenceBundle("classify-discourse"),
    },
    expectedOutput: { classification: "player-action" },
  },
  {
    task: {
      type: "extract-intent",
      input: { utterance: "I inspect the entryway." },
      evidenceBundle: evidenceBundle("extract-intent"),
    },
    expectedOutput: {
      capabilityId: "inspect-door",
      referencedEntityIds: ["scene:arrival"],
      evidenceItemIds: ["capability:inspect-door", "entity:scene:arrival"],
    },
  },
  {
    task: {
      type: "suggest-rule-match",
      input: { utterance: "Is this a Check?" },
      evidenceBundle: evidenceBundle("suggest-rule-match"),
    },
    expectedOutput: {
      status: "needs-adjudication",
      candidateRuleIds: ["rule:checks", "rule:free-actions"],
    },
  },
  {
    task: {
      type: "propose-state-change",
      input: {
        utterance: "I inspect the entryway.",
        intent: {
          capabilityId: "inspect-door",
          referencedEntityIds: ["scene:arrival"],
          evidenceItemIds: ["capability:inspect-door", "entity:scene:arrival"],
        },
        rulesetVersion: "1.0.0",
      },
      evidenceBundle: evidenceBundle("propose-state-change"),
    },
    expectedOutput: {
      status: "proposed",
      capabilityId: "inspect-door",
      referencedEntityIds: ["scene:arrival"],
      evidenceItemIds: [
        "capability:inspect-door",
        "entity:scene:arrival",
        "rule:checks",
        "intent:contract",
      ],
      intentEvidenceItemId: "intent:contract",
      ruleEvidenceItemIds: ["rule:checks"],
      stateEvidenceItemIds: ["entity:scene:arrival"],
      rulesetVersion: "1.0.0",
      command: { type: "choose-action", actionId: "inspect-door" },
    },
  },
  {
    task: {
      type: "explain-rules",
      input: { utterance: "How do Checks work?" },
      evidenceBundle: evidenceBundle("explain-rules"),
    },
    expectedOutput: {
      segments: [
        {
          text: "Checks roll 2d6 plus a Trait.",
          evidenceItemIds: ["rule:check"],
        },
      ],
    },
  },
  {
    task: {
      type: "narrate-committed-outcome",
      input: { outcomeReference: "micro-ruleset.check@1.0.0:Clean Success" },
      evidenceBundle: evidenceBundle("narrate-committed-outcome"),
    },
    expectedOutput: {
      segments: [
        {
          text: "The door opens quietly.",
          evidenceItemIds: ["event:door-opened"],
        },
      ],
    },
  },
];

export const assertModelProviderContract = async (
  provider: ModelProvider,
  expectedUsage: ModelProviderResult["usage"],
): Promise<void> => {
  for (const contractCase of modelProviderContractCases) {
    const result = await provider.invoke(contractCase.task);
    assert.deepEqual(result, {
      output: contractCase.expectedOutput,
      usage: expectedUsage,
    });
  }
};
