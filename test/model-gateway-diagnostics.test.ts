import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalModelDiagnosticCapture } from "../src/model-diagnostics.js";
import {
  createModelGateway,
  type ModelProvider,
  type ModelTask,
} from "../src/model-gateway.js";

const task: ModelTask = {
  type: "interpret-player-input",
  input: { utterance: "Use token sk-player-secret to inspect the door." },
  evidenceBundle: {
    id: `evidence:${"a".repeat(64)}`,
    taskType: "interpret-player-input",
    items: [],
  },
};

test("raw provider diagnostics require explicit local capture and redact credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-diagnostics-"));
  const defaultPath = join(directory, "default.jsonl");
  const diagnosticPath = join(directory, "explicit.jsonl");
  const provider: ModelProvider = {
    provider: "scripted-sensitive",
    model: "diagnostic-v1",
    invoke: async () => ({
      output: {
        authorization: "Bearer provider-secret",
        access_token: "opaque-access-credential",
        refreshToken: "opaque-refresh-credential",
        client_secret: "opaque-client-credential",
        secretAccessKey: "opaque-aws-credential",
        OPENAI_API_KEY: "opaque-openai-credential",
        AZURE_OPENAI_API_KEY: "opaque-azure-credential",
        AWS_ACCESS_KEY_ID: "opaque-aws-key-credential",
        sessionToken: "opaque-session-credential",
        "x-api-key": "opaque-api-credential",
        cookie: "session=opaque-cookie-credential",
        explanation: "Provider echoed sk-provider-secret in prose.",
      },
      usage: null,
    }),
  };

  await createModelGateway({ provider }).execute(task);
  assert.equal(existsSync(defaultPath), false);

  await createModelGateway({
    provider,
    diagnosticCapture: createLocalModelDiagnosticCapture(diagnosticPath),
  }).execute(task);

  const captured = readFileSync(diagnosticPath, "utf8");
  assert.match(captured, /interpret-player-input|scripted-sensitive|\[REDACTED\]/);
  assert.doesNotMatch(
    captured,
    /sk-player-secret|provider-secret|sk-provider-secret|opaque-/,
  );
});
