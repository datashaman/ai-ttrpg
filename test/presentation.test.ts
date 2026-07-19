import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type CheckActionDefinition,
  type EventStore,
} from "../src/structured-play.js";
import {
  runStructuredPlay,
  type NarrationRequest,
  type PresentationModel,
  type RulesQueryRequest,
} from "../src/structured-play-runner.js";
import { scriptedIO } from "./support/scripted-io.js";

const pendingCheckStore = (): EventStore => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(690),
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const proposed = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  return eventStore;
};

const normalized = (value: unknown): string => JSON.stringify(value);

test("a committed Check is narrated from Player-visible grounded inputs", async () => {
  const eventStore = pendingCheckStore();
  const received: NarrationRequest[] = [];
  const narrator: PresentationModel = {
    narrate: async (request) => {
      received.push(request);
      return {
        segments: [
          { kind: "event", id: request.committedEvents[0]?.id ?? "missing" },
          { kind: "evidence", id: "side-door-open" },
          { kind: "rule", id: "micro-ruleset.check@1.0.0" },
        ],
      };
    },
    explainRules: async () => {
      throw new Error("not used");
    },
  };
  const script = scriptedIO(["d", "c"]);

  await runStructuredPlay({
    io: script.io,
    eventStore,
    narrator,
  });

  assert.match(
    script.output.join(""),
    /Narration\nClean Success \(10\): The door opens quietly\./,
  );
  const request = received[0];
  assert.ok(request);
  assert.deepEqual(Object.keys(request).sort(), [
    "committedEvents",
    "resolutionTrace",
    "visibleEvidence",
  ]);
  assert.deepEqual(
    request.committedEvents.map((event) => event.type),
    ["CheckResolved"],
  );
  assert.deepEqual(
    request.visibleEvidence.map((fact) => fact.id),
    ["side-door-open"],
  );
  assert.equal(request.resolutionTrace?.rule.id, "micro-ruleset.check");
});

test("contradictory narration falls back without changing committed truth", async () => {
  const eventStore = pendingCheckStore();
  let committedEvents = "";
  let committedState = "";
  const narrator: PresentationModel = {
    narrate: async (request) => {
      committedEvents = normalized(eventStore.readAll());
      committedState = normalized(
        createStructuredPlayApplication({ eventStore }).view().state,
      );
      return {
        text: "The locked door remains shut and Mara loses Health.",
        segments: [
          { kind: "event", id: request.committedEvents[0]?.id ?? "missing" },
        ],
      };
    },
    explainRules: async () => {
      throw new Error("not used");
    },
  };
  const script = scriptedIO(["d", "c"]);

  const view = await runStructuredPlay({ io: script.io, eventStore, narrator });

  const transcript = script.output.join("");
  assert.match(transcript, /Narration \(deterministic fallback\)/);
  assert.match(transcript, /Clean Success \(10\): The door opens quietly\./);
  assert.doesNotMatch(transcript, /door remains shut|loses Health/);
  assert.equal(normalized(eventStore.readAll()), committedEvents);
  assert.equal(normalized(view.state), committedState);
  assert.equal(view.state.playerCharacter?.health, 3);
  assert.deepEqual(
    view.state.establishedFacts.map((fact) => fact.id),
    ["side-door-open"],
  );
});

test("narration cannot introduce an uncommitted Mechanical Effect", async () => {
  const eventStore = pendingCheckStore();
  const narrator: PresentationModel = {
    narrate: async (request) => ({
      segments: [
        { kind: "event", id: request.committedEvents[0]?.id ?? "missing" },
      ],
      mechanicalEffects: [{ type: "lose-health", amount: 1 }],
    }),
    explainRules: async () => {
      throw new Error("not used");
    },
  };
  const script = scriptedIO(["d", "c"]);

  const view = await runStructuredPlay({ io: script.io, eventStore, narrator });

  assert.match(script.output.join(""), /Narration \(deterministic fallback\)/);
  assert.doesNotMatch(script.output.join(""), /Mara loses Health/);
  assert.equal(view.state.playerCharacter?.health, 3);
});

