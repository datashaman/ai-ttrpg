import { createHash } from "node:crypto";

import { serializeAdventureArchive } from "./adventure-archive.js";
import {
  assembleActorScopedModelTaskEvidence,
  RetrievalScopeError,
} from "./actor-scoped-retrieval.js";
import {
  createInMemoryAdventureRepository,
  type AdventureRepository,
} from "./adventure-repository.js";
import {
  GOLDEN_MODEL_UTTERANCE,
  supportedGoldenCampaignAdapters,
} from "./golden-campaign-adapters.js";
export { supportedGoldenCampaignAdapters } from "./golden-campaign-adapters.js";
import { canonicalJson, immutableSnapshot, isRecord } from "./model-boundary.js";
import {
  type ExecutableRulesetPackage,
} from "./rule-publication.js";
import {
  assembleStateProposalEvidence,
  runExpandedModelTaskSet,
} from "./expanded-model-tasks.js";
import {
  createModelGateway,
  type ModelCallRecord,
  type ModelProvider,
} from "./model-gateway.js";
import {
  createStructuredPlayApplication,
  type ApplicationView,
  type CanonicalEvent,
  type StructuredPlayApplication,
  type StructuredPlayInput,
} from "./structured-play.js";
import {
  createPresentationContext,
  narrateCommittedOutcome,
  type PresentationModel,
} from "./presentation.js";
import { createSeededRandomSource } from "./random-source.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  playerWorldKnowledgeActorScope,
} from "./world-knowledge.js";

type GoldenCampaignStep =
  | StructuredPlayInput
  | { readonly type: "confirm-pending-check" }
  | {
      readonly type: "resolve-pending-check";
      readonly choice: "decline" | "spend-resolve";
    };

export interface GoldenCampaignFixture {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly rulesetVersion: string;
  readonly randomSeed: number;
  readonly propertyRandomSeeds: readonly number[];
  readonly matrix: {
    readonly repositories: readonly string[];
    readonly modelProviders: readonly string[];
    readonly rulesetPackages: readonly string[];
    readonly presentations: readonly string[];
  };
  readonly steps: readonly GoldenCampaignStep[];
  readonly expected: {
    readonly truth: NormalizedCampaignTruth;
    readonly evidence: readonly unknown[];
    readonly visibleClaims: readonly string[];
  };
}

export interface NormalizedCampaignTruth {
  readonly commands: readonly unknown[];
  readonly events: readonly unknown[];
  readonly projection: unknown;
  readonly rules: readonly unknown[];
}

export type EvaluationLayer =
  | "schema"
  | "command"
  | "rule"
  | "event"
  | "projection"
  | "retrieval"
  | "model"
  | "presentation"
  | "adapter";

export interface GoldenCampaignDiagnostic {
  readonly layer: EvaluationLayer;
  readonly message: string;
}

export interface GoldenRepositoryAdapter {
  readonly id: string;
  create(): {
    readonly repository: AdventureRepository;
    cleanup(): void;
  };
}

export interface GoldenModelProviderAdapter {
  readonly id: string;
  createProvider(responses: Readonly<Record<string, unknown>>): ModelProvider;
}

export interface GoldenRulesetPackageAdapter {
  readonly id: string;
  readonly package: ExecutableRulesetPackage;
}

export interface GoldenPresentationAdapter {
  readonly id: string;
  readonly model: PresentationModel;
}

export interface GoldenCampaignAdapters {
  readonly repositories: readonly GoldenRepositoryAdapter[];
  readonly modelProviders: readonly GoldenModelProviderAdapter[];
  readonly rulesetPackages: readonly GoldenRulesetPackageAdapter[];
  readonly presentations: readonly GoldenPresentationAdapter[];
}

export interface GoldenCampaignRun {
  readonly adapters: {
    readonly repository: string;
    readonly modelProvider: string;
    readonly rulesetPackage: string;
    readonly presentation: string;
  };
  readonly status: "passed" | "failed";
  readonly normalizedTruth: NormalizedCampaignTruth;
  readonly normalizedEvidence: readonly unknown[];
  readonly visibleClaims: readonly string[];
  readonly diagnostics: readonly GoldenCampaignDiagnostic[];
}

