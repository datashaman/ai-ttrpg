import { readFileSync, writeFileSync } from "node:fs";

import type {
  AdventureRepository,
  OpenAdventure,
} from "./adventure-repository.js";
import {
  createInMemoryModelCallRecordStore,
  type ModelGateway,
} from "./model-gateway.js";
import {
  runNaturalLanguagePlay,
  writeStructuredPlayChoices,
} from "./natural-language-play.js";
import { createStructuredPlayApplication } from "./structured-play.js";
import {
  runStructuredPlay,
  type StructuredPlayIO,
} from "./structured-play-runner.js";

export interface AdventureCliOptions {
  readonly runToAdventureEnd?: boolean;
  readonly modelGateway?: ModelGateway;
}

const usage =
  "Usage: npm start -- [--mode <structured|natural-language>] <create <name>|list|open <id>|export <id> <path>|import <path>>\n";

type InputMode = "structured" | "natural-language";

interface InputModeSelection {
  readonly mode: InputMode;
  readonly structuredChoice?: string;
}

const readInputMode = async (
  io: StructuredPlayIO,
  availableActionCount: number,
): Promise<InputModeSelection | null> => {
  while (true) {
    const choice = (
      await io.read(
        "Input mode: Structured Play (s), Natural Language Play (n), a Structured Play choice number, or stop (x): ",
      )
    )
      .trim()
      .toLowerCase();
    if (choice === "s") return { mode: "structured" };
    if (choice === "n") return { mode: "natural-language" };
    if (choice === "x") return null;
    const actionNumber = Number(choice);
    if (
      Number.isInteger(actionNumber) &&
      actionNumber >= 1 &&
      actionNumber <= availableActionCount
    ) {
      return { mode: "structured", structuredChoice: choice };
    }
    io.write(
      "Choose Structured Play (s), Natural Language Play (n), an available action number, or stop (x).\n",
    );
  }
};

const runModeSession = async (
  adventure: OpenAdventure,
  io: StructuredPlayIO,
  initialMode: InputMode,
  modelGateway: ModelGateway | undefined,
): Promise<void> => {
  let mode = initialMode;
  let structuredChoice: string | undefined;
  const modelCallStore = createInMemoryModelCallRecordStore();
  while (true) {
    if (mode === "natural-language") {
      if (modelGateway === undefined) {
        io.write(
          "Natural Language Play is unavailable because no model provider is configured. Structured Play remains available.\n",
        );
        writeStructuredPlayChoices(
          io,
          createStructuredPlayApplication({
            timelineStore: adventure.timelineStore,
          }).view(),
        );
      } else {
        await runNaturalLanguagePlay({
          io,
          modelGateway,
          modelCallStore,
          timelineStore: adventure.timelineStore,
        });
      }
    } else {
      let choicePending = structuredChoice !== undefined;
      const structuredIO: StructuredPlayIO = {
        read: (prompt) => {
          if (choicePending && prompt === "\nChoose an action: ") {
            choicePending = false;
            return Promise.resolve(structuredChoice!);
          }
          return io.read(prompt);
        },
        write: (text) => io.write(text),
      };
      await runStructuredPlay({
        io: structuredIO,
        timelineStore: adventure.timelineStore,
      });
      structuredChoice = undefined;
    }

    const view = createStructuredPlayApplication({
      timelineStore: adventure.timelineStore,
    }).view();
    if (view.state.adventureEnding !== null) return;
    const selectedMode = await readInputMode(io, view.availableActions.length);
    if (selectedMode === null) return;
    mode = selectedMode.mode;
    structuredChoice = selectedMode.structuredChoice;
    io.write("\n");
  }
};

const playAdventure = async (
  adventure: OpenAdventure,
  io: StructuredPlayIO,
  runToAdventureEnd: boolean,
  explicitMode: InputMode | null,
  modelGateway: ModelGateway | undefined,
): Promise<void> => {
  try {
    if (explicitMode !== null) {
      await runModeSession(adventure, io, explicitMode, modelGateway);
      return;
    }
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
  {
    runToAdventureEnd = true,
    modelGateway,
  }: AdventureCliOptions = {},
): Promise<void> => {
  const explicitMode: InputMode | null =
    args[0] === "--mode" &&
    (args[1] === "structured" || args[1] === "natural-language")
      ? args[1]
      : null;
  if (args[0] === "--mode" && explicitMode === null) {
    io.write(usage);
    return;
  }
  const runtimeArgs = explicitMode === null ? args : args.slice(2);
  const [command, ...values] = runtimeArgs;

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
    await playAdventure(
      adventure,
      io,
      runToAdventureEnd,
      explicitMode,
      modelGateway,
    );
    return;
  }

  if (command === "open" && values.length === 1) {
    const adventure = repository.open(values[0]!);
    io.write(`Opened Adventure "${adventure.name}" (${adventure.id}).\n\n`);
    await playAdventure(
      adventure,
      io,
      runToAdventureEnd,
      explicitMode,
      modelGateway,
    );
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
