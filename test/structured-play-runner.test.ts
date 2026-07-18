import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryEventStore } from "../src/structured-play.js";
import {
  runStructuredPlay,
  type StructuredPlayIO,
} from "../src/structured-play-runner.js";

const scriptedIO = (answers: readonly string[]) => {
  const remainingAnswers = [...answers];
  const output: string[] = [];
  const io: StructuredPlayIO = {
    read: async (prompt) => {
      output.push(prompt);
      const answer = remainingAnswers.shift();
      if (answer === undefined) {
        throw new Error("Scripted input exhausted.");
      }
      return answer;
    },
    write: (text) => output.push(text),
  };
  return { io, output };
};

test("scripted Structured Play configures, starts, and completes a Free Action", async () => {
  const eventStore = createInMemoryEventStore();
  const { io, output } = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "1",
  ]);

  const view = await runStructuredPlay({ io, eventStore });

  assert.match(output.join(""), /Survey the manor grounds \[Free Action\]/);
  assert.match(output.join(""), /Fresh footprints lead from the manor gate/);
  assert.deepEqual(
    eventStore.readAll().map((event) => event.type),
    ["PlayerCharacterConfigured", "SceneStarted", "FreeActionCompleted"],
  );
  assert.equal(view.state.activeScene, "arrival");
  assert.deepEqual(view.state.establishedFacts, [
    {
      id: "fresh-footprints",
      text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
    },
  ]);
});

test("invalid rating is explained and reprompted without an invalid setup event", async () => {
  const eventStore = createInMemoryEventStore();
  const { io, output } = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "3",
    "0",
    "1",
    "2",
    "1",
  ]);

  await runStructuredPlay({ io, eventStore });

  assert.match(output.join(""), /Enter 0, 1, or 2\./);
  assert.equal(
    eventStore
      .readAll()
      .filter((event) => event.type === "PlayerCharacterConfigured").length,
    1,
  );
});
