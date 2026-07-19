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
