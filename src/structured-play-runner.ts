import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type ApplicationView,
  type CanonicalEvent,
  type CheckProposal,
  type EventStore,
  type Likelihood,
  type NarratorLikelihoodRecommendation,
  type RandomSource,
  type StructuredPlayApplication,
  type StructuredPlayOptions,
  type TimelineStore,
  type Trait,
} from "./structured-play.js";
import { completePlayerCharacterSetup } from "./player-character-setup.js";
import { narrateCommittedOutcomeThroughGateway } from "./grounded-narration.js";
import {
  createInMemoryModelCallRecordStore,
  type ModelCallRecordStore,
  type ModelGateway,
} from "./model-gateway.js";
import {
  createPresentationContext,
  explainCommittedRules,
  narrateCommittedOutcome,
  type NarrationRequest,
  type PresentationContext,
  type PresentationModel,
} from "./presentation.js";

export type {
  GroundedPresentation,
  NarrationRequest,
  PresentationModel,
  RulesQueryRequest,
} from "./presentation.js";

export interface StructuredPlayIO {
  read(prompt: string): Promise<string>;
  write(text: string): void;
}

export interface StructuredPlayRunnerOptions {
  readonly io: StructuredPlayIO;
  readonly eventStore?: EventStore;
  readonly timelineStore?: TimelineStore;
  readonly randomSource?: RandomSource;
  readonly applicationOptions?: Omit<
    StructuredPlayOptions,
    "eventStore" | "randomSource" | "timelineStore"
  >;
  readonly runToAdventureEnd?: boolean;
  readonly narrator?: PresentationModel;
  readonly modelGateway?: ModelGateway;
  readonly modelCallStore?: ModelCallRecordStore;
  readonly evidenceBudget?: number;
  readonly narrationTimeoutMs?: number;
}

type PresentationRuntime =
  | {
      readonly kind: "legacy";
      readonly narrator: PresentationModel;
      readonly timeoutMs: number;
    }
  | {
      readonly kind: "model-gateway";
      readonly gateway: ModelGateway;
      readonly modelCallStore: ModelCallRecordStore;
      readonly readAcceptedEvents: () => readonly CanonicalEvent[];
      readonly evidenceBudget?: number;
      readonly timeoutMs: number;
    };

const traceFrom = (
  events: readonly CanonicalEvent[],
): PresentationContext["resolutionTrace"] => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "CheckResolved") return event.payload.trace;
    if (event?.type === "OracleAnswered") return event.payload.trace;
  }
  return null;
};

const presentCommittedOutcome = async (
  io: StructuredPlayIO,
  runtime: PresentationRuntime | undefined,
  result: {
    readonly message: string;
    readonly state: ApplicationView["state"];
    readonly appendedEvents: readonly CanonicalEvent[];
  },
): Promise<void> => {
  if (runtime === undefined || result.appendedEvents.length === 0) return;
  const context = createPresentationContext({
    visibleEvidence: result.state.establishedFacts,
    resolutionTrace: traceFrom(result.appendedEvents),
    committedEvents: result.appendedEvents,
    deterministicSummary: result.message,
  });
  if (
    runtime.kind === "model-gateway" &&
    context.resolutionTrace === null
  ) {
    return;
  }

  const writePresentation = (
    heading: string,
    presentation: Awaited<ReturnType<typeof narrateCommittedOutcome>>,
  ): void => {
    const fallbackLabel =
      presentation.source === "deterministic-fallback"
        ? " (deterministic fallback)"
        : "";
    io.write(`\n${heading}${fallbackLabel}\n`);
    io.write(`${presentation.text}\n`);
  };

  const narrate = (): Promise<
    Awaited<ReturnType<typeof narrateCommittedOutcome>>
  > =>
    runtime.kind === "legacy"
      ? narrateCommittedOutcome(runtime.narrator, context, runtime.timeoutMs)
      : narrateCommittedOutcomeThroughGateway({
          gateway: runtime.gateway,
          modelCallStore: runtime.modelCallStore,
          context,
          acceptedEvents: runtime.readAcceptedEvents(),
          state: result.state,
          timeoutMs: runtime.timeoutMs,
          ...(runtime.evidenceBudget === undefined
            ? {}
            : { evidenceBudget: runtime.evidenceBudget }),
        });

  writePresentation("Narration", await narrate());
  if (runtime.kind === "model-gateway") return;
  while (true) {
    const choice = (
      await io.read(
        "Continue (c), regenerate narration (r), or ask a rules question (q): ",
      )
    )
      .trim()
      .toLowerCase();
    if (choice === "c") return;
    if (choice === "r") {
      writePresentation("Regenerated narration", await narrate());
      continue;
    }
    if (choice === "q") {
      const query = await io.read("Rules question: ");
      const explanation = await explainCommittedRules(
        runtime.narrator,
        context,
        query,
        runtime.timeoutMs,
      );
      writePresentation("Rules explanation", explanation);
      continue;
    }
    io.write("Choose c, r, or q.\n");
  }
};