test("narration timeout returns the same deterministic summary without repeating the action", async () => {
  const eventStore = pendingCheckStore();
  const narrator: PresentationModel = {
    narrate: () => new Promise(() => undefined),
    explainRules: async () => {
      throw new Error("not used");
    },
  };
  const script = scriptedIO(["d", "c"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    narrator,
    narrationTimeoutMs: 5,
  });

  assert.match(
    script.output.join(""),
    /Narration \(deterministic fallback\)\nClean Success \(10\): The door opens quietly\./,
  );
  assert.equal(
    eventStore.readAll().filter((event) => event.type === "CheckResolved").length,
    1,
  );
  assert.equal(view.state.lastCheckResolution?.outcome, "Clean Success");
});

test("a rules query explains the committed resolution from relevant evidence without advancing play", async () => {
  const eventStore = pendingCheckStore();
  const rulesRequests: RulesQueryRequest[] = [];
  const narrator: PresentationModel = {
    narrate: async (request) => ({
      segments: [
        { kind: "event", id: request.committedEvents[0]?.id ?? "missing" },
      ],
    }),
    explainRules: async (request) => {
      rulesRequests.push(request);
      return {
        segments: [
          { kind: "rule", id: "micro-ruleset.check@1.0.0" },
          { kind: "evidence", id: "side-door-open" },
        ],
      };
    },
  };
  const script = scriptedIO(["d", "q", "Why was that a Clean Success?", "c"]);

  const view = await runStructuredPlay({ io: script.io, eventStore, narrator });

  assert.match(
    script.output.join(""),
    /Rules explanation\nmicro-ruleset\.check@1\.0\.0: total 10 resolved as Clean Success\./,
  );
  const rulesRequest = rulesRequests[0];
  assert.ok(rulesRequest);
  assert.equal(rulesRequest.query, "Why was that a Clean Success?");
  const trace = rulesRequest.resolutionTrace;
  assert.ok(trace?.rule.id === "micro-ruleset.check");
  assert.ok("total" in trace.result);
  assert.equal(trace.result.total, 10);
  assert.deepEqual(
    rulesRequest.visibleEvidence.map((fact) => fact.id),
    ["side-door-open"],
  );
  assert.equal(eventStore.readAll().length, 6);
  assert.equal(view.state.activeScene, "arrival");
});

