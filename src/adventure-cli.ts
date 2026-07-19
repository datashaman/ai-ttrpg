import type {
  AdventureRepository,
  OpenAdventure,
} from "./adventure-repository.js";
import {
  runStructuredPlay,
  type StructuredPlayIO,
} from "./structured-play-runner.js";

export interface AdventureCliOptions {
  readonly runToAdventureEnd?: boolean;
}

const usage = "Usage: npm start -- <create <name>|list|open <id>>\n";

const playAdventure = async (
  adventure: OpenAdventure,
  io: StructuredPlayIO,
  runToAdventureEnd: boolean,
): Promise<void> => {
  try {
    await runStructuredPlay({
      io,
      eventStore: adventure.eventStore,
      randomSource: adventure.randomSource,
      runToAdventureEnd,
    });
  } finally {
    adventure.close();
  }
};

export const runAdventureCli = async (
  args: readonly string[],
  io: StructuredPlayIO,
  repository: AdventureRepository,
  { runToAdventureEnd = true }: AdventureCliOptions = {},
): Promise<void> => {
  const [command, ...values] = args;

  if (command === "list" && values.length === 0) {
    const adventures = repository.list();
    if (adventures.length === 0) {
      io.write("No durable Adventures.\n");
      return;
    }
    io.write("Durable Adventures\n");
    adventures.forEach((adventure) => {
      io.write(
        `${adventure.id}\t${adventure.name}\t${adventure.eventCount} events\n`,
      );
    });
    return;
  }

  if (command === "create") {
    const name = values.join(" ").trim();
    if (name.length === 0) {
      io.write(usage);
      return;
    }
    const adventure = repository.create(name);
    io.write(`Created Adventure "${adventure.name}" (${adventure.id}).\n\n`);
    await playAdventure(adventure, io, runToAdventureEnd);
    return;
  }

  if (command === "open" && values.length === 1) {
    const adventure = repository.open(values[0]!);
    io.write(`Opened Adventure "${adventure.name}" (${adventure.id}).\n\n`);
    await playAdventure(adventure, io, runToAdventureEnd);
    return;
  }

  io.write(usage);
};
