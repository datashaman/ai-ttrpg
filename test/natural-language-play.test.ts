import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type EventStore,
  type RandomSource,
} from "../src/structured-play.js";
import {
  runNaturalLanguagePlay,
  type InterpretationModel,
  type InterpretationRequest,
} from "../src/natural-language-play.js";
import { runStructuredPlay } from "../src/structured-play-runner.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import { scriptedIO } from "./support/scripted-io.js";
import { reachLockedManorDiscovery } from "./support/world-knowledge-fixture.js";

const startedAdventure = (
  traits: {
    readonly Might: 0 | 1 | 2;
    readonly Wits: 0 | 1 | 2;
    readonly Presence: 0 | 1 | 2;
  } = { Might: 0, Wits: 2, Presence: 1 },
): EventStore => {
  return beginAdventureFixture({ traits }).eventStore;
};

const actionNumber = (eventStore: EventStore, actionId: string): string => {
  const index = createStructuredPlayApplication({ eventStore })
    .view()
    .availableActions.findIndex((action) => action.id === actionId);
  assert.notEqual(index, -1, `${actionId} should be available`);
  return String(index + 1);
};

const normalizedEvents = (eventStore: EventStore): string =>
  JSON.stringify(eventStore.readAll(), (key, value: unknown) => {
    if (key === "timestamp") return "<timestamp>";
    return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
      ? "<id>"
      : value;
  });

const scriptedRandomSource = (rolls: readonly number[]): RandomSource => {
  let position = 0;
  return {
    rollDie: (sides) => {
      const roll = rolls[position];
      assert.ok(roll !== undefined, "scripted random input exhausted");
      assert.ok(roll >= 1 && roll <= sides, `${roll} must fit d${sides}`);
      position += 1;
      return roll;
    },
    metadata: () => ({ source: "scripted", seed: null }),
    position: () => position,
  };
};

const capabilitySequence = (
  capabilityIds: readonly string[],
  speechIds: readonly string[] = [],
): InterpretationModel => {
  let position = 0;
  return {
    interpret: async (request) => {
      const capabilityId = capabilityIds[position];
      assert.ok(capabilityId, "interpretation sequence exhausted");
      assert.ok(
        request.availableCapabilities.some(
          (capability) => capability.id === capabilityId,
        ),
        `${capabilityId} should be available`,
      );
      position += 1;
      return {
        status: "interpreted",
        classification: speechIds.includes(capabilityId)
          ? "in-character-speech"
          : "player-action",
        capabilityId,
        referencedEntityIds: [],
        arguments: {},
      };
    },
  };
};

const playStructuredCapability = (
  eventStore: EventStore,
  randomSource: RandomSource,
  actionId: string,
  answers: readonly string[],
): Promise<unknown> =>
  runStructuredPlay({
    io: scriptedIO([actionNumber(eventStore, actionId), ...answers]).io,
    eventStore,
    randomSource,
  });

test("natural-language Player action selects a currently available capability", async () => {
  const eventStore = createInMemoryEventStore();
  const requests: InterpretationRequest[] = [];
  const interpreter: InterpretationModel = {
    interpret: async (request) => {
      requests.push(request);
      return {
        status: "interpreted",
        classification: "player-action",
        capabilityId: "survey-manor",
        referencedEntityIds: ["scene:arrival"],
        arguments: {},
      };
    },
  };
  const script = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "I survey the manor grounds.",
  ]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
  });

  const request = requests[0];
  assert.ok(request);
  assert.equal(request.utterance, "I survey the manor grounds.");
  assert.deepEqual(Object.keys(request).sort(), [
    "availableCapabilities",
    "knownEntities",
    "utterance",
    "visibleEvidence",
  ]);
  assert.ok(
    request.availableCapabilities.some(
      (capability) => capability.id === "survey-manor",
    ),
  );
  assert.ok(
    request.knownEntities.some((entity) => entity.id === "scene:arrival"),
  );
  assert.deepEqual(result.interpretedCommands, [
    { type: "choose-action", actionId: "survey-manor" },
  ]);
  assert.deepEqual(
    eventStore.readAll().map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "WorldKnowledgeEstablished",
      "SceneStarted",
      "FreeActionCompleted",
    ],
  );
  assert.match(script.output.join(""), /Fresh footprints lead from the manor gate/);
});