const invalidFixture = (): never => {
  throw new Error("Invalid golden campaign fixture.");
};

const validStep = (value: unknown): value is GoldenCampaignStep => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "confirm-pending-check") {
    return Object.keys(value).length === 1;
  }
  if (value.type === "resolve-pending-check") {
    return value.choice === "decline" || value.choice === "spend-resolve";
  }
  if (value.type === "configure-player-character") {
    return (
      typeof value.name === "string" &&
      typeof value.pronouns === "string" &&
      typeof value.motivation === "string" &&
      isRecord(value.traits)
    );
  }
  if (value.type === "begin-adventure") return true;
  return value.type === "choose-action" && typeof value.actionId === "string";
};

export const parseGoldenCampaignFixture = (
  serialized: string,
): GoldenCampaignFixture => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return invalidFixture();
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    typeof value.rulesetVersion !== "string" ||
    value.rulesetVersion.trim() === "" ||
    !Number.isSafeInteger(value.randomSeed) ||
    (value.randomSeed as number) < 0 ||
    !Array.isArray(value.propertyRandomSeeds) ||
    value.propertyRandomSeeds.length < 4 ||
    !value.propertyRandomSeeds.every(
      (seed) => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff,
    ) ||
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    !value.steps.every(validStep) ||
    !isRecord(value.matrix) ||
    !["repositories", "modelProviders", "rulesetPackages", "presentations"].every(
      (key) => {
        const matrixEntry = Reflect.get(value.matrix!, key) as unknown;
        return (
          Array.isArray(matrixEntry) &&
          matrixEntry.length > 0 &&
          matrixEntry.every(
          (adapter) => typeof adapter === "string" && adapter.trim() !== "",
          )
        );
      },
    ) ||
    !isRecord(value.expected) ||
    !isRecord(value.expected.truth) ||
    !Array.isArray(value.expected.truth.commands) ||
    !Array.isArray(value.expected.truth.events) ||
    !("projection" in value.expected.truth) ||
    !Array.isArray(value.expected.truth.rules) ||
    !Array.isArray(value.expected.evidence) ||
    !Array.isArray(value.expected.visibleClaims) ||
    !value.expected.visibleClaims.every((claim) => typeof claim === "string")
  ) {
    return invalidFixture();
  }
  return immutableSnapshot(value as unknown as GoldenCampaignFixture);
};

const generatedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalize = (value: unknown): unknown => {
  if (typeof value === "string") {
    if (generatedId.test(value)) return "<generated-id>";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return "<timestamp>";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]),
  );
};

const digest = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(normalize(value))).digest("hex");

