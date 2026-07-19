import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CHECK_ACTIONS } from "../src/locked-manor-content.js";
import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type EventStore,
  type StructuredPlayOptions,
} from "../src/structured-play.js";
import { runStructuredPlay } from "../src/structured-play-runner.js";
import {
  COLLAPSING_GATE_ACTION,
  enterConfrontation,
} from "./support/confrontation-fixture.js";
import { scriptedIO } from "./support/scripted-io.js";

type ConfrontationApplicationOptions = Omit<
  StructuredPlayOptions,
  "eventStore" | "randomSource"
>;

const prepareConfrontation = (
  applicationOptions: ConfrontationApplicationOptions = {},
): EventStore => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    ...applicationOptions,
    eventStore,
    randomSource: createSeededRandomSource(690),
  });
  enterConfrontation(app);
  return eventStore;
};

const playExchange = async (
  eventStore: EventStore,
  seed: number,
  applicationOptions: ConfrontationApplicationOptions = {},
) => {
  const script = scriptedIO(["1", "c", "d"]);
  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    randomSource: createSeededRandomSource(seed),
    applicationOptions,
  });
  return { view, transcript: script.output.join("") };
};

test("Structured Play completes a visible Confrontation victory without an opposed roll", async () => {
  const eventStore = prepareConfrontation();

  const first = await playExchange(eventStore, 690);
  assert.match(first.transcript, /Resistance Clock: 0\/2/);
  assert.match(first.transcript, /Danger Clock: 0\/2/);
  assert.match(first.transcript, /cult guardian is overcome/);
  assert.match(first.transcript, /cult guardian captures Mara/);
  assert.match(first.transcript, /Check Proposal/);
  assert.doesNotMatch(
    first.transcript,
    /\binitiative\b|\brounds?\b|Non-Player Character turn|opposed roll/i,
  );

  const victory = await playExchange(eventStore, 690);

  assert.equal(victory.view.state.confrontation?.status, "victory");
  assert.equal(victory.view.state.activeScene, null);
  assert.match(victory.transcript, /cellar is secured/);
  assert.doesNotMatch(victory.transcript, /Committed events:|Resulting state:/);
  assert.deepEqual(
    eventStore.readAll().slice(-3).map((event) => event.type),
    ["CheckResolved", "ConfrontationEnded", "AdventureEnded"],
  );
});

test("Structured Play completes Defeat when the Danger Clock fills", async () => {
  const eventStore = prepareConfrontation();

  await playExchange(eventStore, 8);
  const defeat = await playExchange(eventStore, 8);

  assert.equal(defeat.view.state.confrontation?.status, "defeat");
  assert.equal(defeat.view.state.confrontation?.ending?.reason, "danger");
  assert.equal(defeat.view.state.activeScene, "consequence");
  assert.equal(defeat.view.state.playerCharacter?.health, 1);
  assert.match(defeat.transcript, /captures Mara/);
});

test("Structured Play completes Defeat when Health reaches zero", async () => {
  const applicationOptions: ConfrontationApplicationOptions = {
    checkActions: [
      ...DEFAULT_CHECK_ACTIONS.filter(
        (action) => action.id === "force-side-door",
      ),
      COLLAPSING_GATE_ACTION,
    ],
  };
  const eventStore = prepareConfrontation(applicationOptions);

  await playExchange(eventStore, 8, applicationOptions);
  await playExchange(eventStore, 8, applicationOptions);
  const defeat = await playExchange(eventStore, 8, applicationOptions);

  assert.equal(defeat.view.state.playerCharacter?.health, 0);
  assert.equal(defeat.view.state.confrontation?.dangerClock.current, 0);
  assert.equal(defeat.view.state.confrontation?.ending?.reason, "health");
  assert.equal(defeat.view.state.activeScene, "consequence");
  assert.match(defeat.transcript, /wakes imprisoned/);
  assert.doesNotMatch(defeat.transcript, /dead|death/i);
});
