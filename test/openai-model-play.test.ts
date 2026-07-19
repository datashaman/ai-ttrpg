import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryModelCallRecordStore,
  createModelGateway,
  type ModelTask,
} from "../src/model-gateway.js";
import { runNaturalLanguagePlay } from "../src/natural-language-play.js";
import {
  createOpenAIModelProvider,
  type OpenAIFetch,
} from "../src/openai-model-provider.js";
import {
  createInMemoryEventStore,
  createSeededRandomSource,
  createStructuredPlayApplication,
  type EventStore,
} from "../src/structured-play.js";
import { runStructuredPlay } from "../src/structured-play-runner.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";
import { scriptedIO } from "./support/scripted-io.js";

const responseWith = (output: unknown): Response =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: JSON.stringify(output) },
          ],
        },
      ],
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    }),
    { status: 200 },
  );

const taskFrom = (init: RequestInit): ModelTask => {
  const request = JSON.parse(String(init.body)) as { input: string };
  return JSON.parse(request.input) as ModelTask;
};

const gatewayWith = (fetcher: OpenAIFetch) =>
  createModelGateway({
    provider: createOpenAIModelProvider({
      apiKey: "test-openai-key",
      model: "gpt-application-test",
      fetcher,
    }),
  });

test("OpenAI interpretation completes through Structured Play authority", async () => {
  const { eventStore } = beginAdventureFixture();
  const result = await runNaturalLanguagePlay({
    io: scriptedIO(["I survey the manor grounds."]).io,
    eventStore,
    modelGateway: gatewayWith(async (_url, init) => {
      const task = taskFrom(init);
      assert.equal(task.type, "interpret-player-input");
      return responseWith({
        result: {
          status: "interpreted",
          classification: "player-action",
          capabilityId: "survey-manor",
          referencedEntityIds: ["scene:arrival"],
          evidenceItemIds: [
            "entity:scene:arrival",
            "capability:survey-manor",
            "rule:structured-play-authority",
          ],
          arguments: {},
        },
      });
    }),
  });

  assert.deepEqual(result.interpretedCommands, [
    { type: "choose-action", actionId: "survey-manor" },
  ]);
  assert.equal(
    eventStore.readAll().some((event) => event.type === "FreeActionCompleted"),
    true,
  );
  assert.equal(result.modelCallRecords[0]?.provider, "openai");
});

test("OpenAI rules explanation completes without changing game truth", async () => {
  const { eventStore } = beginAdventureFixture();
  const before = JSON.stringify(eventStore.readAll());
  const script = scriptedIO(["How do Checks work?"]);
  const result = await runNaturalLanguagePlay({
    io: script.io,
    eventStore,
    modelGateway: gatewayWith(async (_url, init) => {
      const task = taskFrom(init);
      if (task.type === "interpret-player-input") {
        return responseWith({
          result: {
            status: "interpreted",
            classification: "rules-query",
            referencedEntityIds: [],
          },
        });
      }
      assert.equal(task.type, "explain-rules");
      const rule = task.evidenceBundle.items.find(
        (item) => item.sourceKind === "authority-rule",
      );
      assert.ok(rule);
      return responseWith({
        segments: [
          { text: rule.content, evidenceItemIds: [rule.id] },
        ],
      });
    }),
  });

  assert.match(script.output.join(""), /Rules explanation/);
  assert.equal(JSON.stringify(eventStore.readAll()), before);
  assert.deepEqual(
    result.modelCallRecords.map((record) => record.taskType),
    ["interpret-player-input", "explain-rules"],
  );
  assert.equal(result.modelCallRecords[1]?.validation.status, "accepted");
});

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

test("OpenAI Narration completes only after the outcome commits", async () => {
  const eventStore = pendingCheckStore();
  const modelCallStore = createInMemoryModelCallRecordStore();
  const script = scriptedIO(["d"]);

  await runStructuredPlay({
    io: script.io,
    eventStore,
    modelCallStore,
    modelGateway: gatewayWith(async (_url, init) => {
      const task = taskFrom(init);
      assert.equal(task.type, "narrate-committed-outcome");
      const committedEvent = task.evidenceBundle.items.find(
        (item) => item.id === "event:committed:0",
      );
      assert.ok(committedEvent);
      const event = JSON.parse(committedEvent.content) as {
        committedStake: { summary: string };
      };
      return responseWith({
        segments: [
          {
            text: event.committedStake.summary,
            evidenceItemIds: [committedEvent.id],
          },
        ],
      });
    }),
  });

  const record = modelCallStore.readAll()[0];
  assert.ok(record);
  assert.equal(
    record.validation.status,
    "accepted",
    JSON.stringify(record.validation),
  );
  assert.match(script.output.join(""), /Narration\nThe door opens quietly\./);
  assert.equal(
    eventStore.readAll().some((event) => event.type === "CheckResolved"),
    true,
  );
  assert.equal(record.provider, "openai");
});
