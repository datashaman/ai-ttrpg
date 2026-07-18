import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type ApplicationView,
  type CheckProposal,
  type EventStore,
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
      const resolved = app.submit({
        type: "confirm-check-proposal",
        proposalId: proposal.id,
      });
      io.write(`\n${resolved.message}\n`);
      if (resolved.status === "accepted") {
        const trace = resolved.state.lastCheckResolution?.trace;
        if (trace !== undefined) {
          io.write(`Rule: ${trace.rule.id}@${trace.rule.version}\n`);
          io.write(`Random inputs: ${trace.random.inputs.join(", ")}\n`);
          io.write(
            `Modifiers: ${trace.modifiers.map((modifier) => `${modifier.source} ${modifier.value >= 0 ? "+" : ""}${modifier.value}`).join(", ")}\n`,
          );
          io.write(
            `Result: ${trace.result.diceTotal} + ${trace.modifiers[0].value} = ${trace.result.total} (${trace.result.outcome})\n`,
          );
        }
        io.write("Committed events:\n");
        io.write(`${JSON.stringify(resolved.appendedEvents, null, 2)}\n`);
        io.write("Resulting state:\n");
        io.write(`${JSON.stringify(resolved.state, null, 2)}\n`);
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

export const runStructuredPlay = async ({
  io,
  eventStore = createInMemoryEventStore(),
  randomSource,
}: StructuredPlayRunnerOptions): Promise<ApplicationView> => {
  const app = createStructuredPlayApplication(
    randomSource === undefined ? { eventStore } : { eventStore, randomSource },
  );
  io.write("AI TTRPG — Structured Play\n\n");

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
  started.availableActions.forEach((action, index) => {
    io.write(`${index + 1}. ${action.label} [${action.kind}]\n`);
  });

  const choice = await io.read("\nChoose an action: ");
  const selectedAction = started.availableActions[Number(choice) - 1];
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
  io.write("Current state:\n");
  io.write(`${JSON.stringify(completed.state, null, 2)}\n`);
  return app.view();
};
