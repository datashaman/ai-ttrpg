import assert from "node:assert/strict";
import test from "node:test";

import { createStructuredPlayApplication } from "../src/structured-play.js";

test("Player can configure the pregenerated Player Character", () => {
  const app = createStructuredPlayApplication();

  const result = app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: {
      Might: 0,
      Wits: 2,
      Presence: 1,
    },
  });

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.state.playerCharacter, {
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: {
      Might: 0,
      Wits: 2,
      Presence: 1,
    },
    health: 3,
    resolve: 3,
    inventory: ["Lantern", "Lockpick Set", "Short Blade", "Field Kit"],
  });
  assert.deepEqual(
    result.appendedEvents.map((event) => event.type),
    ["PlayerCharacterConfigured"],
  );
});

test("invalid Trait assignment is rejected without appending events", () => {
  const app = createStructuredPlayApplication();

  const result = app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: {
      Might: 2,
      Wits: 2,
      Presence: 0,
    },
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(result.appendedEvents, []);
  assert.equal(result.state.playerCharacter, null);
});

test("blank Player Character identity is rejected without appending events", () => {
  const app = createStructuredPlayApplication();

  const result = app.submit({
    type: "configure-player-character",
    name: "  ",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: {
      Might: 0,
      Wits: 2,
      Presence: 1,
    },
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(result.appendedEvents, []);
  assert.equal(result.state.playerCharacter, null);
});