const presentCheckProposal = (
  io: StructuredPlayIO,
  proposal: CheckProposal,
): void => {
  io.write("\nCheck Proposal\n");
  io.write(`Goal: ${proposal.goal}\n`);
  io.write(`Trait: ${proposal.trait}\n`);
  io.write(`Setback: ${proposal.stakes.Setback.summary}\n`);
  io.write(
    `Success with Cost: ${proposal.stakes["Success with Cost"].summary}\n`,
  );
  io.write(`Clean Success: ${proposal.stakes["Clean Success"].summary}\n`);
};

const readTrait = async (io: StructuredPlayIO): Promise<Trait> => {
  while (true) {
    const answer = (await io.read("Correct Trait (Might, Wits, Presence): ")).trim();
    if (answer === "Might" || answer === "Wits" || answer === "Presence") {
      return answer;
    }
    io.write("Enter Might, Wits, or Presence.\n");
  }
};

const readLikelihood = async (io: StructuredPlayIO): Promise<Likelihood> => {
  while (true) {
    const answer = (
      await io.read("Confirm or change Likelihood — Unlikely (u), Even (e), Likely (l): ")
    )
      .trim()
      .toLowerCase();
    if (answer === "u") return "Unlikely";
    if (answer === "e") return "Even";
    if (answer === "l") return "Likely";
    io.write("Choose u, e, or l.\n");
  }
};

const presentNarratorLikelihoodRecommendation = (
  io: StructuredPlayIO,
  recommendation: NarratorLikelihoodRecommendation,
): void => {
  io.write("\nUnresolved Proposition\n");
  io.write(`${recommendation.proposition.text}\n`);
  io.write(`Narrator recommendation: ${recommendation.likelihood}\n`);
  io.write("Supporting Established Facts:\n");
  if (recommendation.evidence.length === 0) {
    io.write("- None\n");
  } else {
    recommendation.evidence.forEach((fact) => io.write(`- ${fact.text}\n`));
  }
};

const finishNarratorLikelihoodRecommendation = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
  presentation?: PresentationRuntime,
): Promise<ApplicationView> => {
  const recommendation = app.view().state.pendingNarratorRecommendation;
  if (recommendation === null) return app.view();
  presentNarratorLikelihoodRecommendation(io, recommendation);
  const likelihood = await readLikelihood(io);
  const answered = app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood,
  });
  io.write(`\n${answered.message}\n`);
  if (answered.status === "accepted") {
    const resolution = answered.state.lastOracleResolution;
    if (resolution !== null) {
      io.write(`Confirmed Likelihood: ${resolution.trace.confirmedLikelihood}\n`);
      io.write(`Rule: ${resolution.trace.rule.id}@${resolution.trace.rule.version}\n`);
      io.write(`Percentile roll: ${resolution.trace.result.roll}\n`);
      io.write(`Oracle answer: ${resolution.trace.result.answer}\n`);
      if (resolution.trace.result.exceptionalConsequence !== null) {
        io.write(
          `Exceptional Consequence (${resolution.trace.result.exceptionalConsequence.kind}): ${resolution.trace.result.exceptionalConsequence.establishedFact.text}\n`,
        );
      }
      io.write(`Established Fact: ${resolution.establishedFact.text}\n`);
    }
    await presentCommittedOutcome(io, presentation, answered);
  }
  return app.view();
};