const commandFor = (
  step: GoldenCampaignStep,
  application: StructuredPlayApplication,
): StructuredPlayInput => {
  if (step.type === "confirm-pending-check") {
    const proposal = application.view().state.pendingCheckProposal;
    if (proposal === null) throw new Error("No pending Check Proposal to confirm.");
    return { type: "confirm-check-proposal", proposalId: proposal.id };
  }
  if (step.type === "resolve-pending-check") {
    const pendingChoice = application.view().state.pendingChoice;
    if (pendingChoice === null) throw new Error("No Pending Choice to resolve.");
    return {
      type: "resolve-pending-check",
      pendingChoiceId: pendingChoice.id,
      choice: step.choice,
    };
  }
  return structuredClone(step);
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const compare = (
  diagnostics: GoldenCampaignDiagnostic[],
  layer: EvaluationLayer,
  label: string,
  actual: unknown,
  expected: unknown,
): void => {
  if (!same(actual, expected)) {
    diagnostics.push({ layer, message: `${label} did not match the golden output.` });
  }
};

const initialArchive = (fixture: GoldenCampaignFixture): string =>
  serializeAdventureArchive({
    id: `golden-${fixture.id}`,
    name: "The Locked Manor — Golden Campaign",
    randomSeed: fixture.randomSeed,
    activeTimelineId: "timeline-main",
    timelines: [
      {
        id: "timeline-main",
        parentTimelineId: null,
        branchEventPosition: null,
        randomPosition: 0,
        events: [],
      },
    ],
  });

const normalizedEvidence = (
  items: readonly {
    readonly id: string;
    readonly sourceKind: string;
    readonly sourceReference: string;
    readonly inclusionReason: string;
    readonly visibility?: string;
    readonly citation?: string | null;
  }[],
): readonly unknown[] =>
  items
    .map((item) =>
      normalize({
        id: item.id,
        sourceKind: item.sourceKind,
        sourceReference: item.sourceReference,
        inclusionReason: item.inclusionReason,
        visibility: item.visibility ?? null,
        citation: item.citation ?? null,
      }),
    )
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const retrieveModelEvidence = ({
  fixture,
  application,
  events,
  rulesetPackage,
}: {
  readonly fixture: GoldenCampaignFixture;
  readonly application: StructuredPlayApplication;
  readonly events: readonly CanonicalEvent[];
  readonly rulesetPackage: GoldenRulesetPackageAdapter;
}) =>
  assembleActorScopedModelTaskEvidence({
    scope: {
      actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
      playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
      campaignId: fixture.id,
      taskType: "classify-discourse",
      rulesetVersion: fixture.rulesetVersion,
    },
    corpus: {
      campaignId: fixture.id,
      entities: [
        {
          id: "scene:arrival",
          kind: "Location",
          name: "manor side door",
          aliases: ["side door", "arrival"],
          sourceReference: "locked-manor:arrival",
          visibility: "Player-visible",
          playerCharacterIds: [DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId],
        },
      ],
      acceptedEvents: events,
      approvedRules: [rulesetPackage.package],
    },
    utterance: GOLDEN_MODEL_UTTERANCE,
    view: application.view(),
  });

const expandedTaskResponses = (
  bundle: ReturnType<typeof retrieveModelEvidence>,
  rulesetVersion: string,
): Readonly<Record<string, unknown>> => {
  const intent = {
    capabilityId: "force-side-door",
    referencedEntityIds: ["scene:arrival"],
    evidenceItemIds: [
      "entity:scene:arrival",
      "capability:force-side-door",
    ],
  } as const;
  const intentEvidenceItemId = assembleStateProposalEvidence(
    bundle,
    intent,
  ).items.at(-1)!.id;
  const ruleEvidenceItemId = `rule:micro-ruleset.check@${rulesetVersion}`;
  return {
    [`classify-discourse:${GOLDEN_MODEL_UTTERANCE}`]: {
      classification: "player-action",
    },
    [`extract-intent:${GOLDEN_MODEL_UTTERANCE}`]: intent,
    [`propose-state-change:${GOLDEN_MODEL_UTTERANCE}`]: {
      status: "proposed",
      capabilityId: intent.capabilityId,
      referencedEntityIds: intent.referencedEntityIds,
      evidenceItemIds: [
        ...intent.evidenceItemIds,
        ruleEvidenceItemId,
        intentEvidenceItemId,
      ],
      intentEvidenceItemId,
      ruleEvidenceItemIds: [ruleEvidenceItemId],
      stateEvidenceItemIds: ["entity:scene:arrival"],
      rulesetVersion,
      command: { type: "choose-action", actionId: intent.capabilityId },
    },
  };
};

const normalizedTruth = (
  commands: readonly StructuredPlayInput[],
  events: readonly CanonicalEvent[],
  view: ApplicationView,
): NormalizedCampaignTruth => ({
  commands: commands.map((command) => ({
    type: command.type,
    digest: digest(command),
  })),
  events: events.map((event) => ({
    type: event.type,
    payloadDigest: digest(event.payload),
  })),
  projection: {
    digest: digest(view.state),
    activeScene: view.state.activeScene,
    adventureEnding: view.state.adventureEnding?.id ?? null,
    health: view.state.playerCharacter?.health ?? null,
    resolve: view.state.playerCharacter?.resolve ?? null,
    conditions: [...view.state.conditions],
    establishedFactIds: view.state.establishedFacts.map(({ id }) => id).sort(),
  },
  rules: events.flatMap((event) =>
    event.type === "CheckResolved"
      ? [
          {
            id: event.payload.trace.rule.id,
            version: event.payload.trace.rule.version,
            packageChecksum:
              "packageChecksum" in event.payload.trace.rule
                ? event.payload.trace.rule.packageChecksum
                : null,
            sourcePassageIds:
              "sourcePassages" in event.payload.trace.rule
                ? event.payload.trace.rule.sourcePassages.map(
                    ({ documentId, documentVersion, passageAnchor }) =>
                      `${documentId}@${documentVersion}#${passageAnchor}`,
                  )
                : [],
          },
        ]
      : [],
  ),
});

const checkRunInvariants = ({
  diagnostics,
  events,
  application,
  repository,
  adventureId,
  fixture,
  modelCallRecords,
}: {
  readonly diagnostics: GoldenCampaignDiagnostic[];
  readonly events: readonly CanonicalEvent[];
  readonly application: StructuredPlayApplication;
  readonly repository: AdventureRepository;
  readonly adventureId: string;
  readonly fixture: GoldenCampaignFixture;
  readonly modelCallRecords: readonly ModelCallRecord[];
}): void => {
  const state = application.view().state;
  const resources = [state.playerCharacter?.health, state.playerCharacter?.resolve];
  if (
    resources.some(
      (resource) =>
        resource !== undefined &&
        (!Number.isInteger(resource) || resource < 0 || resource > 3),
    )
  ) {
    diagnostics.push({ layer: "projection", message: "A resource left its invariant bounds." });
  }
  const randomInputs = events.flatMap((event) => {
    if (event.type === "CheckRollRevealed") {
      return event.payload.pendingChoice.roll.random.inputs.map((roll) => ({
        roll,
        sides: 6,
      }));
    }
    if (event.type === "OracleAnswered") {
      return event.payload.trace.random.inputs.map((roll) => ({ roll, sides: 100 }));
    }
    return [];
  });
  if (
    randomInputs.some(
      ({ roll, sides }) =>
        !Number.isInteger(roll) || roll < 1 || roll > sides,
    )
  ) {
    diagnostics.push({ layer: "rule", message: "A random input left its declared bounds." });
  }
  if (
    application
      .worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE)
      .entries.some(({ visibility }) => visibility !== "Player-visible")
  ) {
    diagnostics.push({ layer: "retrieval", message: "Actor-scoped evidence leaked forbidden data." });
  }
  let mismatchedScopeRejected = false;
  try {
    assembleActorScopedModelTaskEvidence({
      scope: {
        actorScope: playerWorldKnowledgeActorScope("player-character:other"),
        playerCharacterId: DEFAULT_PLAYER_ACTOR_SCOPE.playerCharacterId,
        campaignId: fixture.id,
        taskType: "interpret-player-input",
        rulesetVersion: fixture.rulesetVersion,
      },
      corpus: {
        campaignId: fixture.id,
        entities: [],
        acceptedEvents: events,
        approvedRules: [],
      },
      utterance: GOLDEN_MODEL_UTTERANCE,
      view: application.view(),
    });
  } catch (error) {
    mismatchedScopeRejected =
      error instanceof RetrievalScopeError &&
      error.code === "ACTOR_SCOPE_MISMATCH";
  }
  if (!mismatchedScopeRejected) {
    diagnostics.push({ layer: "retrieval", message: "A mismatched actor scope was accepted." });
  }
  for (const seed of fixture.propertyRandomSeeds) {
    const left = createSeededRandomSource(seed);
    const right = createSeededRandomSource(seed);
    for (let index = 0; index < 32; index += 1) {
      const leftRoll = left.rollDie(100);
      const rightRoll = right.rollDie(100);
      if (leftRoll !== rightRoll || leftRoll < 1 || leftRoll > 100) {
        diagnostics.push({ layer: "rule", message: `Random property failed for seed ${seed}.` });
        break;
      }
    }
  }
  const archive = repository.exportArchive(adventureId);
  if (
    modelCallRecords.length !== 3 ||
    !modelCallRecords.some(
      (record) =>
        record.command?.type === "choose-action" &&
        record.command.actionId === "force-side-door" &&
        record.validation.status === "accepted",
    )
  ) {
    diagnostics.push({
      layer: "model",
      message: "Expanded Model Tasks did not retain three validated operational records.",
    });
  }
  if (
    modelCallRecords.some(
      (record) =>
        archive.includes(record.id) ||
        archive.includes(record.provider) ||
        archive.includes(record.model),
    )
  ) {
    diagnostics.push({
      layer: "adapter",
      message: "Operational Model Call data entered the portable Adventure archive.",
    });
  }
  const portableRepository = createInMemoryAdventureRepository();
  const portableAdventure = portableRepository.importArchive(archive);
  if (!same(events, portableAdventure.eventStore.readAll())) {
    diagnostics.push({ layer: "adapter", message: "The Adventure archive did not serialize reproducibly." });
  }
  portableAdventure.close();
};