test("natural-language play selects the authored Reveal through Structured Play authority", async () => {
  const { eventStore } = reachLockedManorDiscovery();
  const before = structuredClone(eventStore.readAll());
  const script = scriptedIO(["I study the housekeeper's concealed insignia."]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter: capabilitySequence(["examine-housekeeper-insignia"]),
    eventStore,
  });

  assert.deepEqual(result.interpretedCommands, [
    {
      type: "choose-action",
      actionId: "examine-housekeeper-insignia",
    },
  ]);
  assert.deepEqual(eventStore.readAll().slice(0, -1), before);
  assert.equal(eventStore.readAll().at(-1)?.type, "WorldKnowledgeRevealed");
  assert.match(
    script.output.join(""),
    /housekeeper is the cellar guardian in disguise/i,
  );
});

test("natural-language play lets a new Player recover from invalid setup", async () => {
  const eventStore = createInMemoryEventStore();
  const script = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "1",
    "1",
    "1",
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "I survey the grounds.",
    "I leave before going inside.",
  ]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter: capabilitySequence(["survey-manor", "withdraw-from-manor"]),
    eventStore,
    runToAdventureEnd: true,
  });

  const output = script.output.join("");
  assert.match(output, /Create your Player Character/);
  assert.match(output, /Please try setup again/);
  assert.equal(output.match(/Player Character name:/g)?.length, 2);
  assert.equal(result.state.adventureEnding?.kind, "unresolved");
});

test("a natural-language rules query exposes visible evidence without advancing play", async () => {
  const eventStore = startedAdventure();
  const before = JSON.stringify(eventStore.readAll());
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "interpreted",
      classification: "rules-query",
      referencedEntityIds: ["scene:arrival"],
    }),
  };
  const script = scriptedIO(["What do we know about this Scene?"]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
  });

  assert.match(script.output.join(""), /Rules evidence/);
  assert.match(script.output.join(""), /Active Scene: arrival/);
  assert.equal(JSON.stringify(eventStore.readAll()), before);
  assert.equal(result.state.activeScene, "arrival");
  assert.deepEqual(result.interpretedCommands, []);
});

for (const example of [
  {
    classification: "in-character-speech",
    response: {
      status: "interpreted",
      classification: "in-character-speech",
      capabilityId: null,
      referencedEntityIds: ["player-character"],
      arguments: {},
    },
    output: /In-character speech acknowledged/,
  },
  {
    classification: "out-of-character-request",
    response: {
      status: "interpreted",
      classification: "out-of-character-request",
      referencedEntityIds: [],
    },
    output: /Out-of-character request acknowledged/,
  },
  {
    classification: "table-chat",
    response: {
      status: "interpreted",
      classification: "table-chat",
      referencedEntityIds: [],
    },
    output: /Table chat acknowledged/,
  },
  {
    classification: "system-command",
    response: {
      status: "interpreted",
      classification: "system-command",
      command: "show-state",
      referencedEntityIds: ["scene:arrival"],
    },
    output: /Current Player-visible state/,
  },
] as const) {
  test(`${example.classification} is classified without appending gameplay events`, async () => {
    const eventStore = startedAdventure();
    const before = JSON.stringify(eventStore.readAll());
    const interpreter: InterpretationModel = {
      interpret: async () => example.response,
    };
    const script = scriptedIO(["Conversational input"]);

    const result = await runNaturalLanguagePlay({
      io: script.io,
      interpreter,
      eventStore,
    });

    assert.match(script.output.join(""), example.output);
    assert.equal(JSON.stringify(eventStore.readAll()), before);
    assert.deepEqual(result.interpretedCommands, []);
  });
}

test("interpreter failure returns a safe rejection without changing game truth", async () => {
  const eventStore = startedAdventure();
  const before = JSON.stringify(eventStore.readAll());
  const interpreter: InterpretationModel = {
    interpret: async () => {
      throw new Error("model unavailable");
    },
  };
  const script = scriptedIO(["Open the door"]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
  });

  assert.match(script.output.join(""), /could not safely map/i);
  assert.equal(JSON.stringify(eventStore.readAll()), before);
  assert.deepEqual(result.interpretedCommands, []);
});

test("interpreter timeout returns a safe rejection without changing game truth", async () => {
  const eventStore = startedAdventure();
  const before = JSON.stringify(eventStore.readAll());
  const interpreter: InterpretationModel = {
    interpret: () => new Promise(() => undefined),
  };
  const script = scriptedIO(["Open the door"]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
    interpretationTimeoutMs: 5,
  });

  assert.match(script.output.join(""), /could not safely map/i);
  assert.equal(JSON.stringify(eventStore.readAll()), before);
  assert.deepEqual(result.interpretedCommands, []);
});