const finishPendingChoice = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
  presentation?: PresentationRuntime,
): Promise<ApplicationView> => {
  const pendingChoice = app.view().state.pendingChoice;
  if (pendingChoice === null) return app.view();
  const roll = pendingChoice.roll;
  io.write(`Rule: ${roll.rule.id}@${roll.rule.version}\n`);
  io.write(`Random inputs: ${roll.random.inputs.join(", ")}\n`);
  io.write(
    `Modifiers: ${roll.modifiers.map((modifier) => `${modifier.source} +${modifier.value}`).join(", ")}\n`,
  );
  io.write(
    `Roll: ${roll.result.diceTotal} + ${roll.modifiers[0].value} = ${roll.result.total}\n`,
  );
  while (true) {
    const canSpend = pendingChoice.availableChoices.includes("spend-resolve");
    const resolveChoice = (
      await io.read(
        canSpend
          ? "Spend 1 Resolve (s) or decline (d): "
          : "No Resolve is available; decline (d): ",
      )
    )
      .trim()
      .toLowerCase();
    if (resolveChoice !== "d" && (resolveChoice !== "s" || !canSpend)) {
      io.write(canSpend ? "Choose s or d.\n" : "Choose d.\n");
      continue;
    }
    const resolved = app.submit({
      type: "resolve-pending-check",
      pendingChoiceId: pendingChoice.id,
      choice: resolveChoice === "s" ? "spend-resolve" : "decline",
    });
    io.write(`\n${resolved.message}\n`);
    if (resolved.status === "accepted") {
      await presentCommittedOutcome(io, presentation, resolved);
    }
    return app.view();
  }
};

const finishCheckProposal = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
  presentation?: PresentationRuntime,
): Promise<ApplicationView> => {
  while (true) {
    const proposal = app.view().state.pendingCheckProposal;
    if (proposal === null) return app.view();
    presentCheckProposal(io, proposal);
    const choice = (
      await io.read(
        "Confirm (c), correct goal (g), correct Trait (t), revise action (r), or withdraw (w): ",
      )
    )
      .trim()
      .toLowerCase();

    if (choice === "c") {
      const revealed = app.submit({
        type: "confirm-check-proposal",
        proposalId: proposal.id,
      });
      io.write(`\n${revealed.message}\n`);
      if (revealed.status === "accepted") {
        return finishPendingChoice(app, io, presentation);
      }
      return app.view();
    }

    if (choice === "g") {
      const goal = await io.read("Correct intended goal: ");
      const corrected = app.submit({
        type: "correct-check-proposal",
        proposalId: proposal.id,
        goal,
        trait: proposal.trait,
      });
      io.write(`\n${corrected.message}\n`);
      continue;
    }

    if (choice === "t") {
      const trait = await readTrait(io);
      const corrected = app.submit({
        type: "correct-check-proposal",
        proposalId: proposal.id,
        goal: proposal.goal,
        trait,
      });
      io.write(`\n${corrected.message}\n`);
      continue;
    }

    if (choice === "r") {
      const actionId = (
        await io.read("Revised action id: ")
      ).trim();
      const revised = app.submit({
        type: "revise-check-action",
        proposalId: proposal.id,
        actionId,
      });
      io.write(`\n${revised.message}\n`);
      continue;
    }

    if (choice === "w") {
      const withdrawn = app.submit({
        type: "withdraw-check-proposal",
        proposalId: proposal.id,
      });
      io.write(`\n${withdrawn.message}\n`);
      return app.view();
    }

    io.write("Choose c, g, t, r, or w.\n");
  }
};

