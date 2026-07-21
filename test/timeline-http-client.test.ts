import assert from "node:assert/strict";
import test from "node:test";

import { createHttpApplicationClient } from "../src/player-ui/http-application-client.js";

test("Timeline HTTP client uses actor-specific scoped routes", async () => {
  const requests: { readonly url: string; readonly method: string; readonly body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
    });
    return Response.json(
      String(input).includes("/branches") || String(input).includes("/selection")
        ? { status: "accepted", message: "Accepted.", workspace: {} }
        : { actor: "Player", activeTimelineId: "timeline-main", activeTimeline: {}, timelines: [], comparison: null },
    );
  };
  const client = createHttpApplicationClient(fetcher);

  await client.readTimelineWorkspace("locked-manor", "Player", "timeline-source");
  await client.readTimelineWorkspace("locked-manor", "Game Master");
  await client.branchTimeline("locked-manor", "Player", 3);
  await client.selectTimeline(
    "locked-manor",
    "Game Master",
    "timeline-branch",
    "timeline-main",
  );

  assert.deepEqual(requests, [
    {
      url: "/api/player/adventures/locked-manor/timelines?compareWith=timeline-source",
      method: "GET",
      body: null,
    },
    {
      url: "/api/gm/campaigns/locked-manor/timelines",
      method: "GET",
      body: null,
    },
    {
      url: "/api/player/adventures/locked-manor/timelines/branches",
      method: "POST",
      body: { eventPosition: 3 },
    },
    {
      url: "/api/gm/campaigns/locked-manor/timelines/selection",
      method: "POST",
      body: { timelineId: "timeline-branch", compareWith: "timeline-main" },
    },
  ]);
  assert.ok(requests.every(({ body }) => JSON.stringify(body) !== JSON.stringify({ actor: "Game Master" })));
});
