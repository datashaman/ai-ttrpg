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

const interpretationResultSchema: JsonSchema = {
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

const interpretationSchema: JsonSchema = exactObject({
  result: interpretationResultSchema,
});

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

const discourseClassificationSchema: JsonSchema = exactObject({
  classification: {
    type: "string",
    enum: [
      "player-action",
      "in-character-speech",
      "rules-query",
      "out-of-character-request",
      "table-chat",
      "system-command",
    ],
  },
});

const intentExtractionSchema: JsonSchema = exactObject({
  capabilityId: { type: "string", minLength: 1 },
  referencedEntityIds: { ...stringArraySchema, minItems: 1 },
  evidenceItemIds: { ...stringArraySchema, minItems: 1 },
});

const ruleMatchResultSchema: JsonSchema = {
  anyOf: [
    exactObject({
      status: { type: "string", enum: ["matched"] },
      ruleId: { type: "string", minLength: 1 },
      evidenceItemIds: { ...stringArraySchema, minItems: 1 },
    }),
    exactObject({
      status: { type: "string", enum: ["no-rule"] },
    }),
    exactObject({
      status: { type: "string", enum: ["needs-adjudication"] },
      candidateRuleIds: { ...stringArraySchema, minItems: 2 },
    }),
  ],
};

const ruleMatchSchema: JsonSchema = exactObject({
  result: ruleMatchResultSchema,
});

const stateProposalSchema: JsonSchema = exactObject({
  status: { type: "string", enum: ["proposed"] },
  capabilityId: { type: "string", minLength: 1 },
  referencedEntityIds: { ...stringArraySchema, minItems: 1 },
  evidenceItemIds: { ...stringArraySchema, minItems: 1 },
  intentEvidenceItemId: { type: "string", minLength: 1 },
  ruleEvidenceItemIds: stringArraySchema,
  stateEvidenceItemIds: { ...stringArraySchema, minItems: 1 },
  rulesetVersion: { type: "string", minLength: 1 },
  command: exactObject({
    type: { type: "string", enum: ["choose-action"] },
    actionId: { type: "string", minLength: 1 },
  }),
});

interface ModelTaskDefinition {
  readonly name: string;
  readonly schema: JsonSchema;
  readonly instructions: string;
  normalizeOutput(output: unknown): unknown;
}

const unchangedOutput = (output: unknown): unknown => output;

const normalizedResultOutput = (output: unknown): unknown =>
  isRecord(output) &&
  Object.keys(output).length === 1 &&
  "result" in output
    ? output.result
    : output;

const modelTaskDefinitions: Readonly<
  Record<ModelTask["type"], ModelTaskDefinition>
> = {
  "interpret-player-input": {
    name: "interpret_player_input",
    schema: interpretationSchema,
    instructions:
      "Classify the Player's utterance using only the supplied Model Task and Evidence Bundle. Select only an available capability, cite supplied evidence item IDs, and never invent game truth or Mechanical Effects. Return the interpretation in the result field using JSON matching the supplied schema.",
    normalizeOutput: normalizedResultOutput,
  },
  "classify-discourse": {
    name: "classify_discourse",
    schema: discourseClassificationSchema,
    instructions:
      "Classify the Player's utterance into exactly one supplied discourse class. Do not infer a command, rule, or state change. Return JSON matching the supplied schema.",
    normalizeOutput: unchangedOutput,
  },
  "extract-intent": {
    name: "extract_intent",
    schema: intentExtractionSchema,
    instructions:
      "Extract one intent using only capability, entity, and evidence IDs present in the supplied actor-scoped Evidence Bundle. Return JSON matching the supplied schema.",
    normalizeOutput: unchangedOutput,
  },
  "suggest-rule-match": {
    name: "suggest_rule_match",
    schema: ruleMatchSchema,
    instructions:
      "Suggest only approved rules present in the supplied actor-scoped Evidence Bundle. Return matched, no-rule, or needs-adjudication in the result field; never choose between ambiguous rules. Return JSON matching the supplied schema.",
    normalizeOutput: normalizedResultOutput,
  },
  "propose-state-change": {
    name: "propose_state_change",
    schema: stateProposalSchema,
    instructions:
      "Propose one candidate command using only the supplied validated intent, exact ruleset version, entities, capabilities, and evidence. Cite every applicable approved rule; use an empty ruleEvidenceItemIds array only when the Evidence Bundle contains no applicable approved rule. Do not apply a Mechanical Effect or append an event. Return JSON matching the supplied schema.",
    normalizeOutput: unchangedOutput,
  },
  "explain-rules": {
    name: "explain_rules",
    schema: attributedSegmentsSchema,
    instructions:
      "Explain only authored rules that directly answer the Player's query. Every segment must reproduce an applicable authority-rule Evidence Bundle item exactly and cite its item ID. Return JSON matching the supplied schema.",
    normalizeOutput: unchangedOutput,
  },
  "narrate-committed-outcome": {
    name: "narrate_committed_outcome",
    schema: attributedSegmentsSchema,
    instructions:
      "Narrate only claims established by the committed outcome. Every segment must cite the Evidence Bundle items that support it. Do not invent characters, motives, locations, mechanics, outcomes, or actionable facts. Return JSON matching the supplied schema.",
    normalizeOutput: unchangedOutput,
  },
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
    const definition = modelTaskDefinitions[task.type];
    const response = await fetcher(`${normalizedBaseUrl(baseUrl)}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: definition.instructions,
        input: JSON.stringify(task),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: definition.name,
            strict: true,
            schema: definition.schema,
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
    return {
      output: definition.normalizeOutput(output),
      usage: usageFrom(payload),
    };
  },
});