test("a natural-language Check uses the Structured Play confirmation boundary and canonical events", async () => {
  const naturalStore = startedAdventure();
  const structuredStore = startedAdventure();
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "interpreted",
      classification: "player-action",
      capabilityId: "force-side-door",
      referencedEntityIds: ["scene:arrival"],
      arguments: {},
    }),
  };
  const natural = scriptedIO(["I force open the side door.", "c", "d"]);
  const structured = scriptedIO([
    actionNumber(structuredStore, "force-side-door"),
    "c",
    "d",
  ]);

  const result = await runNaturalLanguagePlay({
    io: natural.io,
    interpreter,
    eventStore: naturalStore,
    randomSource: createSeededRandomSource(690),
  });
  await runStructuredPlay({
    io: structured.io,
    eventStore: structuredStore,
    randomSource: createSeededRandomSource(690),
  });

  assert.match(natural.output.join(""), /Check Proposal/);
  assert.match(natural.output.join(""), /Confirm \(c\)/);
  assert.deepEqual(result.interpretedCommands, [
    { type: "choose-action", actionId: "force-side-door" },
  ]);
  assert.equal(normalizedEvents(naturalStore), normalizedEvents(structuredStore));
});

test("withdrawing a naturally selected Check Proposal prevents a roll", async () => {
  const eventStore = startedAdventure();
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "interpreted",
      classification: "player-action",
      capabilityId: "force-side-door",
      referencedEntityIds: [],
      arguments: {},
    }),
  };
  const script = scriptedIO(["I force the door.", "w"]);

  await runNaturalLanguagePlay({ io: script.io, interpreter, eventStore });

  assert.deepEqual(
    eventStore.readAll().slice(-2).map((event) => event.type),
    ["CheckProposalCreated", "CheckProposalWithdrawn"],
  );
  assert.equal(
    eventStore.readAll().some((event) => event.type === "CheckRollRevealed"),
    false,
  );
});

test("a natural-language Oracle question retains Player Likelihood authority and equivalent events", async () => {
  const naturalStore = startedAdventure();
  const structuredStore = startedAdventure();
  createStructuredPlayApplication({ eventStore: naturalStore }).submit({
    type: "choose-action",
    actionId: "survey-manor",
  });
  createStructuredPlayApplication({ eventStore: structuredStore }).submit({
    type: "choose-action",
    actionId: "survey-manor",
  });
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "interpreted",
      classification: "player-action",
      capabilityId: "ask-someone-inside-manor",
      referencedEntityIds: ["fresh-footprints"],
      arguments: {},
    }),
  };
  const natural = scriptedIO(["Is someone inside the manor?", "u"]);
  const structured = scriptedIO([
    actionNumber(structuredStore, "ask-someone-inside-manor"),
    "u",
  ]);

  const result = await runNaturalLanguagePlay({
    io: natural.io,
    interpreter,
    eventStore: naturalStore,
    randomSource: createSeededRandomSource(140),
  });
  await runStructuredPlay({
    io: structured.io,
    eventStore: structuredStore,
    randomSource: createSeededRandomSource(140),
  });

  assert.match(natural.output.join(""), /Confirm or change Likelihood/);
  assert.match(natural.output.join(""), /Confirmed Likelihood: Unlikely/);
  assert.deepEqual(result.interpretedCommands, [
    { type: "choose-action", actionId: "ask-someone-inside-manor" },
  ]);
  assert.equal(normalizedEvents(naturalStore), normalizedEvents(structuredStore));
});

test("a persisted Pending Choice bypasses interpretation and remains the Player's decision", async () => {
  const eventStore = startedAdventure();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(5),
  });
  const proposed = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  let interpretationCalls = 0;
  const interpreter: InterpretationModel = {
    interpret: async () => {
      interpretationCalls += 1;
      return {
        status: "interpreted",
        classification: "system-command",
        command: "commit-clean-success",
        referencedEntityIds: [],
      };
    },
  };
  const script = scriptedIO(["d"]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
  });

  assert.equal(interpretationCalls, 0);
  assert.match(script.output.join(""), /Resuming Pending Choice/);
  assert.match(script.output.join(""), /Spend 1 Resolve \(s\) or decline \(d\)/);
  assert.equal(result.state.lastCheckResolution?.outcome, "Success with Cost");
  assert.deepEqual(result.interpretedCommands, []);
});

