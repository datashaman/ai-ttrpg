import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type ConfigurePlayerCharacter,
  type StructuredPlayApplication,
} from "../src/structured-play.js";

type ConfigurationOverrides = Partial<
  Omit<ConfigurePlayerCharacter, "type">
>;

const configurePlayerCharacter = (
  app: StructuredPlayApplication,
  overrides: ConfigurationOverrides = {},
) =>
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
    ...overrides,
  });

test("Player can configure the pregenerated Player Character", () => {
  const app = createStructuredPlayApplication();

  const result = configurePlayerCharacter(app);

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

test("accepted command appends a canonical event envelope", () => {
  const app = createStructuredPlayApplication();

  const result = configurePlayerCharacter(app);

  const [event] = result.appendedEvents;
  assert.ok(event);
  assert.match(event.id, /^[0-9a-f-]{36}$/);
  assert.equal(event.streamId, "adventure");
  assert.equal(event.sequence, 1);
  assert.equal(event.schemaVersion, 1);
  assert.ok(Number.isFinite(Date.parse(event.timestamp)));
  assert.equal(event.origin, "structured-play");
  assert.notEqual(event.id, event.causationId);
  assert.equal(event.correlationId, event.causationId);
});

test("invalid Trait assignment is rejected without appending events", () => {
  const app = createStructuredPlayApplication();

  const result = configurePlayerCharacter(app, {
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

  const result = configurePlayerCharacter(app, { name: "  " });

  assert.equal(result.status, "rejected");
  assert.deepEqual(result.appendedEvents, []);
  assert.equal(result.state.playerCharacter, null);
});

test("Player Character configuration cannot change after setup", () => {
  const app = createStructuredPlayApplication();
  configurePlayerCharacter(app);

  const result = configurePlayerCharacter(app, {
    traits: {
      Might: 2,
      Wits: 0,
      Presence: 1,
    },
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.code, "player-character-already-configured");
  assert.deepEqual(result.appendedEvents, []);
  assert.deepEqual(result.state.playerCharacter?.traits, {
    Might: 0,
    Wits: 2,
    Presence: 1,
  });
});

test("configured Player Character enters the arrival Scene with an authored Free Action", () => {
  const app = createStructuredPlayApplication();
  configurePlayerCharacter(app);

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

test("Player Character completes the survey-manor Free Action and sees projected state", () => {
  const app = createStructuredPlayApplication();
  configurePlayerCharacter(app);
  app.submit({ type: "begin-adventure" });

  const result = app.submit({
    type: "choose-action",
    actionId: "survey-manor",
  });

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.state.establishedFacts, [
    {
      id: "fresh-footprints",
      text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
    },
  ]);
  assert.deepEqual(result.availableActions, []);
  assert.deepEqual(
    result.appendedEvents.map((event) => event.type),
    ["FreeActionCompleted"],
  );
});

test("unavailable Free Action is rejected without appending events", () => {
  const app = createStructuredPlayApplication();
  configurePlayerCharacter(app);

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
  configurePlayerCharacter(firstSession);
  firstSession.submit({ type: "begin-adventure" });
  firstSession.submit({ type: "choose-action", actionId: "survey-manor" });

  const resumedSession = createStructuredPlayApplication({ eventStore });
  const view = resumedSession.view();

  assert.equal(view.state.playerCharacter?.name, "Mara Vey");
  assert.equal(view.state.activeScene, "arrival");
  assert.deepEqual(view.state.establishedFacts, [
    {
      id: "fresh-footprints",
      text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
    },
  ]);
  assert.deepEqual(view.availableActions, []);
});
