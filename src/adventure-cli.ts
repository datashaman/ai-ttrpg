import { readFileSync, writeFileSync } from "node:fs";

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

const usage =
  "Usage: npm start -- <create <name>|list|open <id>|export <id> <path>|import <path>>\n";

const playAdventure = async (
  adventure: OpenAdventure,
  io: StructuredPlayIO,
  runToAdventureEnd: boolean,
): Promise<void> => {
  try {
    await runStructuredPlay({
      io,
      timelineStore: adventure.timelineStore,
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

  if (command === "export" && values.length === 2) {
    const [id, path] = values as [string, string];
    const archive = repository.exportArchive(id);
    writeFileSync(path, archive, "utf8");
    io.write(`Exported Adventure "${id}" to ${path}.\n`);
    return;
  }

  if (command === "import" && values.length === 1) {
    const path = values[0]!;
    const adventure = repository.importArchive(readFileSync(path, "utf8"));
    io.write(`Imported Adventure "${adventure.name}" (${adventure.id}).\n`);
    adventure.close();
    return;
  }

  io.write(usage);
};
