import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type ApplicationView,
  type AvailableAction,
  type EventStore,
  type RandomSource,
  type StructuredPlayInput,
  type StructuredPlayOptions,
  type TimelineStore,
} from "./structured-play.js";
import {
  hasExactKeys,
  immutableSnapshot,
  invokeWithinTimeout,
  isRecord,
} from "./model-boundary.js";
import {
  assembleInterpretationEvidence,
  type EvidenceBundle,
} from "./evidence-bundle.js";
import {
  createInMemoryModelCallRecordStore,
  modelCallRecordFrom,
  type ModelCallRecord,
  type ModelCallRecordStore,
  type ModelGateway,
  type ModelGatewayExecution,
  type ModelFailureCode,
} from "./model-gateway.js";
import { completePlayerCharacterSetup } from "./player-character-setup.js";
import {
  runStructuredPlay,
  type PresentationModel,
  type StructuredPlayIO,
} from "./structured-play-runner.js";

export type InputClassification =
  | "player-action"
  | "in-character-speech"
  | "rules-query"
  | "out-of-character-request"
  | "table-chat"
  | "system-command";

export interface KnownEntity {
  readonly id: string;
  readonly label: string;
  readonly kind: "Player Character" | "Scene" | "Inventory Item" | "Established Fact";
}

export interface AvailableCapability {
  readonly id: string;
  readonly label: string;
  readonly kind: AvailableAction["kind"];
}

export interface InterpretationRequest {
  readonly utterance: string;
  readonly knownEntities: readonly KnownEntity[];
  readonly availableCapabilities: readonly AvailableCapability[];
  readonly visibleEvidence: ApplicationView["state"]["establishedFacts"];
}

export interface InterpretationModel {
  interpret(request: InterpretationRequest): Promise<unknown>;
}

export interface NaturalLanguagePlayOptions {
  readonly io: StructuredPlayIO;
  readonly interpreter?: InterpretationModel;
  readonly modelGateway?: ModelGateway;
  readonly modelCallStore?: ModelCallRecordStore;
  readonly evidenceBudget?: number;
  readonly eventStore?: EventStore;
  readonly timelineStore?: TimelineStore;
  readonly randomSource?: RandomSource;
  readonly applicationOptions?: Omit<
    StructuredPlayOptions,
    "eventStore" | "randomSource" | "timelineStore"
  >;
  readonly runToAdventureEnd?: boolean;
  readonly interpretationTimeoutMs?: number;
  readonly narrator?: PresentationModel;
  readonly narrationTimeoutMs?: number;
}

export interface NaturalLanguagePlayResult extends ApplicationView {
  readonly interpretedCommands: readonly StructuredPlayInput[];
  readonly modelCallRecords: readonly ModelCallRecord[];
}

const knownEntitiesFrom = (view: ApplicationView): readonly KnownEntity[] => {
  const entities: KnownEntity[] = [];
  const playerCharacter = view.state.playerCharacter;
  if (playerCharacter !== null) {
    entities.push({
      id: "player-character",
      label: playerCharacter.name,
      kind: "Player Character",
    });
    playerCharacter.inventory
      .filter((item) => item.state === "carried")
      .forEach((item) =>
        entities.push({
          id: `inventory:${item.name}`,
          label: item.name,
          kind: "Inventory Item",
        }),
      );
  }
  if (view.state.activeScene !== null) {
    entities.push({
      id: `scene:${view.state.activeScene}`,
      label: view.state.activeScene,
      kind: "Scene",
    });
  }
  view.state.establishedFacts.forEach((fact) =>
    entities.push({ id: fact.id, label: fact.text, kind: "Established Fact" }),
  );
  return entities;
};

const actionCommand = (
  action: AvailableAction,
): StructuredPlayInput | null =>
  action.kind === "Free Action" ||
  action.kind === "Check" ||
  action.kind === "Oracle"
    ? { type: "choose-action", actionId: action.id }
    : action.kind === "Recovery"
      ? { type: "use-field-kit", resource: action.resource }
      : action.kind === "Scene Transition"
        ? { type: "transition-scene", scene: action.scene }
        : action.kind === "Timeline Selection"
          ? { type: "select-timeline", timelineId: action.timelineId }
          : null;

