import assert from "node:assert/strict";
import test from "node:test";

import { createHttpGameMasterApplicationClient } from "../src/gm-ui/http-application-client.js";

test("Game Master HTTP client reads scoped work and trace without sending actor overrides", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/workspace")) {
      return Response.json({ campaign: { id: "locked-manor", title: "The Locked Manor" }, status: "Action required", queue: [], recentNarration: { outcomeId: "outcome:side-door", text: "Retained.", traceHref: "/trace" } });
    }
    return Response.json({ id: "trace:side-door" });
  };
  const client = createHttpGameMasterApplicationClient(fetcher);

  assert.equal((await client.readWorkspace("locked-manor")).status, "Action required");
  assert.equal((await client.readOutcomeTrace("locked-manor", "outcome:side-door")).id, "trace:side-door");
  assert.deepEqual(requests.map(({ url }) => url), [
    "/api/gm/campaigns/locked-manor/workspace",
    "/api/gm/campaigns/locked-manor/outcomes/outcome%3Aside-door/trace",
  ]);
  assert.ok(requests.every(({ init }) => !JSON.stringify(init).includes("Game Master")));
});

test("Game Master HTTP client submits validated intervention and presentation operations", async () => {
  const bodies: unknown[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(init?.body === undefined ? null : JSON.parse(String(init.body)));
    return Response.json({ status: "accepted", message: "Accepted.", committedEvents: [], auditRecord: {}, workspace: {} });
  };
  const client = createHttpGameMasterApplicationClient(fetcher);

  await client.intervene("locked-manor", {
    itemId: "review:rule-conflict",
    expectedRevision: 1,
    idempotencyKey: "review:1",
    decision: "approve",
  });
  await client.retryNarration("locked-manor", "outcome:side-door");

  assert.deepEqual(bodies, [
    {
      itemId: "review:rule-conflict",
      expectedRevision: 1,
      idempotencyKey: "review:1",
      decision: "approve",
    },
    null,
  ]);
});
