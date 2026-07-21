import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createInMemoryAdventureRepository,
  createLocalAdventureRepository,
} from "./adventure-repository.js";
import type { GoldenCampaignAdapters } from "./golden-campaign-evaluation.js";
import { createMicroRulesetPackage } from "./micro-ruleset-package.js";
import { createScriptedModelProvider, type ModelProvider } from "./model-gateway.js";
import { createOpenAIModelProvider } from "./openai-model-provider.js";
import type { PresentationModel } from "./presentation.js";

export const GOLDEN_MODEL_UTTERANCE =
  "I use a Check to force open the manor's side door.";

const responseKey = (task: {
  readonly type: string;
  readonly input: { readonly utterance?: string; readonly outcomeReference?: string };
}): string =>
  `${task.type}:${task.input.utterance ?? task.input.outcomeReference ?? ""}`;

const recordedOpenAIProvider = (
  responses: Readonly<Record<string, unknown>>,
): ModelProvider =>
  createOpenAIModelProvider({
    apiKey: "evaluation-recording",
    model: "recorded-openai-v1",
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init.body)) as { readonly input: string };
      const task = JSON.parse(request.input) as Parameters<typeof responseKey>[0];
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(responses[responseKey(task)]),
                },
              ],
            },
          ],
          usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

const deterministicPresentation: PresentationModel = {
  narrate: async () => ({ invalid: "select deterministic fallback" }),
  explainRules: async () => ({ invalid: "select deterministic fallback" }),
};

const groundedPresentation: PresentationModel = {
  narrate: async (request) => ({
    segments: request.committedEvents.slice(-1).map(({ id }) => ({
      kind: "event" as const,
      id,
    })),
  }),
  explainRules: async () => ({ invalid: "not used by this campaign" }),
};

export const supportedGoldenCampaignAdapters = (): GoldenCampaignAdapters => ({
  repositories: [
    {
      id: "in-memory",
      create: () => ({
        repository: createInMemoryAdventureRepository(),
        cleanup: () => {},
      }),
    },
    {
      id: "local-durable",
      create: () => {
        const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-golden-"));
        return {
          repository: createLocalAdventureRepository(directory),
          cleanup: () => rmSync(directory, { recursive: true, force: true }),
        };
      },
    },
  ],
  modelProviders: [
    {
      id: "scripted",
      createProvider: (responses) =>
        createScriptedModelProvider({
          model: "golden-script-v1",
          responses,
        }),
    },
    { id: "openai-recorded", createProvider: recordedOpenAIProvider },
  ],
  rulesetPackages: [
    { id: "micro-ruleset@1.0.0", package: createMicroRulesetPackage() },
  ],
  presentations: [
    { id: "deterministic", model: deterministicPresentation },
    { id: "grounded", model: groundedPresentation },
  ],
});
