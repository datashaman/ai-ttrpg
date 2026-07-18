import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type ApplicationView,
  type EventStore,
  type TraitRatings,
} from "./structured-play.js";

export interface StructuredPlayIO {
  read(prompt: string): Promise<string>;
  write(text: string): void;
}

export interface StructuredPlayRunnerOptions {
  readonly io: StructuredPlayIO;
  readonly eventStore?: EventStore;
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

export const runStructuredPlay = async ({
  io,
  eventStore = createInMemoryEventStore(),
}: StructuredPlayRunnerOptions): Promise<ApplicationView> => {
  const app = createStructuredPlayApplication({ eventStore });
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
  io.write("Current state:\n");
  io.write(`${JSON.stringify(completed.state, null, 2)}\n`);
  return app.view();
};
