import assert from "node:assert/strict";
import { env } from "node:process";
import test from "node:test";

import { createModelRuntimeFromEnvironment } from "../src/model-runtime.js";
import { modelProviderContractCases } from "./support/model-provider-contract.js";

const smokeEnabled =
  env.npm_lifecycle_event === "test:openai-smoke" ||
  env.AI_TTRPG_OPENAI_SMOKE === "1";

test(
  "configured OpenAI provider completes every Model Task contract",
  { skip: smokeEnabled ? false : "real provider smoke test is opt-in" },
  async () => {
    const runtime = createModelRuntimeFromEnvironment(env);
    assert.ok(
      runtime,
      "Set AI_TTRPG_MODEL_PROVIDER, OPENAI_MODEL, and OPENAI_API_KEY.",
    );

    for (const contractCase of modelProviderContractCases) {
      const execution = await runtime.modelGateway.execute(contractCase.task, {
        timeoutMs: runtime.timeoutMs,
      });
      assert.equal(
        execution.outcome.status,
        "succeeded",
        execution.outcome.status === "failed"
          ? `${execution.outcome.code}: ${execution.outcome.reason}`
          : undefined,
      );
      if (execution.outcome.status === "succeeded") {
        assert.notEqual(execution.outcome.output, null);
      }
    }
  },
);
