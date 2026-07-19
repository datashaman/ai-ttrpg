import type {
  ApplicationView,
  StructuredPlayApplication,
} from "./structured-play.js";
import { readTraitRating, type TextPlayIO } from "./text-play-input.js";

export const completePlayerCharacterSetup = async (
  app: StructuredPlayApplication,
  io: TextPlayIO,
): Promise<ApplicationView> => {
  io.write("Create your Player Character.\n");
  io.write("Choose a name, pronouns, and Motivation.\n");
  io.write("Assign 0, 1, and 2 exactly once among Might, Wits, and Presence.\n\n");

  while (app.view().state.playerCharacter === null) {
    const configured = app.submit({
      type: "configure-player-character",
      name: await io.read("Player Character name: "),
      pronouns: await io.read("Pronouns: "),
      motivation: await io.read("Motivation: "),
      traits: {
        Might: await readTraitRating(io, "Might"),
        Wits: await readTraitRating(io, "Wits"),
        Presence: await readTraitRating(io, "Presence"),
      },
    });
    io.write(`\n${configured.message}\n`);
    if (configured.status === "rejected") {
      io.write("Please try setup again.\n\n");
    }
  }

  return app.view();
};