const failedRun = (
  adapters: GoldenCampaignRun["adapters"],
  diagnostic: GoldenCampaignDiagnostic,
): GoldenCampaignRun =>
  immutableSnapshot({
    adapters,
    status: "failed",
    normalizedTruth: {
      commands: [],
      events: [],
      projection: null,
      rules: [],
    },
    normalizedEvidence: [],
    visibleClaims: [],
    diagnostics: [diagnostic],
  });

const runCombination = async ({
  fixture,
  repositoryAdapter,
  modelProvider,
  rulesetPackage,
  presentation,
}: {
  readonly fixture: GoldenCampaignFixture;
  readonly repositoryAdapter: GoldenRepositoryAdapter;
  readonly modelProvider: GoldenModelProviderAdapter;
  readonly rulesetPackage: GoldenRulesetPackageAdapter;
  readonly presentation: GoldenPresentationAdapter;
}): Promise<GoldenCampaignRun> => {
  const diagnostics: GoldenCampaignDiagnostic[] = [];
  const resources = repositoryAdapter.create();
  try {
    const adventure = resources.repository.importArchive(initialArchive(fixture));
    let application: StructuredPlayApplication;
    try {
      application = createStructuredPlayApplication({
        eventStore: adventure.eventStore,
        randomSource: adventure.randomSource,
        checkRulesetPackage: rulesetPackage.package,
      });
    } catch (error) {
      adventure.close();
      return failedRun(
        {
          repository: repositoryAdapter.id,
          modelProvider: modelProvider.id,
          rulesetPackage: rulesetPackage.id,
          presentation: presentation.id,
        },
        {
          layer: "rule",
          message:
            error instanceof Error
              ? error.message
              : "Executable Ruleset Package initialization failed.",
        },
      );
    }
    const commands: StructuredPlayInput[] = [];
    let evidence: readonly unknown[] = [];
    let modelEvaluated = false;
    for (const step of fixture.steps) {
      if (step.type === "choose-action" && !modelEvaluated) {
        const bundle = retrieveModelEvidence({
          fixture,
          application,
          events: adventure.eventStore.readAll(),
          rulesetPackage,
        });
        evidence = normalizedEvidence(bundle.items);
        let expanded: Awaited<ReturnType<typeof runExpandedModelTaskSet>>;
        try {
          expanded = await runExpandedModelTaskSet({
            utterance: GOLDEN_MODEL_UTTERANCE,
            gateway: createModelGateway({
              provider: modelProvider.createProvider(
                expandedTaskResponses(bundle, fixture.rulesetVersion),
              ),
            }),
            modelCallStore: adventure.modelCallStore,
            context: {
              evidenceBundle: bundle,
              knownEntityIds: ["scene:arrival"],
              availableCapabilityIds: application
                .view()
                .availableActions.map(({ id }) => id),
              authorizedCapabilityIds: application
                .view()
                .availableActions.map(({ id }) => id),
              rulesetVersion: fixture.rulesetVersion,
              commandSatisfiesInvariants: (command) =>
                command.type === "choose-action" &&
                application
                  .view()
                  .availableActions.some(({ id }) => id === command.actionId),
            },
          });
        } catch (error) {
          diagnostics.push({
            layer: "model",
            message:
              error instanceof Error
                ? error.message
                : `Provider ${modelProvider.id} failed.`,
          });
          modelEvaluated = true;
          break;
        }
        modelEvaluated = true;
        if (expanded.candidateCommand === null) {
          diagnostics.push({
            layer: "model",
            message: `Provider ${modelProvider.id} did not produce a validated State Proposal.`,
          });
          break;
        }
        commands.push(expanded.candidateCommand);
        const result = application.submit(expanded.candidateCommand);
        if (result.status === "rejected") {
          diagnostics.push({ layer: "command", message: result.message });
          break;
        }
        continue;
      }
      let command: StructuredPlayInput;
      try {
        command = commandFor(step, application);
      } catch (error) {
        diagnostics.push({
          layer: "command",
          message: error instanceof Error ? error.message : "Command construction failed.",
        });
        break;
      }
      commands.push(command);
      const result = application.submit(command);
      if (result.status === "rejected") {
        diagnostics.push({ layer: "command", message: result.message });
        break;
      }
    }
    const events = adventure.eventStore.readAll();
    if (diagnostics.some(({ layer }) => layer === "model")) {
      const truth = normalizedTruth(commands, events, application.view());
      adventure.close();
      return immutableSnapshot({
        adapters: {
          repository: repositoryAdapter.id,
          modelProvider: modelProvider.id,
          rulesetPackage: rulesetPackage.id,
          presentation: presentation.id,
        },
        status: "failed",
        normalizedTruth: truth,
        normalizedEvidence: evidence,
        visibleClaims: [],
        diagnostics,
      });
    }
    let claims: readonly string[] = [];
    try {
      const resolved = [...events]
        .reverse()
        .find((event) => event.type === "CheckResolved");
      if (resolved?.type !== "CheckResolved") {
        throw new Error("No committed Check outcome is available to present.");
      }
      const context = createPresentationContext({
        visibleEvidence: application.view().state.establishedFacts,
        resolutionTrace: resolved.payload.trace,
        committedEvents: [resolved],
        deterministicSummary: resolved.payload.committedStake.summary,
      });
      const presented = await narrateCommittedOutcome(
        presentation.model,
        context,
        100,
      );
      claims = [presented.text];
    } catch (error) {
      diagnostics.push({
        layer: "presentation",
        message: error instanceof Error ? error.message : "Presentation adapter failed.",
      });
    }
    const modelCallRecords = adventure.modelCallStore.readAll();
    checkRunInvariants({
      diagnostics,
      events,
      application,
      repository: resources.repository,
      adventureId: adventure.id,
      fixture,
      modelCallRecords,
    });
    const truth = normalizedTruth(commands, events, application.view());
    adventure.close();
    const reopened = resources.repository.open(adventure.id);
    const replayed = createStructuredPlayApplication({
      eventStore: reopened.eventStore,
      randomSource: reopened.randomSource,
      checkRulesetPackage: rulesetPackage.package,
    });
    const replayedTruth = normalizedTruth(commands, reopened.eventStore.readAll(), replayed.view());
    if (!same(truth, replayedTruth)) {
      diagnostics.push({ layer: "projection", message: "Replay diverged from the committed campaign." });
    }
    if (
      reopened.modelCallStore.readAll().length !== modelCallRecords.length
    ) {
      diagnostics.push({
        layer: "model",
        message: "Operational Model Call Records did not survive repository reopen.",
      });
    }
    compare(diagnostics, "model", "Provider commands", truth.commands, fixture.expected.truth.commands);
    compare(diagnostics, "event", "Canonical events", truth.events, fixture.expected.truth.events);
    compare(diagnostics, "projection", "Campaign projection", truth.projection, fixture.expected.truth.projection);
    compare(diagnostics, "rule", "Rules traces", truth.rules, fixture.expected.truth.rules);
    compare(diagnostics, "retrieval", "Evidence", evidence, fixture.expected.evidence);
    compare(diagnostics, "presentation", "Visible claims", claims, fixture.expected.visibleClaims);
    reopened.close();
    return immutableSnapshot({
      adapters: {
        repository: repositoryAdapter.id,
        modelProvider: modelProvider.id,
        rulesetPackage: rulesetPackage.id,
        presentation: presentation.id,
      },
      status: diagnostics.length === 0 ? "passed" : "failed",
      normalizedTruth: truth,
      normalizedEvidence: evidence,
      visibleClaims: claims,
      diagnostics,
    });
  } finally {
    resources.cleanup();
  }
};

