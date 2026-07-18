import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

import {
  createStructuredPlayApplication,
  type TraitRatings,
} from "./structured-play.js";

const terminal = createInterface({ input: stdin, output: stdout });
const answers = terminal[Symbol.asyncIterator]();
const app = createStructuredPlayApplication();

const ask = async (prompt: string): Promise<string> => {
  stdout.write(prompt);
  const answer = await answers.next();
  if (answer.done) {
    throw new Error("Structured Play input ended before setup was complete.");
  }
  return answer.value;
};

const askRating = async (trait: keyof TraitRatings): Promise<0 | 1 | 2> => {
  const answer = await ask(`${trait} rating (0, 1, or 2): `);
  const rating = Number(answer);
  return rating === 0 || rating === 1 || rating === 2 ? rating : 0;
};

try {
  stdout.write("AI TTRPG — Structured Play\n\n");
  const name = await ask("Player Character name: ");
  const pronouns = await ask("Pronouns: ");
  const motivation = await ask("Motivation: ");
  const traits: TraitRatings = {
    Might: await askRating("Might"),
    Wits: await askRating("Wits"),
    Presence: await askRating("Presence"),
  };

  const configured = app.submit({
    type: "configure-player-character",
    name,
    pronouns,
    motivation,
    traits,
  });
  stdout.write(`\n${configured.message}\n`);
  if (configured.status === "rejected") {
    process.exitCode = 1;
  } else {
    const started = app.submit({ type: "begin-adventure" });
    stdout.write(`${started.message}\n\n`);

    started.availableActions.forEach((action, index) => {
      stdout.write(`${index + 1}. ${action.label} [${action.kind}]\n`);
    });
    const choice = await ask("\nChoose an action: ");
    const selectedAction = started.availableActions[Number(choice) - 1];

    if (selectedAction === undefined) {
      stdout.write("That action is not available in the current Scene.\n");
      process.exitCode = 1;
    } else {
      const completed = app.submit({
        type: "choose-action",
        actionId: selectedAction.id,
      });
      stdout.write(`\n${completed.message}\n\n`);
      stdout.write("Current state:\n");
      stdout.write(`${JSON.stringify(completed.state, null, 2)}\n`);
    }
  }
} finally {
  terminal.close();
}
