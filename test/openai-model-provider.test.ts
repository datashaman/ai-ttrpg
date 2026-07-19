import assert from "node:assert/strict";
import test from "node:test";

import type { ModelTask } from "../src/model-gateway.js";
import {
  createModelGateway,
  createScriptedModelProvider,
} from "../src/model-gateway.js";
import { createOpenAIModelProvider } from "../src/openai-model-provider.js";
import {
  assertModelProviderContract,
  modelProviderContractCases,
} from "./support/model-provider-contract.js";

const interpretationTask: ModelTask = {
  type: "interpret-player-input",
  input: { utterance: "I inspect the entryway." },
  evidenceBundle: {
    id: `evidence:${"a".repeat(64)}`,
    taskType: "interpret-player-input",
    items: [
      {
        id: "capability:inspect-dark-entryway",
        sourceKind: "capability",
        sourceReference: "inspect-dark-entryway",
        content: JSON.stringify({
          label: "Inspect the dark entryway",
          kind: "Check",
        }),
        inclusionReason: "This capability is currently available.",
      },
    ],
  },
};

test("OpenAI adapter invokes a stateless structured Model Task", async () => {
  const expectedOutput = {
    status: "interpreted",
    classification: "player-action",
    capabilityId: "inspect-dark-entryway",
    referencedEntityIds: ["scene:Arrival"],
    evidenceItemIds: ["capability:inspect-dark-entryway"],
    arguments: {},
  };
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createOpenAIModelProvider({
    apiKey: "test-openai-key",
    model: "gpt-test",
    fetcher: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ result: expectedOutput }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 21,
            output_tokens: 13,
            total_tokens: 34,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await provider.invoke(interpretationTask);

  assert.equal(provider.provider, "openai");
  assert.equal(provider.model, "gpt-test");
  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(
    new Headers(capturedInit?.headers).get("authorization"),
    "Bearer test-openai-key",
  );
  const request = JSON.parse(String(capturedInit?.body)) as Record<
    string,
    unknown
  >;
  assert.equal(request.model, "gpt-test");
  assert.equal(request.store, false);
  assert.equal("previous_response_id" in request, false);
  assert.deepEqual(JSON.parse(String(request.input)), interpretationTask);
  const text = request.text as {
    format: {
      type: string;
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  assert.equal(text.format.type, "json_schema");
  assert.equal(text.format.name, "interpret_player_input");
  assert.equal(text.format.strict, true);
  assert.equal(text.format.schema.type, "object");
  assert.equal("anyOf" in text.format.schema, false);
  assert.equal(text.format.schema.additionalProperties, false);
  assert.deepEqual(Object.keys(text.format.schema.properties as object), [
    "result",
  ]);
  assert.deepEqual(result, {
    output: expectedOutput,
    usage: { inputTokens: 21, outputTokens: 13, totalTokens: 34 },
  });
});

test("scripted adapter satisfies the shared Model Task provider contract", async () => {
  const responses = Object.fromEntries(
    modelProviderContractCases.map(({ task, expectedOutput }) => [
      `${task.type}:${
        task.type === "narrate-committed-outcome"
          ? task.input.outcomeReference
          : task.input.utterance
      }`,
      expectedOutput,
    ]),
  );

  await assertModelProviderContract(
    createScriptedModelProvider({ model: "contract-v1", responses }),
    null,
  );
});

test("OpenAI adapter satisfies every shared Model Task provider contract", async () => {
  const requestedTaskTypes: string[] = [];
  const provider = createOpenAIModelProvider({
    apiKey: "test-openai-key",
    model: "gpt-test",
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init.body)) as {
        input: string;
        previous_response_id?: string;
        store: boolean;
        text: { format: { name: string } };
      };
      const task = JSON.parse(request.input) as ModelTask;
      requestedTaskTypes.push(task.type);
      assert.equal(request.previous_response_id, undefined);
      assert.equal(request.store, false);
      assert.equal(
        request.text.format.name,
        task.type.replaceAll("-", "_"),
      );
      const contractCase = modelProviderContractCases.find(
        (candidate) => candidate.task.type === task.type,
      );
      assert.ok(contractCase);
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(
                    task.type === "interpret-player-input"
                      ? { result: contractCase.expectedOutput }
                      : contractCase.expectedOutput,
                  ),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 5,
            output_tokens: 8,
            total_tokens: 13,
          },
        }),
        { status: 200 },
      );
    },
  });

  await assertModelProviderContract(provider, {
    inputTokens: 5,
    outputTokens: 8,
    totalTokens: 13,
  });
  assert.deepEqual(requestedTaskTypes, [
    "interpret-player-input",
    "explain-rules",
    "narrate-committed-outcome",
  ]);
});