test("a pending Oracle recommendation bypasses interpretation and preserves Player Likelihood authority", async () => {
  const eventStore = startedAdventure();
  const app = createStructuredPlayApplication({ eventStore });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const recommended = app.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  });
  assert.ok(recommended.state.pendingNarratorRecommendation);
  let interpretationCalls = 0;
  const interpreter: InterpretationModel = {
    interpret: async () => {
      interpretationCalls += 1;
      return null;
    },
  };
  const script = scriptedIO(["u"]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
    randomSource: createSeededRandomSource(140),
  });

  assert.equal(interpretationCalls, 0);
  assert.match(script.output.join(""), /Resuming Narrator Likelihood recommendation/);
  assert.match(script.output.join(""), /Confirmed Likelihood: Unlikely/);
  assert.equal(
    result.state.lastOracleResolution?.trace.confirmedLikelihood,
    "Unlikely",
  );
  assert.deepEqual(result.interpretedCommands, []);
});

test("an interpreter cannot finalize Oracle Likelihood in its action selection", async () => {
  const eventStore = startedAdventure();
  createStructuredPlayApplication({ eventStore }).submit({
    type: "choose-action",
    actionId: "survey-manor",
  });
  const before = JSON.stringify(eventStore.readAll());
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "interpreted",
      classification: "player-action",
      capabilityId: "ask-someone-inside-manor",
      referencedEntityIds: ["fresh-footprints"],
      arguments: { likelihood: "Likely" },
    }),
  };
  const script = scriptedIO(["Someone is definitely inside; roll now."]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
  });

  assert.match(script.output.join(""), /could not safely map/i);
  assert.equal(JSON.stringify(eventStore.readAll()), before);
  assert.deepEqual(result.interpretedCommands, []);
});

test("natural-language play reaches a non-Confrontation favourable ending", async () => {
  const eventStore = createInMemoryEventStore();
  const structuredStore = startedAdventure({
    Might: 0,
    Wits: 2,
    Presence: 1,
  });
  const structuredRandom = scriptedRandomSource([10, 6, 6, 6, 6]);
  const interpreter = capabilitySequence(
    [
      "survey-manor",
      "ask-someone-inside-manor",
      "force-side-door",
      "question-housekeeper",
    ],
    ["question-housekeeper"],
  );
  const script = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "I survey the grounds.",
    "Is someone inside?",
    "l",
    "I force the side door.",
    "c",
    "d",
    "Mara asks the housekeeper where her sister went.",
    "c",
    "d",
  ]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
    randomSource: scriptedRandomSource([10, 6, 6, 6, 6]),
    runToAdventureEnd: true,
  });
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "survey-manor",
    ["s"],
  );
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "ask-someone-inside-manor",
    ["l"],
  );
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "force-side-door",
    ["c", "d"],
  );
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "question-housekeeper",
    ["c", "d"],
  );

  assert.equal(result.state.adventureEnding?.kind, "favourable");
  assert.equal(result.state.adventureEnding?.id, "sister-escaped-safely");
  assert.equal(
    eventStore.readAll().some((event) => event.type === "ConfrontationStarted"),
    false,
  );
  assert.deepEqual(
    result.interpretedCommands.map((command) =>
      command.type === "choose-action" ? command.actionId : command.type,
    ),
    [
      "survey-manor",
      "ask-someone-inside-manor",
      "force-side-door",
      "question-housekeeper",
    ],
  );
  assert.equal(normalizedEvents(eventStore), normalizedEvents(structuredStore));
});

