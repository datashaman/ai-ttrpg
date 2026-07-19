import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ModelTask } from "../src/model-gateway.js";
import { createModelRuntimeFromEnvironment } from "../src/model-runtime.js";

const task: ModelTask = {
  type: "interpret-player-input",
  input: { utterance: "Inspect the door." },
  evidenceBundle: {
    id: `evidence:${"b".repeat(64)}`,
    taskType: "interpret-player-input",
    items: [],
  },
};

test("complete runtime configuration selects OpenAI without exposing credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-model-runtime-"));
  const diagnosticPath = join(directory, "model.jsonl");
  const apiKey = "test-runtime-openai-key";
  let requestBody = "";
  const runtime = createModelRuntimeFromEnvironment(
    {
      AI_TTRPG_MODEL_PROVIDER: "openai",
      OPENAI_MODEL: "gpt-runtime-test",
      OPENAI_API_KEY: apiKey,
      AI_TTRPG_MODEL_TIMEOUT_MS: "37",
      AI_TTRPG_MODEL_DIAGNOSTIC_PATH: diagnosticPath,
    },
    {
      fetcher: async (_url, init) => {
        requestBody = String(init.body);
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      result: {
                        status: "ambiguous",
                        candidateCapabilityIds: [
                          "inspect-door",
                          "force-door",
                        ],
                      },
                    }),
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 3,
              output_tokens: 5,
              total_tokens: 8,
            },
          }),
          { status: 200 },
        );
      },
    },
  );

  assert.ok(runtime);
  assert.equal(runtime.timeoutMs, 37);
  const execution = await runtime.modelGateway.execute(task);
  assert.equal(execution.provider, "openai");
  assert.equal(execution.model, "gpt-runtime-test");
  assert.doesNotMatch(requestBody, new RegExp(apiKey));
  const diagnostics = readFileSync(diagnosticPath, "utf8");
  assert.match(diagnostics, /openai|gpt-runtime-test|interpret-player-input/);
  assert.doesNotMatch(diagnostics, new RegExp(apiKey));
});

test("diagnostic capture is disabled by default", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-model-runtime-"));
  const diagnosticPath = join(directory, "model.jsonl");
  const runtime = createModelRuntimeFromEnvironment(
    {
      AI_TTRPG_MODEL_PROVIDER: "openai",
      OPENAI_MODEL: "gpt-runtime-test",
      OPENAI_API_KEY: "test-runtime-openai-key",
    },
    {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      result: {
                        status: "ambiguous",
                        candidateCapabilityIds: [
                          "inspect-door",
                          "force-door",
                        ],
                      },
                    }),
                  },
                ],
              },
            ],
            usage: null,
          }),
          { status: 200 },
        ),
    },
  );

  assert.ok(runtime);
  await runtime.modelGateway.execute(task);
  assert.equal(existsSync(diagnosticPath), false);
});

for (const environment of [
  {},
  { OPENAI_API_KEY: "configured", OPENAI_MODEL: "gpt-runtime-test" },
  { AI_TTRPG_MODEL_PROVIDER: "openai", OPENAI_MODEL: "gpt-runtime-test" },
  { AI_TTRPG_MODEL_PROVIDER: "openai", OPENAI_API_KEY: "configured" },
  {
    AI_TTRPG_MODEL_PROVIDER: "openai",
    OPENAI_MODEL: "gpt-runtime-test",
    OPENAI_API_KEY: "configured",
    AI_TTRPG_MODEL_TIMEOUT_MS: "not-a-deadline",
  },
] as const) {
  test(`incomplete runtime configuration offers Structured Play: ${JSON.stringify(
    Object.keys(environment),
  )}`, () => {
    assert.equal(createModelRuntimeFromEnvironment(environment), undefined);
  });
}
