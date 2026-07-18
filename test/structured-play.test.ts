import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
} from "../src/structured-play.js";

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

test("configured Player enters the arrival Scene with an authored Free Action", () => {
  const app = createStructuredPlayApplication();
  app.submit({
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

  const result = app.submit({ type: "begin-adventure" });

  assert.equal(result.status, "accepted");
  assert.equal(result.state.activeScene, "arrival");
  assert.deepEqual(result.availableActions, [
    {
      id: "survey-manor",
      label: "Survey the manor grounds",
      kind: "Free Action",
    },
  ]);
  assert.deepEqual(
    result.appendedEvents.map((event) => event.type),
    ["SceneStarted"],
  );
});

test("Player completes the survey-manor Free Action and sees projected state", () => {
  const app = createStructuredPlayApplication();
  app.submit({
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
  app.submit({ type: "begin-adventure" });

  const result = app.submit({
    type: "choose-action",
    actionId: "survey-manor",
  });

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.state.establishedFacts, [
    "Fresh footprints lead from the manor gate toward a dark side entrance.",
  ]);
  assert.deepEqual(result.availableActions, []);
  assert.deepEqual(
    result.appendedEvents.map((event) => event.type),
    ["FreeActionCompleted"],
  );
});

test("unavailable Free Action is rejected without appending events", () => {
  const app = createStructuredPlayApplication();
  app.submit({
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

  const result = app.submit({
    type: "choose-action",
    actionId: "survey-manor",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.code, "action-unavailable");
  assert.deepEqual(result.appendedEvents, []);
  assert.equal(result.state.activeScene, null);
  assert.deepEqual(result.state.establishedFacts, []);
});

test("application reconstructs Player-visible state from a replaceable event store", () => {
  const eventStore = createInMemoryEventStore();
  const firstSession = createStructuredPlayApplication({ eventStore });
  firstSession.submit({
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
  firstSession.submit({ type: "begin-adventure" });
  firstSession.submit({ type: "choose-action", actionId: "survey-manor" });

  const resumedSession = createStructuredPlayApplication({ eventStore });
  const view = resumedSession.view();

  assert.equal(view.state.playerCharacter?.name, "Mara Vey");
  assert.equal(view.state.activeScene, "arrival");
  assert.deepEqual(view.state.establishedFacts, [
    "Fresh footprints lead from the manor gate toward a dark side entrance.",
  ]);
  assert.deepEqual(view.availableActions, []);
});