const selectedCapability = (
  interpretation: unknown,
  request: InterpretationRequest,
  actions: readonly AvailableAction[],
  evidenceBundle?: EvidenceBundle,
): { readonly action: AvailableAction; readonly command: StructuredPlayInput } | null => {
  const expectedKeys = [
    "status",
    "classification",
    "capabilityId",
    "referencedEntityIds",
    "arguments",
    ...(evidenceBundle === undefined ? [] : ["evidenceItemIds"]),
  ];
  if (
    !isRecord(interpretation) ||
    !hasExactKeys(interpretation, expectedKeys) ||
    interpretation.status !== "interpreted" ||
    (interpretation.classification !== "player-action" &&
      interpretation.classification !== "in-character-speech") ||
    typeof interpretation.capabilityId !== "string" ||
    !Array.isArray(interpretation.referencedEntityIds) ||
    !interpretation.referencedEntityIds.every((id) => typeof id === "string") ||
    !isRecord(interpretation.arguments) ||
    Object.keys(interpretation.arguments).length !== 0
  ) {
    return null;
  }
  const knownIds = new Set(request.knownEntities.map((entity) => entity.id));
  if (!interpretation.referencedEntityIds.every((id) => knownIds.has(id))) {
    return null;
  }
  if (evidenceBundle !== undefined) {
    if (
      interpretation.referencedEntityIds.length === 0 ||
      !Array.isArray(interpretation.evidenceItemIds) ||
      !interpretation.evidenceItemIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    const evidenceById = new Map(
      evidenceBundle.items.map((item) => [item.id, item]),
    );
    const evidenceIds = interpretation.evidenceItemIds as string[];
    if (
      new Set(evidenceIds).size !== evidenceIds.length ||
      !evidenceIds.every((id) => evidenceById.has(id)) ||
      !evidenceIds.includes(`capability:${interpretation.capabilityId}`) ||
      !interpretation.referencedEntityIds.every((entityId) =>
        evidenceIds.some(
          (evidenceId) =>
            evidenceById.get(evidenceId)?.sourceReference === entityId,
        ),
      )
    ) {
      return null;
    }
  }
  const action = actions.find((candidate) => candidate.id === interpretation.capabilityId);
  if (action === undefined) return null;
  const command = actionCommand(action);
  return command === null ? null : { action, command };
};

const referencesAreKnown = (
  interpretation: Record<string, unknown>,
  request: InterpretationRequest,
): boolean => {
  if (
    !Array.isArray(interpretation.referencedEntityIds) ||
    !interpretation.referencedEntityIds.every((id) => typeof id === "string")
  ) {
    return false;
  }
  const knownIds = new Set(request.knownEntities.map((entity) => entity.id));
  return interpretation.referencedEntityIds.every((id) => knownIds.has(id));
};

const isRulesQuery = (
  interpretation: unknown,
  request: InterpretationRequest,
): boolean => {
  if (
    !isRecord(interpretation) ||
    !hasExactKeys(interpretation, [
      "status",
      "classification",
      "referencedEntityIds",
    ]) ||
    interpretation.status !== "interpreted" ||
    interpretation.classification !== "rules-query" ||
    !referencesAreKnown(interpretation, request)
  ) {
    return false;
  }
  return true;
};

type NonGameplayClassification =
  | "in-character-speech"
  | "out-of-character-request"
  | "table-chat"
  | "show-state"
  | "show-actions"
  | "stop";

const nonGameplayClassification = (
  interpretation: unknown,
  request: InterpretationRequest,
): NonGameplayClassification | null => {
  if (!isRecord(interpretation) || interpretation.status !== "interpreted") {
    return null;
  }
  if (
    interpretation.classification === "in-character-speech" &&
    hasExactKeys(interpretation, [
      "status",
      "classification",
      "capabilityId",
      "referencedEntityIds",
      "arguments",
    ]) &&
    interpretation.capabilityId === null &&
    isRecord(interpretation.arguments) &&
    Object.keys(interpretation.arguments).length === 0 &&
    referencesAreKnown(interpretation, request)
  ) {
    return "in-character-speech";
  }
  if (
    (interpretation.classification === "out-of-character-request" ||
      interpretation.classification === "table-chat") &&
    hasExactKeys(interpretation, [
      "status",
      "classification",
      "referencedEntityIds",
    ]) &&
    referencesAreKnown(interpretation, request)
  ) {
    return interpretation.classification;
  }
  if (
    interpretation.classification === "system-command" &&
    hasExactKeys(interpretation, [
      "status",
      "classification",
      "command",
      "referencedEntityIds",
    ]) &&
    (interpretation.command === "show-state" ||
      interpretation.command === "show-actions" ||
      interpretation.command === "stop") &&
    referencesAreKnown(interpretation, request)
  ) {
    return interpretation.command;
  }
  return null;
};

const clarificationFrom = (
  interpretation: unknown,
  request: InterpretationRequest,
): string | null => {
  if (
    !isRecord(interpretation) ||
    !hasExactKeys(interpretation, ["status", "candidateCapabilityIds"]) ||
    interpretation.status !== "ambiguous" ||
    !Array.isArray(interpretation.candidateCapabilityIds) ||
    interpretation.candidateCapabilityIds.length < 2 ||
    !interpretation.candidateCapabilityIds.every(
      (id) => typeof id === "string",
    )
  ) {
    return null;
  }
  const capabilities = new Map(
    request.availableCapabilities.map((capability) => [
      capability.id,
      capability,
    ]),
  );
  const candidateIds = interpretation.candidateCapabilityIds as string[];
  if (
    new Set(candidateIds).size !== candidateIds.length ||
    !candidateIds.every((id) => capabilities.has(id))
  ) {
    return null;
  }
  const labels = candidateIds.map((id) => capabilities.get(id)!.label);
  if (labels.length === 2) {
    return `Did you mean "${labels[0]}" or "${labels[1]}"?`;
  }
  return `Did you mean one of: ${labels.map((label) => `"${label}"`).join(", ")}?`;
};

const isStructurallyValidInterpretation = (interpretation: unknown): boolean => {
  if (!isRecord(interpretation) || typeof interpretation.status !== "string") {
    return false;
  }
  if (interpretation.status === "ambiguous") {
    return (
      hasExactKeys(interpretation, ["status", "candidateCapabilityIds"]) &&
      Array.isArray(interpretation.candidateCapabilityIds) &&
      interpretation.candidateCapabilityIds.every((id) => typeof id === "string")
    );
  }
  if (interpretation.status !== "interpreted") return false;
  const classification = interpretation.classification;
  if (
    classification === "player-action" ||
    classification === "in-character-speech"
  ) {
    return (
      hasExactKeys(interpretation, [
        "status",
        "classification",
        "capabilityId",
        "referencedEntityIds",
        "evidenceItemIds",
        "arguments",
      ]) &&
      (typeof interpretation.capabilityId === "string" ||
        interpretation.capabilityId === null) &&
      Array.isArray(interpretation.referencedEntityIds) &&
      Array.isArray(interpretation.evidenceItemIds) &&
      isRecord(interpretation.arguments)
    );
  }
  if (classification === "rules-query") {
    return hasExactKeys(interpretation, [
      "status",
      "classification",
      "referencedEntityIds",
    ]);
  }
  if (
    classification === "out-of-character-request" ||
    classification === "table-chat"
  ) {
    return hasExactKeys(interpretation, [
      "status",
      "classification",
      "referencedEntityIds",
    ]);
  }
  return (
    classification === "system-command" &&
    hasExactKeys(interpretation, [
      "status",
      "classification",
      "command",
      "referencedEntityIds",
    ])
  );
};

const writeNonGameplayResponse = (
  io: StructuredPlayIO,
  classification: NonGameplayClassification,
  view: ApplicationView,
): void => {
  if (classification === "in-character-speech") {
    io.write("In-character speech acknowledged; no gameplay action was taken.\n");
    return;
  }
  if (classification === "out-of-character-request") {
    io.write("Out-of-character request acknowledged; no gameplay action was taken.\n");
    return;
  }
  if (classification === "table-chat") {
    io.write("Table chat acknowledged; no gameplay action was taken.\n");
    return;
  }
  if (classification === "show-state") {
    io.write("Current Player-visible state:\n");
    io.write(`${JSON.stringify(view.state, null, 2)}\n`);
    return;
  }
  if (classification === "show-actions") {
    io.write("Available capabilities:\n");
    view.availableActions.forEach((action) =>
      io.write(`- ${action.label} [${action.kind}]\n`),
    );
    return;
  }
  io.write("Natural-language play stopped without changing game truth.\n");
};

const writeRulesEvidence = (
  io: StructuredPlayIO,
  view: ApplicationView,
): void => {
  io.write("Rules evidence\n");
  io.write(`Active Scene: ${view.state.activeScene ?? "None"}\n`);
  if (view.state.lastCheckResolution !== null) {
    const trace = view.state.lastCheckResolution.trace;
    io.write(
      `${trace.rule.id}@${trace.rule.version}: total ${trace.result.total} resolved as ${trace.result.outcome}.\n`,
    );
  }
  if (view.state.lastOracleResolution !== null) {
    const trace = view.state.lastOracleResolution.trace;
    io.write(
      `${trace.rule.id}@${trace.rule.version}: roll ${trace.result.roll} resolved ${trace.result.answer}.\n`,
    );
  }
  io.write("Visible Established Facts:\n");
  if (view.state.establishedFacts.length === 0) {
    io.write("- None\n");
  } else {
    view.state.establishedFacts.forEach((fact) => io.write(`- ${fact.text}\n`));
  }
};

const writeStructuredPlayChoices = (
  io: StructuredPlayIO,
  view: ApplicationView,
): void => {
  io.write("Structured Play choices:\n");
  view.availableActions.forEach((action, index) =>
    io.write(`${index + 1}. ${action.label} [${action.kind}]\n`),
  );
};

const modelFailureExplanation = (
  code: ModelFailureCode,
  reason: string,
): string => {
  if (code === "timeout") return "Model interpretation timed out.";
  if (code === "unauthenticated") return "Model authentication failed.";
  if (code === "rate-limited") return "The model provider rate limit was reached.";
  if (code === "over-budget") return "The Model Task exceeded its budget.";
  if (code === "unavailable") return "The model provider is unavailable.";
  return reason;
};

const writeSafeFailure = (
  io: StructuredPlayIO,
  view: ApplicationView,
  explanation: string,
): void => {
  io.write(`${explanation} No gameplay action was taken.\n`);
  writeStructuredPlayChoices(io, view);
};

const createApplication = (
  options: NaturalLanguagePlayOptions,
  eventStore: EventStore,
) =>
  createStructuredPlayApplication(
    options.timelineStore !== undefined
      ? { ...options.applicationOptions, timelineStore: options.timelineStore }
      : options.randomSource === undefined
        ? { ...options.applicationOptions, eventStore }
        : {
            ...options.applicationOptions,
            eventStore,
            randomSource: options.randomSource,
          },
  );

const runThroughStructuredPlay = (
  options: NaturalLanguagePlayOptions,
  eventStore: EventStore,
  io: StructuredPlayIO,
): Promise<ApplicationView> =>
  runStructuredPlay({
    io,
    eventStore,
    ...(options.timelineStore === undefined
      ? {}
      : { timelineStore: options.timelineStore }),
    ...(options.randomSource === undefined
      ? {}
      : { randomSource: options.randomSource }),
    ...(options.applicationOptions === undefined
      ? {}
      : { applicationOptions: options.applicationOptions }),
    ...(options.narrator === undefined ? {} : { narrator: options.narrator }),
    ...(options.narrationTimeoutMs === undefined
      ? {}
      : { narrationTimeoutMs: options.narrationTimeoutMs }),
  });

const acceptedEventsFor = (
  options: NaturalLanguagePlayOptions,
  eventStore: EventStore,
) =>
  options.timelineStore === undefined
    ? eventStore.readAll()
    : options.timelineStore.readTimeline(
        options.timelineStore.view().activeTimelineId,
      );

const withoutInterpretedCommand = (
  view: ApplicationView,
  modelCallStore: ModelCallRecordStore,
): NaturalLanguagePlayResult => ({
  ...view,
  interpretedCommands: [],
  modelCallRecords: modelCallStore.readAll(),
});

const appendUncorrelatedModelCall = (
  modelCallStore: ModelCallRecordStore,
  execution: ModelGatewayExecution,
  validation: ModelCallRecord["validation"],
  validatedOutput: unknown | null,
  fallbackOutcome: ModelCallRecord["fallbackOutcome"],
): void =>
  modelCallStore.append(
    modelCallRecordFrom({
      execution,
      validation,
      validatedOutput,
      command: null,
      acceptedEvents: [],
      fallbackOutcome,
    }),
  );

export const runNaturalLanguagePlay = async (
  options: NaturalLanguagePlayOptions,
): Promise<NaturalLanguagePlayResult> => {
  const eventStore = options.eventStore ?? createInMemoryEventStore();
  const modelCallStore =
    options.modelCallStore ?? createInMemoryModelCallRecordStore();
  let app = createApplication(options, eventStore);
  let view = app.view();
  if (view.state.playerCharacter === null) {
    await completePlayerCharacterSetup(app, options.io);
    const started = app.submit({ type: "begin-adventure" });
    options.io.write(`${started.message}\n\n`);
    view = started;
  }

  if (
    view.state.pendingChoice !== null ||
    view.state.pendingCheckProposal !== null ||
    view.state.pendingNarratorRecommendation !== null
  ) {
    const completed = await runThroughStructuredPlay(
      options,
      eventStore,
      options.io,
    );
    return withoutInterpretedCommand(completed, modelCallStore);
  }
  if (view.state.adventureEnding !== null) {
    return withoutInterpretedCommand(view, modelCallStore);
  }

  const utterance = await options.io.read("What do you do? ");
  const request = immutableSnapshot({
    utterance,
    knownEntities: knownEntitiesFrom(view),
    availableCapabilities: view.availableActions.map((action) => ({
      id: action.id,
      label: action.label,
      kind: action.kind,
    })),
    visibleEvidence: view.state.establishedFacts,
  });
  const evidenceBundle = assembleInterpretationEvidence({
    utterance,
    view,
    acceptedEvents: acceptedEventsFor(options, eventStore),
    ...(options.evidenceBudget === undefined
      ? {}
      : { maxItems: options.evidenceBudget }),
  });
  let interpretation: unknown;
  let gatewayExecution: ModelGatewayExecution | null = null;
  try {
    if (options.modelGateway !== undefined) {
      gatewayExecution = await options.modelGateway.execute(
        immutableSnapshot({
          type: "interpret-player-input" as const,
          input: { utterance },
          evidenceBundle,
        }),
        {
          timeoutMs: options.interpretationTimeoutMs ?? 5_000,
          isStructurallyValid: isStructurallyValidInterpretation,
        },
      );
      if (gatewayExecution.outcome.status === "failed") {
        appendUncorrelatedModelCall(
          modelCallStore,
          gatewayExecution,
          {
            status: "rejected",
            reason: gatewayExecution.outcome.reason,
          },
          null,
          "safe-rejection",
        );
        writeSafeFailure(
          options.io,
          view,
          modelFailureExplanation(
            gatewayExecution.outcome.code,
            gatewayExecution.outcome.reason,
          ),
        );
        return withoutInterpretedCommand(view, modelCallStore);
      }
      interpretation = gatewayExecution.outcome.output;
    } else if (options.interpreter !== undefined) {
      interpretation = await invokeWithinTimeout(
        () => options.interpreter!.interpret(request),
        options.interpretationTimeoutMs ?? 5_000,
      );
    } else {
      throw new Error("Natural Language Play requires a model gateway.");
    }
  } catch {
    writeSafeFailure(
      options.io,
      view,
      "I could not safely map that input to an available capability.",
    );
    return withoutInterpretedCommand(view, modelCallStore);
  }
  const clarification = clarificationFrom(interpretation, request);
  if (clarification !== null) {
    if (gatewayExecution !== null) {
      appendUncorrelatedModelCall(
        modelCallStore,
        gatewayExecution,
        { status: "accepted" },
        interpretation,
        "none",
      );
    }
    options.io.write(`Clarification needed: ${clarification}\n`);
    writeStructuredPlayChoices(options.io, view);
    return withoutInterpretedCommand(view, modelCallStore);
  }
  if (isRulesQuery(interpretation, request)) {
    if (gatewayExecution !== null) {
      appendUncorrelatedModelCall(
        modelCallStore,
        gatewayExecution,
        { status: "accepted" },
        interpretation,
        "none",
      );
    }
    writeRulesEvidence(options.io, view);
    return withoutInterpretedCommand(view, modelCallStore);
  }
  const nonGameplay = nonGameplayClassification(interpretation, request);
  if (nonGameplay !== null) {
    if (gatewayExecution !== null) {
      appendUncorrelatedModelCall(
        modelCallStore,
        gatewayExecution,
        { status: "accepted" },
        interpretation,
        "none",
      );
    }
    writeNonGameplayResponse(options.io, nonGameplay, view);
    return withoutInterpretedCommand(view, modelCallStore);
  }
  const selected = selectedCapability(
    interpretation,
    request,
    view.availableActions,
    gatewayExecution === null ? undefined : evidenceBundle,
  );
  if (selected === null) {
    if (gatewayExecution !== null) {
      appendUncorrelatedModelCall(
        modelCallStore,
        gatewayExecution,
        {
          status: "rejected",
          reason: "The output did not select exact, evidenced entity and capability references.",
        },
        null,
        "safe-rejection",
      );
    }
    writeSafeFailure(
      options.io,
      view,
      "I could not safely map that input to an available capability.",
    );
    return withoutInterpretedCommand(view, modelCallStore);
  }

  const actionIndex = view.availableActions.findIndex(
    (action) => action.id === selected.action.id,
  );
  let actionSelected = false;
  const proxyIO: StructuredPlayIO = {
    read: async (prompt) => {
      if (!actionSelected && prompt === "\nChoose an action: ") {
        actionSelected = true;
        return String(actionIndex + 1);
      }
      if (prompt === "Continue in the current Scene (c) or stop (s): ") {
        return "s";
      }
      return options.io.read(prompt);
    },
    write: (text) => options.io.write(text),
  };
  const eventPositionBeforeCommand = acceptedEventsFor(options, eventStore).length;
  const completed = await runThroughStructuredPlay(options, eventStore, proxyIO);
  if (gatewayExecution !== null) {
    const acceptedEvents = acceptedEventsFor(options, eventStore).slice(
      eventPositionBeforeCommand,
    );
    if (acceptedEvents.length === 0) {
      appendUncorrelatedModelCall(
        modelCallStore,
        gatewayExecution,
        {
          status: "rejected",
          reason: "Structured Play authority did not accept and append the interpreted command.",
        },
        null,
        "safe-rejection",
      );
      return withoutInterpretedCommand(completed, modelCallStore);
    }
    modelCallStore.append(
      modelCallRecordFrom({
        execution: gatewayExecution,
        validation: { status: "accepted" },
        validatedOutput: interpretation,
        command: selected.command,
        acceptedEvents,
        fallbackOutcome: "none",
      }),
    );
  }
  if (
    options.runToAdventureEnd === true &&
    completed.state.adventureEnding === null
  ) {
    const continued = await runNaturalLanguagePlay({
      ...options,
      eventStore,
      modelCallStore,
    });
    return {
      ...continued,
      interpretedCommands: [
        selected.command,
        ...continued.interpretedCommands,
      ],
    };
  }
  return {
    ...completed,
    interpretedCommands: [selected.command],
    modelCallRecords: modelCallStore.readAll(),
  };
};
