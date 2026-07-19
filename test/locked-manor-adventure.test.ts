import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type EventStore,
} from "../src/structured-play.js";
import { runStructuredPlay } from "../src/structured-play-runner.js";
import { scriptedIO } from "./support/scripted-io.js";

const actionNumber = (eventStore: EventStore, actionId: string): string => {
  const actions = createStructuredPlayApplication({ eventStore }).view()
    .availableActions;
  const index = actions.findIndex((action) => action.id === actionId);
  assert.notEqual(index, -1, `${actionId} should be available`);
  return String(index + 1);
};

const enterFromArrival = async (
  eventStore: EventStore,
  oracleSeed: number,
  expectedScene: "discovery" | "confrontation",
): Promise<void> => {
  const arrival = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "2",
    "1",
    "0",
    "1",
    "s",
  ]);
  await runStructuredPlay({ io: arrival.io, eventStore });
  await runStructuredPlay({
    io: scriptedIO([
      actionNumber(eventStore, "ask-someone-inside-manor"),
      "l",
    ]).io,
    eventStore,
    randomSource: createSeededRandomSource(oracleSeed),
  });
  await runStructuredPlay({
    io: scriptedIO([
      actionNumber(eventStore, "force-side-door"),
      "c",
      "d",
    ]).io,
    eventStore,
    randomSource: createSeededRandomSource(690),
  });
  assert.equal(
    createStructuredPlayApplication({ eventStore }).view().state.activeScene,
    expectedScene,
  );
};

const enterDiscovery = (eventStore: EventStore): Promise<void> =>
  enterFromArrival(eventStore, 1301, "discovery");

const enterConfrontationSkippingDiscovery = async (
  eventStore: EventStore,
): Promise<void> => enterFromArrival(eventStore, 1327, "confrontation");

const playConfrontationExchange = async (
  eventStore: EventStore,
  seed: number,
) =>
  runStructuredPlay({
    io: scriptedIO([
      actionNumber(eventStore, "drive-back-cult-guardian"),
      "c",
      "d",
    ]).io,
    eventStore,
    randomSource: createSeededRandomSource(seed),
  });

test("Structured Play can commit an unresolved withdrawal from the locked manor", async () => {
  const eventStore = createInMemoryEventStore();
  const arrival = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "1",
    "s",
  ]);
  await runStructuredPlay({ io: arrival.io, eventStore });

  const withdrawal = scriptedIO([
    actionNumber(eventStore, "withdraw-from-manor"),
  ]);
  const ended = await runStructuredPlay({ io: withdrawal.io, eventStore });

  assert.deepEqual(ended.state.adventureEnding, {
    id: "withdrawal-without-answers",
    kind: "unresolved",
    text: "Mara leaves the locked manor without learning what happened inside.",
  });
  assert.equal(ended.state.activeScene, null);
  assert.deepEqual(
    eventStore.readAll().slice(-2).map((event) => event.type),
    ["FreeActionCompleted", "AdventureEnded"],
  );
  assert.match(withdrawal.output.join(""), /unresolved/i);

  const resumed = createStructuredPlayApplication({ eventStore }).view();
  assert.deepEqual(resumed.state, ended.state);
  const completedSession = scriptedIO([]);
  const completedView = await runStructuredPlay({
    io: completedSession.io,
    eventStore,
  });
  assert.deepEqual(completedView.state.adventureEnding, ended.state.adventureEnding);
  assert.match(completedSession.output.join(""), /Adventure ended unresolved/i);
});

test("Structured Play can run a complete Adventure in one session", async () => {
  const eventStore = createInMemoryEventStore();
  const session = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "1",
    "6",
  ]);

  const ended = await runStructuredPlay({
    io: session.io,
    eventStore,
    runToAdventureEnd: true,
  });

  assert.equal(ended.state.adventureEnding?.kind, "unresolved");
  assert.match(session.output.join(""), /Adventure ends unresolved/i);
});

test("a committed Free Action can satisfy an automatic Scene exit", () => {
  const app = createStructuredPlayApplication({
    checkActions: [],
    oracleActions: [],
    freeActions: [
      {
        id: "find-servants-passage",
        label: "Find the servants' passage",
        kind: "Free Action",
        establishedFact: {
          id: "servants-passage-found",
          text: "The servants' passage into the manor is open.",
        },
        availableInScenes: ["arrival"],
        requiredFactIds: [],
      },
    ],
    sceneTransitions: [
      {
        from: "arrival",
        to: "discovery",
        requiredFactIds: ["servants-passage-found"],
        automatic: true,
      },
    ],
    adventureEndings: [],
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });

  const completed = app.submit({
    type: "choose-action",
    actionId: "find-servants-passage",
  });

  assert.equal(completed.status, "accepted");
  assert.equal(completed.state.activeScene, "discovery");
  assert.deepEqual(
    completed.appendedEvents.map((event) => event.type),
    ["FreeActionCompleted", "SceneTransitioned"],
  );
});

