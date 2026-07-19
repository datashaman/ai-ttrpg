import { isRecord } from "./model-boundary.js";
import type {
  ModelProvider,
  ModelProviderResult,
  ModelTask,
  ModelUsage,
} from "./model-gateway.js";
import { ModelProviderError } from "./model-gateway.js";

export type OpenAIFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface OpenAIModelProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetcher?: OpenAIFetch;
}

type JsonSchema = Readonly<Record<string, unknown>>;

const stringArraySchema: JsonSchema = {
  type: "array",
  items: { type: "string" },
};

const exactObject = (
  properties: Readonly<Record<string, JsonSchema>>,
): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const referencedInterpretationProperties = {
  status: { type: "string", enum: ["interpreted"] },
  referencedEntityIds: stringArraySchema,
} as const;

const interpretationSchema: JsonSchema = {
  type: "object",
  anyOf: [
    exactObject({
      ...referencedInterpretationProperties,
      classification: {
        type: "string",
        enum: ["player-action", "in-character-speech"],
      },
      capabilityId: { type: "string" },
      evidenceItemIds: stringArraySchema,
      arguments: { type: "object", properties: {}, additionalProperties: false },
    }),
    exactObject({
      ...referencedInterpretationProperties,
      classification: { type: "string", enum: ["rules-query"] },
    }),
    exactObject({
      ...referencedInterpretationProperties,
      classification: { type: "string", enum: ["in-character-speech"] },
      capabilityId: { type: "null" },
      arguments: { type: "object", properties: {}, additionalProperties: false },
    }),
    exactObject({
      ...referencedInterpretationProperties,
      classification: {
        type: "string",
        enum: ["out-of-character-request", "table-chat"],
      },
    }),
    exactObject({
      ...referencedInterpretationProperties,
      classification: { type: "string", enum: ["system-command"] },
      command: {
        type: "string",
        enum: ["show-state", "show-actions", "stop"],
      },
    }),
    exactObject({
      status: { type: "string", enum: ["ambiguous"] },
      candidateCapabilityIds: stringArraySchema,
    }),
  ],
};

const attributedSegmentsSchema: JsonSchema = exactObject({
  segments: {
    type: "array",
    minItems: 1,
    items: exactObject({
      text: { type: "string", minLength: 1 },
      evidenceItemIds: {
        ...stringArraySchema,
        minItems: 1,
      },
    }),
  },
});

const taskFormat = (task: ModelTask): {
  readonly name: string;
  readonly schema: JsonSchema;
} => {
  if (task.type === "interpret-player-input") {
    return { name: "interpret_player_input", schema: interpretationSchema };
  }
  if (task.type === "explain-rules") {
    return { name: "explain_rules", schema: attributedSegmentsSchema };
  }
  return {
    name: "narrate_committed_outcome",
    schema: attributedSegmentsSchema,
  };
};

const instructionsFor = (task: ModelTask): string => {
  if (task.type === "interpret-player-input") {
    return "Classify the Player's utterance using only the supplied Model Task and Evidence Bundle. Select only an available capability, cite supplied evidence item IDs, and never invent game truth or Mechanical Effects. Return JSON matching the supplied schema.";
  }
  if (task.type === "explain-rules") {
    return "Explain only authored rules that directly answer the Player's query. Every segment must reproduce an applicable authority-rule Evidence Bundle item exactly and cite its item ID. Return JSON matching the supplied schema.";
  }
  return "Narrate only claims established by the committed outcome. Every segment must cite the Evidence Bundle items that support it. Do not invent characters, motives, locations, mechanics, outcomes, or actionable facts. Return JSON matching the supplied schema.";
};

const outputTextFrom = (response: unknown): string | null => {
  if (!isRecord(response) || !Array.isArray(response.output)) return null;
  for (const output of response.output) {
    if (!isRecord(output) || output.type !== "message" || !Array.isArray(output.content)) {
      continue;
    }
    for (const content of output.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }
  return null;
};

const usageFrom = (response: unknown): ModelUsage | null => {
  if (!isRecord(response) || !isRecord(response.usage)) return null;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const totalTokens = response.usage.total_tokens;
  return typeof inputTokens === "number" &&
    typeof outputTokens === "number" &&
    typeof totalTokens === "number"
    ? { inputTokens, outputTokens, totalTokens }
    : null;
};

const normalizedBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "");

const apiErrorCodeFrom = (payload: unknown): string | null =>
  isRecord(payload) &&
  isRecord(payload.error) &&
  typeof payload.error.code === "string"
    ? payload.error.code
    : null;

const providerErrorFrom = (
  response: Response,
  payload: unknown,
): ModelProviderError => {
  if (response.status === 401 || response.status === 403) {
    return new ModelProviderError(
      "unauthenticated",
      "OpenAI authentication failed.",
    );
  }
  if (response.status === 429) {
    return new ModelProviderError(
      "rate-limited",
      "OpenAI rate limit reached.",
    );
  }
  if (
    response.status === 413 ||
    apiErrorCodeFrom(payload) === "context_length_exceeded"
  ) {
    return new ModelProviderError(
      "over-budget",
      "OpenAI Model Task exceeded its request budget.",
    );
  }
  return new ModelProviderError("unavailable", "OpenAI is unavailable.");
};

export const createOpenAIModelProvider = ({
  apiKey,
  model,
  baseUrl = "https://api.openai.com/v1",
  fetcher = globalThis.fetch,
}: OpenAIModelProviderOptions): ModelProvider => ({
  provider: "openai",
  model,
  invoke: async (task): Promise<ModelProviderResult> => {
    const format = taskFormat(task);
    const response = await fetcher(`${normalizedBaseUrl(baseUrl)}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: instructionsFor(task),
        input: JSON.stringify(task),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: format.name,
            strict: true,
            schema: format.schema,
          },
        },
      }),
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {}
    if (!response.ok) throw providerErrorFrom(response, payload);
    const outputText = outputTextFrom(payload);
    if (outputText === null) {
      throw new ModelProviderError(
        "unavailable",
        "OpenAI returned no model output.",
      );
    }
    let output: unknown = outputText;
    try {
      output = JSON.parse(outputText);
    } catch {}
    return { output, usage: usageFrom(payload) };
  },
});