for (const { status, code, apiCode } of [
  { status: 401, code: "unauthenticated", apiCode: "invalid_api_key" },
  { status: 429, code: "rate-limited", apiCode: "rate_limit_exceeded" },
  { status: 400, code: "over-budget", apiCode: "context_length_exceeded" },
] as const) {
  test(`OpenAI HTTP ${status} maps to ${code} without leaking provider errors`, async () => {
    const provider = createOpenAIModelProvider({
      apiKey: "test-openai-key",
      model: "gpt-test",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: apiCode,
              message: "Provider echoed sk-should-never-escape.",
            },
          }),
          { status },
        ),
    });

    const execution = await createModelGateway({ provider }).execute(
      interpretationTask,
    );

    assert.equal(execution.outcome.status, "failed");
    if (execution.outcome.status === "failed") {
      assert.equal(execution.outcome.code, code);
      assert.doesNotMatch(execution.outcome.reason, /sk-should-never-escape/);
    }
  });
}

test("OpenAI transport failures and deadlines map to established gateway outcomes", async () => {
  const unavailable = createOpenAIModelProvider({
    apiKey: "test-openai-key",
    model: "gpt-test",
    fetcher: async () => {
      throw new TypeError("socket failed");
    },
  });
  const unavailableExecution = await createModelGateway({
    provider: unavailable,
  }).execute(interpretationTask);
  assert.equal(unavailableExecution.outcome.status, "failed");
  if (unavailableExecution.outcome.status === "failed") {
    assert.equal(unavailableExecution.outcome.code, "unavailable");
  }

  const neverCompletes = createOpenAIModelProvider({
    apiKey: "test-openai-key",
    model: "gpt-test",
    fetcher: () => new Promise<Response>(() => {}),
  });
  const timedOutExecution = await createModelGateway({
    provider: neverCompletes,
  }).execute(interpretationTask, { timeoutMs: 1 });
  assert.equal(timedOutExecution.outcome.status, "failed");
  if (timedOutExecution.outcome.status === "failed") {
    assert.equal(timedOutExecution.outcome.code, "timeout");
  }
});

test("invalid OpenAI output uses the gateway repair contract and accumulates usage", async () => {
  let invocationCount = 0;
  const repairedOutput = {
    status: "ambiguous",
    candidateCapabilityIds: ["inspect-door", "force-door"],
  };
  const provider = createOpenAIModelProvider({
    apiKey: "test-openai-key",
    model: "gpt-test",
    fetcher: async () => {
      invocationCount += 1;
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text:
                    invocationCount === 1
                      ? "not json"
                      : JSON.stringify({ result: repairedOutput }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 2,
            output_tokens: 3,
            total_tokens: 5,
          },
        }),
        { status: 200 },
      );
    },
  });

  const execution = await createModelGateway({ provider }).execute(
    interpretationTask,
    {
      isStructurallyValid: (output) =>
        typeof output === "object" && output !== null && "status" in output,
    },
  );

  assert.equal(invocationCount, 2);
  assert.equal(execution.retryCount, 1);
  assert.equal(execution.outcome.status, "succeeded");
  if (execution.outcome.status === "succeeded") {
    assert.deepEqual(execution.outcome.output, repairedOutput);
    assert.deepEqual(execution.outcome.usage, {
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    });
  }
});