test("an Oracle answer can skip social discovery and enter the Confrontation", async () => {
  const eventStore = createInMemoryEventStore();
  const arrival = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "2",
    "1",
    "0",
    "1",
    "s",
  ]);
  await runStructuredPlay({ io: arrival.io, eventStore });

  const oracle = scriptedIO([
    actionNumber(eventStore, "ask-someone-inside-manor"),
    "l",
  ]);
  await runStructuredPlay({
    io: oracle.io,
    eventStore,
    randomSource: createSeededRandomSource(1327),
  });

  const entry = scriptedIO([
    actionNumber(eventStore, "force-side-door"),
    "c",
    "d",
  ]);
  const entered = await runStructuredPlay({
    io: entry.io,
    eventStore,
    randomSource: createSeededRandomSource(690),
  });

  assert.equal(entered.state.activeScene, "confrontation");
  assert.deepEqual(
    eventStore.readAll().slice(-4).map((event) => event.type),
    [
      "CheckRollRevealed",
      "CheckResolved",
      "SceneTransitioned",
      "ConfrontationStarted",
    ],
  );
  assert.equal(
    eventStore.readAll().some(
      (event) =>
        event.type === "SceneTransitioned" && event.payload.to === "discovery",
    ),
    false,
  );
  assert.match(entry.output.join(""), /confrontation begins/i);
});

test("social discovery can commit a favourable ending without a Confrontation", async () => {
  const eventStore = createInMemoryEventStore();
  await enterDiscovery(eventStore);

  const discovery = scriptedIO([
    actionNumber(eventStore, "question-housekeeper"),
    "c",
    "d",
  ]);
  const ended = await runStructuredPlay({
    io: discovery.io,
    eventStore,
    randomSource: createSeededRandomSource(690),
  });

  assert.equal(ended.state.adventureEnding?.kind, "favourable");
  assert.equal(ended.state.adventureEnding?.id, "sister-escaped-safely");
  assert.equal(ended.state.activeScene, null);
  assert.equal(
    eventStore.readAll().some((event) => event.type === "ConfrontationStarted"),
    false,
  );
  assert.deepEqual(
    eventStore.readAll().slice(-3).map((event) => event.type),
    ["CheckRollRevealed", "CheckResolved", "AdventureEnded"],
  );
  assert.match(discovery.output.join(""), /Adventure ends favourably/i);
});

test("a Confrontation victory commits a favourable Adventure ending", async () => {
  const eventStore = createInMemoryEventStore();
  await enterDiscovery(eventStore);
  const route = scriptedIO([
    actionNumber(eventStore, "question-housekeeper"),
    "c",
    "d",
  ]);
  const entered = await runStructuredPlay({
    io: route.io,
    eventStore,
    randomSource: createSeededRandomSource(8),
  });
  assert.equal(entered.state.activeScene, "confrontation");
  assert.ok(
    entered.state.establishedFacts.some(
      (fact) => fact.id === "cellar-route-revealed",
    ),
  );

  await playConfrontationExchange(eventStore, 690);
  const victory = await playConfrontationExchange(eventStore, 690);

  assert.equal(victory.state.confrontation?.status, "victory");
  assert.equal(victory.state.adventureEnding?.kind, "favourable");
  assert.equal(victory.state.adventureEnding?.id, "cellar-secured");
  assert.deepEqual(
    eventStore.readAll().slice(-3).map((event) => event.type),
    ["CheckResolved", "ConfrontationEnded", "AdventureEnded"],
  );
});

test("Defeat enters a consequence Scene before an adverse Adventure ending", async () => {
  const eventStore = createInMemoryEventStore();
  await enterConfrontationSkippingDiscovery(eventStore);

  await playConfrontationExchange(eventStore, 8);
  const defeat = await playConfrontationExchange(eventStore, 8);
  assert.equal(defeat.state.confrontation?.status, "defeat");
  assert.equal(defeat.state.activeScene, "consequence");
  assert.equal(defeat.state.adventureEnding, null);

  const consequence = scriptedIO([
    actionNumber(eventStore, "accept-capture"),
  ]);
  const ended = await runStructuredPlay({ io: consequence.io, eventStore });

  assert.equal(ended.state.adventureEnding?.kind, "adverse");
  assert.equal(ended.state.adventureEnding?.id, "captured-in-manor");
  assert.equal(ended.state.activeScene, null);
  assert.deepEqual(
    eventStore.readAll().slice(-2).map((event) => event.type),
    ["FreeActionCompleted", "AdventureEnded"],
  );
});