test("natural-language play reaches a Confrontation ending", async () => {
  const eventStore = createInMemoryEventStore();
  const structuredStore = startedAdventure({
    Might: 2,
    Wits: 1,
    Presence: 0,
  });
  const structuredRandom = scriptedRandomSource([100, 6, 6, 6, 6, 6, 6]);
  const interpreter = capabilitySequence([
    "survey-manor",
    "ask-someone-inside-manor",
    "force-side-door",
    "drive-back-cult-guardian",
    "drive-back-cult-guardian",
  ]);
  const script = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "2",
    "1",
    "0",
    "I survey the grounds.",
    "Is someone inside?",
    "l",
    "I force the side door.",
    "c",
    "d",
    "I drive the cellar guardian back.",
    "c",
    "d",
    "I press forward and drive the guardian away.",
    "c",
    "d",
  ]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
    randomSource: scriptedRandomSource([100, 6, 6, 6, 6, 6, 6]),
    runToAdventureEnd: true,
  });
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "survey-manor",
    ["s"],
  );
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "ask-someone-inside-manor",
    ["l"],
  );
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "force-side-door",
    ["c", "d"],
  );
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "drive-back-cult-guardian",
    ["c", "d"],
  );
  await playStructuredCapability(
    structuredStore,
    structuredRandom,
    "drive-back-cult-guardian",
    ["c", "d"],
  );

  assert.equal(result.state.confrontation, null);
  assert.equal(result.state.adventureEnding?.kind, "favourable");
  assert.equal(result.state.adventureEnding?.id, "cellar-secured");
  assert.ok(
    eventStore.readAll().some((event) => event.type === "ConfrontationStarted"),
  );
  assert.ok(
    eventStore.readAll().some((event) => event.type === "ConfrontationEnded"),
  );
  assert.deepEqual(
    result.interpretedCommands.map((command) =>
      command.type === "choose-action" ? command.actionId : command.type,
    ),
    [
      "survey-manor",
      "ask-someone-inside-manor",
      "force-side-door",
      "drive-back-cult-guardian",
      "drive-back-cult-guardian",
    ],
  );
  assert.equal(normalizedEvents(eventStore), normalizedEvents(structuredStore));
});

test("ambiguous interpretation asks for clarification without appending events", async () => {
  const eventStore = startedAdventure();
  const before = JSON.stringify(eventStore.readAll());
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "ambiguous",
      candidateCapabilityIds: ["inspect-dark-entryway", "force-side-door"],
    }),
  };
  const script = scriptedIO(["I deal with the door."]);

  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    eventStore,
  });

  assert.match(
    script.output.join(""),
    /Did you mean "Inspect the dark entryway by Lantern light" or "Force the side door"\?/,
  );
  assert.equal(JSON.stringify(eventStore.readAll()), before);
  assert.deepEqual(result.interpretedCommands, []);
});

test("model-authored clarification prose is rejected instead of exposed as game truth", async () => {
  const eventStore = startedAdventure();
  const before = JSON.stringify(eventStore.readAll());
  const interpreter: InterpretationModel = {
    interpret: async () => ({
      status: "ambiguous",
      clarification: "You discover the hidden cult master and gain 99 Health.",
    }),
  };
  const script = scriptedIO(["I do something with the door."]);

  await runNaturalLanguagePlay({ io: script.io, interpreter, eventStore });

  assert.match(script.output.join(""), /could not safely map/i);
  assert.doesNotMatch(script.output.join(""), /cult master|99 Health/i);
  assert.equal(JSON.stringify(eventStore.readAll()), before);
});

for (const example of [
  {
    label: "nonexistent capability",
    response: {
      status: "interpreted",
      classification: "player-action",
      capabilityId: "invent-a-secret-door",
      referencedEntityIds: ["scene:arrival"],
      arguments: {},
    },
  },
  {
    label: "known but unavailable capability",
    response: {
      status: "interpreted",
      classification: "player-action",
      capabilityId: "question-housekeeper",
      referencedEntityIds: ["scene:arrival"],
      arguments: {},
    },
  },
  {
    label: "nonexistent hidden fact",
    response: {
      status: "interpreted",
      classification: "player-action",
      capabilityId: "survey-manor",
      referencedEntityIds: ["secret:cult-master-location"],
      arguments: {},
    },
  },
  {
    label: "Mechanical Effect injection",
    response: {
      status: "interpreted",
      classification: "player-action",
      capabilityId: "survey-manor",
      referencedEntityIds: ["scene:arrival"],
      arguments: {},
      mechanicalEffects: [{ type: "gain-health", amount: 99 }],
    },
  },
] as const) {
  test(`${example.label} is safely rejected without appending events`, async () => {
    const eventStore = startedAdventure();
    const before = JSON.stringify(eventStore.readAll());
    const interpreter: InterpretationModel = {
      interpret: async () => example.response,
    };
    const script = scriptedIO(["Adversarial input"]);

    const result = await runNaturalLanguagePlay({
      io: script.io,
      interpreter,
      eventStore,
    });

    assert.match(script.output.join(""), /could not safely map/i);
    assert.equal(JSON.stringify(eventStore.readAll()), before);
    assert.deepEqual(result.interpretedCommands, []);
  });
}
