import type { Trait, TraitRatings } from "./structured-play.js";

export interface TextPlayIO {
  read(prompt: string): Promise<string>;
  write(text: string): void;
}

export const readTraitRating = async (
  io: TextPlayIO,
  trait: Trait,
): Promise<TraitRatings[Trait]> => {
  while (true) {
    const answer = (await io.read(`${trait} rating (0, 1, or 2): `)).trim();
    if (answer === "0" || answer === "1" || answer === "2") {
      return Number(answer) as TraitRatings[Trait];
    }
    io.write("Enter 0, 1, or 2.\n");
  }
};