export const evaluateGoldenCampaign = async ({
  fixture,
  adapters,
}: {
  readonly fixture: GoldenCampaignFixture;
  readonly adapters: GoldenCampaignAdapters;
}) => {
  const matrix = {
    repositories: adapters.repositories.map(({ id }) => id),
    modelProviders: adapters.modelProviders.map(({ id }) => id),
    rulesetPackages: adapters.rulesetPackages.map(({ id }) => id),
    presentations: adapters.presentations.map(({ id }) => id),
  };
  if (
    adapters.repositories.length === 0 ||
    adapters.modelProviders.length === 0 ||
    adapters.rulesetPackages.length === 0 ||
    adapters.presentations.length === 0
  ) {
    throw new Error("Golden campaign evaluation requires a complete adapter matrix.");
  }
  if (!same(matrix, fixture.matrix)) {
    return immutableSnapshot({
      evaluationId: fixture.id,
      schemaVersion: 1 as const,
      matrix,
      runs: [] as readonly GoldenCampaignRun[],
      diagnostics: [
        {
          layer: "adapter" as const,
          message: "Configured adapters do not match the versioned golden matrix.",
        },
      ],
    });
  }
  const runs: GoldenCampaignRun[] = [];
  for (const repositoryAdapter of adapters.repositories) {
    for (const modelProvider of adapters.modelProviders) {
      for (const rulesetPackage of adapters.rulesetPackages) {
        for (const presentation of adapters.presentations) {
          runs.push(
            await runCombination({
              fixture,
              repositoryAdapter,
              modelProvider,
              rulesetPackage,
              presentation,
            }),
          );
        }
      }
    }
  }
  return immutableSnapshot({
    evaluationId: fixture.id,
    schemaVersion: 1 as const,
    matrix,
    runs,
    diagnostics: [] as readonly GoldenCampaignDiagnostic[],
  });
};

export const evaluateGoldenCampaignText = async ({
  serializedFixture,
  adapters,
}: {
  readonly serializedFixture: string;
  readonly adapters: GoldenCampaignAdapters;
}) => {
  let fixture: GoldenCampaignFixture;
  try {
    fixture = parseGoldenCampaignFixture(serializedFixture);
  } catch (error) {
    return immutableSnapshot({
      evaluationId: null,
      schemaVersion: 1 as const,
      matrix: null,
      runs: [] as readonly GoldenCampaignRun[],
      diagnostics: [
        {
          layer: "schema" as const,
          message:
            error instanceof Error
              ? error.message
              : "Invalid golden campaign fixture.",
        },
      ],
    });
  }
  try {
    return await evaluateGoldenCampaign({ fixture, adapters });
  } catch (error) {
    return immutableSnapshot({
      evaluationId: fixture.id,
      schemaVersion: 1 as const,
      matrix: fixture.matrix,
      runs: [] as readonly GoldenCampaignRun[],
      diagnostics: [
        {
          layer: "adapter" as const,
          message:
            error instanceof Error
              ? error.message
              : "Golden campaign execution failed.",
        },
      ],
    });
  }
};
