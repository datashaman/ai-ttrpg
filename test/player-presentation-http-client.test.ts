import assert from "node:assert/strict";
import test from "node:test";

import { createHttpApplicationClient } from "../src/player-ui/http-application-client.js";

const responseFor = (...events: readonly unknown[]): Response =>
  new Response(
    events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );

const collect = async <Value>(source: AsyncIterable<Value>): Promise<Value[]> => {
  const values: Value[] = [];
  for await (const value of source) values.push(value);
  return values;
};

test("the HTTP client accepts one ordered correlated presentation stream", async () => {
  const base = { streamId: "stream:1", correlationId: "event:1" };
  const client = createHttpApplicationClient(async () => responseFor(
    {
      ...base,
      sequence: 0,
      type: "segment",
      segment: {
        id: "segment:1",
        source: "Narrator",
        status: "Provisional",
        text: "Rain gathers. ",
      },
    },
    {
      ...base,
      sequence: 1,
      type: "completed",
      presentation: {
        id: "narration:1",
        outcomeEventId: "event:1",
        source: "Narrator",
        status: "Retained",
        text: "Rain gathers.",
        modelCallIds: ["model-call:1"],
      },
    },
  ));

  const events = await collect(
    client.streamPlayerPresentation("locked-manor", "event:1"),
  );

  assert.deepEqual(events.map(({ type }) => type), ["segment", "completed"]);
});

test("the HTTP client rejects malformed presentation sequences", async () => {
  const client = createHttpApplicationClient(async () => responseFor({
    streamId: "stream:wrong",
    correlationId: "event:1",
    sequence: 2,
    type: "completed",
    presentation: {
      id: "narration:1",
      outcomeEventId: "event:1",
      source: "Narrator",
      status: "Retained",
      text: "Unsafe ordering.",
      modelCallIds: [],
    },
  }));

  await assert.rejects(
    collect(client.streamPlayerPresentation("locked-manor", "event:1")),
    /stream was malformed.*committed outcome is safe/i,
  );
});

test("the HTTP client rejects a disconnected stream without a terminal event", async () => {
  const client = createHttpApplicationClient(async () => responseFor({
    streamId: "stream:cut-off",
    correlationId: "event:1",
    sequence: 0,
    type: "segment",
    segment: {
      id: "segment:1",
      source: "Narrator",
      status: "Provisional",
      text: "This remains provisional…",
    },
  }));

  await assert.rejects(
    collect(client.streamPlayerPresentation("locked-manor", "event:1")),
    /disconnected.*committed outcome is safe/i,
  );
});
