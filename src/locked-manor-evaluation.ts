import { canonicalJson, immutableSnapshot } from "./model-boundary.js";
import {
  createModelGateway,
  createScriptedModelProvider,
} from "./model-gateway.js";
import { runNaturalLanguagePlay } from "./natural-language-play.js";
import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
} from "./structured-play.js";
import type { StructuredPlayIO } from "./structured-play-runner.js";

type ExpectedOutcome =
  | "accepted-action"
  | "acknowledged"
  | "rules-explained"
  | "clarification"
  | "safe-rejection"
  | "deterministic-rules";

export interface LockedManorUtteranceDataset {
  readonly id: string;
  readonly cases: readonly {
    readonly id: string;
    readonly category: string;
    readonly utterance: string;
    readonly responses: Readonly<Record<string, unknown>>;
    readonly expected: ExpectedOutcome;
    readonly expectedEventDelta: number;
    readonly expectedTranscriptIncludes: string;
  }[];
}

const startedAdventure = () => {
  const eventStore = createInMemoryEventStore();
  const application = createStructuredPlayApplication({ eventStore });
  application.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  application.submit({ type: "begin-adventure" });
  return eventStore;
};

export const evaluateLockedManorUtterances = async (
  dataset: LockedManorUtteranceDataset,
) => {
  let correctIntent = 0;
  let intentCases = 0;
  let proposalCases = 0;
  let validProposals = 0;
  let citationCases = 0;
  let accurateCitations = 0;
  let proposalContradictions = 0;
  let correctScenarios = 0;

  for (const benchmarkCase of dataset.cases) {
    const eventStore = startedAdventure();
    const before = eventStore.readAll().length;
    const output: string[] = [];
    const io: StructuredPlayIO = {
      read: async () => benchmarkCase.utterance,
      write: (text) => output.push(text),
    };
    const result = await runNaturalLanguagePlay({
      io,
      modelGateway: createModelGateway({
        provider: createScriptedModelProvider({
          model: dataset.id,
          responses: benchmarkCase.responses,
        }),
      }),
      eventStore,
    });
    const transcript = output.join("");
    const eventDelta = eventStore.readAll().length - before;
    const lastRecord = result.modelCallRecords.at(-1);
    const interpretationRecord = result.modelCallRecords.find(
      ({ taskType }) => taskType === "interpret-player-input",
    );
    const rulesRecord = result.modelCallRecords.find(
      ({ taskType }) => taskType === "explain-rules",
    );
    const expectedOutputs = Object.values(benchmarkCase.responses);
    const expectedInterpretation = expectedOutputs[0];
    const expectedRulesOutput = expectedOutputs[1];
    let matched = false;
    switch (benchmarkCase.expected) {
      case "accepted-action":
        matched = result.interpretedCommands.length === 1 &&
          lastRecord?.validation.status === "accepted";
        break;
      case "acknowledged":
        matched = result.interpretedCommands.length === 0 &&
          lastRecord?.validation.status === "accepted";
        break;
      case "rules-explained":
        matched = /Rules explanation\n/.test(transcript) &&
          lastRecord?.validation.status === "accepted" &&
          lastRecord.fallbackOutcome === "none";
        break;
      case "clarification":
        matched = /Clarification needed:/.test(transcript) &&
          lastRecord?.validation.status === "accepted";
        break;
      case "safe-rejection":
        matched = /could not safely map/i.test(transcript) &&
          lastRecord?.validation.status === "rejected" &&
          lastRecord.fallbackOutcome === "safe-rejection";
        break;
      case "deterministic-rules":
        matched = /Rules explanation \(deterministic fallback\)/.test(transcript) &&
          lastRecord?.validation.status === "rejected" &&
          lastRecord.fallbackOutcome === "deterministic-rules";
        break;
    }
    matched = matched &&
      transcript.includes(benchmarkCase.expectedTranscriptIncludes) &&
      eventDelta === benchmarkCase.expectedEventDelta;
    if (matched) correctScenarios += 1;

    if (benchmarkCase.expected !== "safe-rejection") {
      intentCases += 1;
      const intentCorrect =
        interpretationRecord?.validation.status === "accepted" &&
        interpretationRecord.validatedOutput !== null &&
        canonicalJson(interpretationRecord.validatedOutput) ===
          canonicalJson(expectedInterpretation);
      if (intentCorrect) correctIntent += 1;
    }

    if (["accepted-action", "clarification", "safe-rejection"].includes(benchmarkCase.expected)) {
      proposalCases += 1;
      const proposalCorrect = benchmarkCase.expected === "accepted-action"
        ? interpretationRecord?.validation.status === "accepted" &&
          interpretationRecord.command?.type === "choose-action" &&
          interpretationRecord.command.actionId ===
            (expectedInterpretation as { readonly capabilityId?: unknown })
              .capabilityId &&
          canonicalJson(interpretationRecord.validatedOutput) ===
            canonicalJson(expectedInterpretation)
        : benchmarkCase.expected === "clarification"
          ? interpretationRecord?.validation.status === "accepted" &&
            interpretationRecord.command === null &&
            canonicalJson(interpretationRecord.validatedOutput) ===
              canonicalJson(expectedInterpretation)
          : interpretationRecord?.validation.status === "rejected" &&
            interpretationRecord.command === null;
      if (proposalCorrect) validProposals += 1;
      if (
        (benchmarkCase.expected === "accepted-action" && !proposalCorrect) ||
        (benchmarkCase.expected !== "accepted-action" &&
          interpretationRecord?.command !== null)
      ) {
        proposalContradictions += 1;
      }
    }
    if (["rules-explained", "deterministic-rules"].includes(benchmarkCase.expected)) {
      citationCases += 1;
      const citationCorrect = benchmarkCase.expected === "rules-explained"
        ? rulesRecord?.validation.status === "accepted" &&
          rulesRecord.fallbackOutcome === "none" &&
          rulesRecord.validatedOutput !== null &&
          canonicalJson(rulesRecord.validatedOutput) ===
            canonicalJson(expectedRulesOutput)
        : rulesRecord?.validation.status === "rejected" &&
          rulesRecord.fallbackOutcome === "deterministic-rules";
      if (citationCorrect) accurateCitations += 1;
    }
  }

  return immutableSnapshot({
    datasetId: dataset.id,
    scenarioAccuracy: correctScenarios / dataset.cases.length,
    intentExtractionAccuracy: correctIntent / intentCases,
    proposalValidityAccuracy: validProposals / proposalCases,
    proposalContradictionRate: proposalContradictions / proposalCases,
    citationAccuracy: accurateCitations / citationCases,
  });
};
