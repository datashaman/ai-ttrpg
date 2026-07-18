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
  type Trait,
  type TraitRatings,
} from "./structured-play.js";

export interface StructuredPlayIO {
  read(prompt: string): Promise<string>;
  write(text: string): void;
}

export interface StructuredPlayRunnerOptions {
  readonly io: StructuredPlayIO;
  readonly eventStore?: EventStore;
  readonly randomSource?: RandomSource;
}

const readRating = async (
  io: StructuredPlayIO,
  trait: keyof TraitRatings,
): Promise<0 | 1 | 2> => {
  while (true) {
    const answer = (await io.read(`${trait} rating (0, 1, or 2): `)).trim();
    if (answer === "0" || answer === "1" || answer === "2") {
      return Number(answer) as 0 | 1 | 2;
    }
    io.write("Enter 0, 1, or 2.\n");
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
  newlyAppendedEvents: readonly CanonicalEvent[] = [],
): Promise<ApplicationView> => {
  const recommendation = app.view().state.pendingNarratorRecommendation;
  if (recommendation === null) return app.view();
  presentNarratorLikelihoodRecommendation(io, recommendation);
  if (newlyAppendedEvents.length > 0) {
    io.write("Committed events:\n");
    io.write(`${JSON.stringify(newlyAppendedEvents, null, 2)}\n`);
  }
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
    io.write("Committed events:\n");
    io.write(`${JSON.stringify(answered.appendedEvents, null, 2)}\n`);
    io.write("Resulting state:\n");
    io.write(`${JSON.stringify(answered.state, null, 2)}\n`);
  }
  return app.view();
};

const finishPendingChoice = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
  newlyAppendedEvents: readonly CanonicalEvent[] = [],
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
  if (newlyAppendedEvents.length > 0) {
    io.write("Committed events:\n");
    io.write(`${JSON.stringify(newlyAppendedEvents, null, 2)}\n`);
  }

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
      io.write("Committed events:\n");
      io.write(`${JSON.stringify(resolved.appendedEvents, null, 2)}\n`);
      io.write("Resulting state:\n");
      io.write(`${JSON.stringify(resolved.state, null, 2)}\n`);
    }
    return app.view();
  }
};

const finishCheckProposal = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
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
        return finishPendingChoice(app, io, revealed.appendedEvents);
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
        await io.read("Revised action id (force-side-door or pick-side-door-lock): ")
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

const chooseAvailableAction = async (
  app: StructuredPlayApplication,
  io: StructuredPlayIO,
  view: ApplicationView,
): Promise<ApplicationView> => {
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

  const completed = app.submit({
    type: "choose-action",
    actionId: selectedAction.id,
  });
  io.write(`\n${completed.message}\n\n`);
  if (completed.state.pendingCheckProposal !== null) {
    return finishCheckProposal(app, io);
  }
  if (completed.state.pendingNarratorRecommendation !== null) {
    return finishNarratorLikelihoodRecommendation(app, io, completed.appendedEvents);
  }
  io.write("Current state:\n");
  io.write(`${JSON.stringify(completed.state, null, 2)}\n`);
  const nextView = app.view();
  if (selectedAction.kind === "Free Action" && nextView.availableActions.length > 0) {
    const continueChoice = (
      await io.read("Continue in the current Scene (c) or stop (s): ")
    )
      .trim()
      .toLowerCase();
    if (continueChoice === "c") {
      io.write("\n");
      return chooseAvailableAction(app, io, nextView);
    }
  }
  return app.view();
};

export const runStructuredPlay = async ({
  io,
  eventStore = createInMemoryEventStore(),
  randomSource,
}: StructuredPlayRunnerOptions): Promise<ApplicationView> => {
  const app = createStructuredPlayApplication(
    randomSource === undefined ? { eventStore } : { eventStore, randomSource },
  );
  io.write("AI TTRPG — Structured Play\n\n");

  const current = app.view();
  if (current.state.pendingChoice !== null) {
    io.write("Resuming Pending Choice.\n");
    return finishPendingChoice(app, io);
  }
  if (current.state.pendingCheckProposal !== null) {
    io.write("Resuming Check Proposal.\n");
    return finishCheckProposal(app, io);
  }
  if (current.state.pendingNarratorRecommendation !== null) {
    io.write("Resuming Narrator Likelihood recommendation.\n");
    return finishNarratorLikelihoodRecommendation(app, io);
  }
  if (
    current.state.playerCharacter !== null &&
    current.state.activeScene !== null
  ) {
    io.write("Resuming Adventure.\n\n");
    return chooseAvailableAction(app, io, current);
  }

  const name = await io.read("Player Character name: ");
  const pronouns = await io.read("Pronouns: ");
  const motivation = await io.read("Motivation: ");
  const traits: TraitRatings = {
    Might: await readRating(io, "Might"),
    Wits: await readRating(io, "Wits"),
    Presence: await readRating(io, "Presence"),
  };

  const configured = app.submit({
    type: "configure-player-character",
    name,
    pronouns,
    motivation,
    traits,
  });
  io.write(`\n${configured.message}\n`);
  if (configured.status === "rejected") {
    return app.view();
  }

  const started = app.submit({ type: "begin-adventure" });
  io.write(`${started.message}\n\n`);
  return chooseAvailableAction(app, io, started);
};