test("the Player can regenerate presentation repeatedly from byte-equivalent committed inputs", async () => {
  const eventStore = pendingCheckStore();
  const requests: string[] = [];
  const eventSnapshots: string[] = [];
  const stateSnapshots: string[] = [];
  let generation = 0;
  const narrator: PresentationModel = {
    narrate: async (request) => {
      requests.push(normalized(request));
      eventSnapshots.push(normalized(eventStore.readAll()));
      stateSnapshots.push(
        normalized(createStructuredPlayApplication({ eventStore }).view().state),
      );
      generation += 1;
      return {
        segments:
          generation === 1
            ? [
                {
                  kind: "event",
                  id: request.committedEvents[0]?.id ?? "missing",
                },
              ]
            : generation === 2
              ? [{ kind: "evidence", id: "side-door-open" }]
              : [{ kind: "rule", id: "micro-ruleset.check@1.0.0" }],
      };
    },
    explainRules: async () => {
      throw new Error("not used");
    },
  };
  const script = scriptedIO(["d", "r", "r", "c"]);

  const view = await runStructuredPlay({ io: script.io, eventStore, narrator });

  assert.equal(generation, 3);
  assert.equal(new Set(requests).size, 1);
  assert.equal(new Set(eventSnapshots).size, 1);
  assert.equal(new Set(stateSnapshots).size, 1);
  assert.match(script.output.join(""), /Clean Success \(10\)/);
  assert.match(script.output.join(""), /The manor's side door is open\./);
  assert.match(script.output.join(""), /total 10 resolved as Clean Success/);
  assert.equal(
    eventStore.readAll().filter((event) => event.type === "CheckResolved").length,
    1,
  );
  assert.equal(view.state.lastCheckResolution?.outcome, "Clean Success");
  assert.equal(normalized(eventStore.readAll()), eventSnapshots[0]);
  assert.equal(normalized(view.state), stateSnapshots[0]);
});

test("invalid model output falls back to the deterministic mechanical summary", async () => {
  const eventStore = pendingCheckStore();
  const narrator: PresentationModel = {
    narrate: async () => ({ text: "Missing grounding schema." }),
    explainRules: async () => ({ text: 42 }),
  };
  const script = scriptedIO(["d", "c"]);

  await runStructuredPlay({ io: script.io, eventStore, narrator });

  assert.match(
    script.output.join(""),
    /Narration \(deterministic fallback\)\nClean Success \(10\): The door opens quietly\./,
  );
});

test("an Oracle answer is narrated only after its truth commits", async () => {
  const eventStore = createInMemoryEventStore();
  const requests: NarrationRequest[] = [];
  const narrator: PresentationModel = {
    narrate: async (request) => {
      requests.push(request);
      return {
        segments: request.committedEvents.map((event) => ({
          kind: "event" as const,
          id: event.id,
        })),
      };
    },
    explainRules: async () => {
      throw new Error("not used");
    },
  };
  const script = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "1",
    "c",
    "c",
    "5",
    "u",
    "c",
  ]);

  await runStructuredPlay({
    io: script.io,
    eventStore,
    randomSource: createSeededRandomSource(140),
    narrator,
  });

  const oracleRequest = requests.at(-1);
  assert.ok(oracleRequest);
  assert.deepEqual(
    oracleRequest.committedEvents.map((event) => event.type),
    ["OracleAnswered"],
  );
  assert.equal(oracleRequest.resolutionTrace?.rule.id, "micro-ruleset.oracle");
  assert.ok(
    oracleRequest.visibleEvidence.some(
      (fact) => fact.id === "someone-inside-manor-no",
    ),
  );
  assert.match(script.output.join(""), /Oracle answer: No/);
});

test("Field Kit recovery is safely rendered from its committed event", async () => {
  const harmfulAction: CheckActionDefinition = {
    id: "spring-trap",
    label: "Spring the trap",
    kind: "Check",
    goal: "Cross the trapped threshold",
    trait: "Might",
    stakes: {
      Setback: {
        summary: "The trap strikes.",
        consequences: [{ type: "lose-health", amount: 1 }],
      },
      "Success with Cost": { summary: "Cross at a cost.", consequences: [] },
      "Clean Success": { summary: "Cross safely.", consequences: [] },
    },
  };
  const applicationOptions = {
    checkActions: [harmfulAction],
    oracleActions: [],
  };
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    eventStore,
    randomSource: createSeededRandomSource(8),
    ...applicationOptions,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  const proposed = app.submit({ type: "choose-action", actionId: "spring-trap" });
  assert.ok(proposed.state.pendingCheckProposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  assert.ok(revealed.state.pendingChoice);
  app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: revealed.state.pendingChoice.id,
    choice: "decline",
  });
  const recoveryNumber = app
    .view()
    .availableActions.findIndex(
      (action) => action.kind === "Recovery" && action.resource === "Health",
    );
  assert.notEqual(recoveryNumber, -1);
  const requests: NarrationRequest[] = [];
  const narrator: PresentationModel = {
    narrate: async (request) => {
      requests.push(request);
      return {
        segments: request.committedEvents.map((event) => ({
          kind: "event" as const,
          id: event.id,
        })),
      };
    },
    explainRules: async () => {
      throw new Error("not used");
    },
  };
  const script = scriptedIO([String(recoveryNumber + 1), "c"]);

  const view = await runStructuredPlay({
    io: script.io,
    eventStore,
    applicationOptions,
    narrator,
  });

  assert.deepEqual(
    requests.at(-1)?.committedEvents.map((event) => event.type),
    ["FieldKitUsed"],
  );
  assert.match(
    script.output.join(""),
    /Narration\nThe Field Kit restores 1 Health and is removed from Inventory\./,
  );
  assert.equal(view.state.playerCharacter?.health, 3);
});