const continueAdventure = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
  view: ApplicationView,
  enabled: boolean,
  presentation?: PresentationRuntime,
): Promise<ApplicationView> =>
  enabled &&
  view.state.adventureEnding === null &&
  view.availableActions.length > 0
    ? chooseAvailableAction(app, io, view, true, presentation)
    : view;

const chooseAvailableAction = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
  view: ApplicationView,
  runToAdventureEnd = false,
  presentation?: PresentationRuntime,
): Promise<ApplicationView> => {
  const confrontation = view.state.confrontation;
  if (confrontation?.status === "active") {
    io.write("Confrontation\n");
    io.write(
      `Resistance Clock: ${confrontation.resistanceClock.current}/${confrontation.resistanceClock.capacity} — filling it: ${confrontation.resistanceClock.fillingConsequence.text}\n`,
    );
    io.write(
      `Danger Clock: ${confrontation.dangerClock.current}/${confrontation.dangerClock.capacity} — filling it: ${confrontation.dangerClock.fillingConsequence.text}\n`,
    );
    io.write(
      `Zero Health: ${confrontation.healthZeroConsequence.text}\n`,
    );
  }
  view.availableActions.forEach((action, index) => {
    io.write(`${index + 1}. ${action.label} [${action.kind}]\n`);
  });
  if (view.availableActions.length === 0) return app.view();

  const choice = await io.read("\nChoose an action: ");
  const selectedAction = view.availableActions[Number(choice) - 1];
  if (selectedAction === undefined) {
    io.write("That action is not available in the current Scene.\n");
    return app.view();
  }

  if (
    selectedAction.kind === "Timeline Branch" ||
    selectedAction.kind === "Timeline Selection"
  ) {
    if (selectedAction.kind === "Timeline Branch") {
      io.write("\nAccepted events:\n");
      app.view().timeline?.acceptedEvents.forEach((event) => {
        io.write(`${event.position}. ${event.type}\n`);
      });
    }
    const completed = app.submit(
      selectedAction.kind === "Timeline Branch"
        ? {
            type: "branch-timeline",
            eventPosition: Number(
              await io.read("Accepted event position to branch from: "),
            ),
          }
        : {
            type: "select-timeline",
            timelineId: selectedAction.timelineId,
          },
    );
    io.write(`\n${completed.message}\n\n`);
    return continueAdventure(
      app,
      io,
      app.view(),
      runToAdventureEnd && completed.status === "accepted",
      presentation,
    );
  }

  if (
    selectedAction.kind === "Recovery" ||
    selectedAction.kind === "Scene Transition"
  ) {
    const completed = app.submit(
      selectedAction.kind === "Recovery"
        ? { type: "use-field-kit", resource: selectedAction.resource }
        : { type: "transition-scene", scene: selectedAction.scene },
    );
    io.write(`\n${completed.message}\n\n`);
    if (completed.status === "accepted") {
      await presentCommittedOutcome(io, presentation, completed);
    }
    const nextView = app.view();
    return continueAdventure(
      app,
      io,
      nextView,
      runToAdventureEnd && completed.status === "accepted",
      presentation,
    );
  }

  const completed = app.submit({
    type: "choose-action",
    actionId: selectedAction.id,
  });
  io.write(`\n${completed.message}\n\n`);
  if (completed.state.pendingCheckProposal !== null) {
    const finished = await finishCheckProposal(app, io, presentation);
    return continueAdventure(
      app,
      io,
      finished,
      runToAdventureEnd,
      presentation,
    );
  }
  if (completed.state.pendingNarratorRecommendation !== null) {
    const finished = await finishNarratorLikelihoodRecommendation(
      app,
      io,
      presentation,
    );
    return continueAdventure(
      app,
      io,
      finished,
      runToAdventureEnd,
      presentation,
    );
  }
  if (completed.status === "accepted") {
    await presentCommittedOutcome(io, presentation, completed);
  }
  const nextView = app.view();
  if (
    runToAdventureEnd &&
    nextView.state.adventureEnding === null &&
    nextView.availableActions.length > 0
  ) {
    io.write("\n");
    return continueAdventure(app, io, nextView, true, presentation);
  }
  if (
    selectedAction.kind === "Free Action" &&
    nextView.availableActions.length > 0
  ) {
    const continueChoice = (
      await io.read("Continue in the current Scene (c) or stop (s): ")
    )
      .trim()
      .toLowerCase();
    if (continueChoice === "c") {
      io.write("\n");
      return chooseAvailableAction(app, io, nextView, false, presentation);
    }
  }
  return app.view();
};

