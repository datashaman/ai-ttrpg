import { createLocalModelDiagnosticCapture } from "./model-diagnostics.js";
import {
  createModelGateway,
  type ModelGateway,
} from "./model-gateway.js";
import {
  createOpenAIModelProvider,
  type OpenAIFetch,
} from "./openai-model-provider.js";

export interface ModelRuntime {
  readonly modelGateway: ModelGateway;
  readonly timeoutMs: number;
}

export type ModelRuntimeEnvironment = Readonly<
  Record<string, string | undefined>
>;

const positiveInteger = (value: string | undefined): number | null => {
  if (value === undefined) return 5_000;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const createModelRuntimeFromEnvironment = (
  environment: ModelRuntimeEnvironment,
  { fetcher }: { readonly fetcher?: OpenAIFetch } = {},
): ModelRuntime | undefined => {
  if (environment.AI_TTRPG_MODEL_PROVIDER !== "openai") return undefined;
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const model = environment.OPENAI_MODEL?.trim();
  const timeoutMs = positiveInteger(environment.AI_TTRPG_MODEL_TIMEOUT_MS);
  if (!apiKey || !model || timeoutMs === null) return undefined;

  const provider = createOpenAIModelProvider({
    apiKey,
    model,
    ...(fetcher === undefined ? {} : { fetcher }),
  });
  const diagnosticPath =
    environment.AI_TTRPG_MODEL_DIAGNOSTIC_PATH?.trim();
  return {
    timeoutMs,
    modelGateway: createModelGateway({
      provider,
      ...(diagnosticPath
        ? {
            diagnosticCapture:
              createLocalModelDiagnosticCapture(diagnosticPath),
          }
        : {}),
    }),
  };
};