export const runStructuredPlay = async ({
  io,
  eventStore,
  timelineStore,
  randomSource,
  applicationOptions = {},
  runToAdventureEnd = false,
  narrator,
  modelGateway,
  modelCallStore,
  evidenceBudget,
  narrationTimeoutMs = 5_000,
}: StructuredPlayRunnerOptions): Promise<ApplicationView> => {
  const selectedEventStore = eventStore ?? createInMemoryEventStore();
  const app = createStructuredPlayApplication(
    timelineStore !== undefined
      ? { ...applicationOptions, timelineStore }
      : randomSource === undefined
        ? { ...applicationOptions, eventStore: selectedEventStore }
        : {
            ...applicationOptions,
            eventStore: selectedEventStore,
            randomSource,
          },
  );
  const presentation =
    modelGateway !== undefined
      ? {
          kind: "model-gateway" as const,
          gateway: modelGateway,
          modelCallStore:
            modelCallStore ?? createInMemoryModelCallRecordStore(),
          readAcceptedEvents: () =>
            timelineStore === undefined
              ? selectedEventStore.readAll()
              : timelineStore.readTimeline(
                  timelineStore.view().activeTimelineId,
                ),
          ...(evidenceBudget === undefined ? {} : { evidenceBudget }),
          timeoutMs: narrationTimeoutMs,
        }
      : narrator === undefined
        ? undefined
        : {
            kind: "legacy" as const,
            narrator,
            timeoutMs: narrationTimeoutMs,
          };
  io.write("AI TTRPG — Structured Play\n\n");

  const current = app.view();
  if (current.state.adventureEnding !== null) {
    io.write(
      `Adventure ended ${current.state.adventureEnding.kind}: ${current.state.adventureEnding.text}\n`,
    );
    return current.availableActions.some(
      (action) =>
        action.kind === "Timeline Branch" ||
        action.kind === "Timeline Selection",
    )
      ? chooseAvailableAction(app, io, current, runToAdventureEnd, presentation)
      : current;
  }
  if (current.state.pendingChoice !== null) {
    io.write("Resuming Pending Choice.\n");
    const finished = await finishPendingChoice(app, io, presentation);
    return continueAdventure(
      app,
      io,
      finished,
      runToAdventureEnd,
      presentation,
    );
  }
  if (current.state.pendingCheckProposal !== null) {
    io.write("Resuming Check Proposal.\n");
    const finished = await finishCheckProposal(app, io, presentation);
    return continueAdventure(
      app,
      io,
      finished,
      runToAdventureEnd,
      presentation,
    );
  }
  if (current.state.pendingNarratorRecommendation !== null) {
    io.write("Resuming Narrator Likelihood recommendation.\n");
    const finished = await finishNarratorLikelihoodRecommendation(
      app,
      io,
      presentation,
    );
    return continueAdventure(
      app,
      io,
      finished,
      runToAdventureEnd,
      presentation,
    );
  }
  if (
    current.state.playerCharacter !== null &&
    current.state.activeScene !== null
  ) {
    io.write("Resuming Adventure.\n\n");
    return chooseAvailableAction(
      app,
      io,
      current,
      runToAdventureEnd,
      presentation,
    );
  }

  await completePlayerCharacterSetup(app, io);

  const started = app.submit({ type: "begin-adventure" });
  io.write(`${started.message}\n\n`);
  return chooseAvailableAction(app, io, started, runToAdventureEnd, presentation);
};
