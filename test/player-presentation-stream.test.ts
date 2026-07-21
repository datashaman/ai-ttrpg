import assert from "node:assert/strict";
import test from "node:test";

import { createDeterministicPlayerSession } from "../src/player-ui/deterministic-player-session.js";
import type { PlayerPresentationGenerator } from "../src/player-ui/player-presentation.js";

const setupOutcome = async (
  generator: PlayerPresentationGenerator,
) => {
  const session = createDeterministicPlayerSession("locked-manor", {
    presentationGenerator: generator,
  });
  await session.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  await session.submit({ type: "begin-adventure" });
  const result = await session.submit({
    type: "choose-action",
    actionId: "survey-manor",
  });
  const entry = result.projection.ledger.at(-1);
  assert.ok(entry);
  return { session, entry, result };
};

const collect = async <Value>(source: AsyncIterable<Value>): Promise<Value[]> => {
  const values: Value[] = [];
  for await (const value of source) values.push(value);
  return values;
};

test("partial Narration remains provisional until a completed stream is retained", async () => {
  const snapshots: unknown[] = [];
  const { session, entry } = await setupOutcome({
    async *generate(snapshot) {
      snapshots.push(snapshot);
      yield "Rain beads on the iron gate. ";
      yield "Fresh tracks cross the mud.";
    },
  });
  const before = structuredClone(session.projection());
  const stream = session.streamPresentation(entry.id);
  const first = await stream.next();

  assert.equal(first.value?.type, "segment");
  assert.deepEqual(session.projection(), before);

  const remainder = await collect({
    [Symbol.asyncIterator]: () => stream,
  });
  assert.deepEqual(remainder.map(({ type }) => type), ["segment", "completed"]);
  assert.deepEqual(session.projection(), before);
  assert.equal(
    session.presentations().at(-1)?.text,
    "Rain beads on the iron gate. Fresh tracks cross the mud.",
  );
  assert.equal(snapshots.length, 1);
});

test("interruption preserves committed state and reopening reuses retained Narration", async () => {
  let generations = 0;
  const { session, entry, result } = await setupOutcome({
    async *generate() {
      generations += 1;
      yield "The manor watches from beyond the rain.";
    },
  });
  const canonicalEvents = structuredClone(result.canonicalEvents);
  const availableActions = structuredClone(result.projection.availableActions);
  const interrupted = session.streamPresentation(entry.id);
  await interrupted.next();
  await interrupted.return(undefined);

  assert.deepEqual(session.projection(), result.projection);
  assert.deepEqual(result.canonicalEvents, canonicalEvents);
  assert.deepEqual(session.projection().availableActions, availableActions);

  const completed = await collect(session.streamPresentation(entry.id));
  assert.equal(completed.at(-1)?.type, "completed");
  const reopened = await collect(session.streamPresentation(entry.id));
  assert.deepEqual(reopened.map(({ type }) => type), ["completed"]);
  assert.equal(generations, 2);
});

test("failed and repeated regenerated presentation never changes canonical play", async () => {
  let attempt = 0;
  const { session, entry } = await setupOutcome({
    async *generate() {
      attempt += 1;
      if (attempt === 1) throw new Error("connection lost");
      yield `Retained attempt ${attempt}.`;
    },
  });

  const failed = await collect(session.streamPresentation(entry.id));
  const failure = failed.at(-1);
  assert.equal(failure?.type, "failed");
  assert.equal(
    failure?.type === "failed" ? failure.deterministicSummary : null,
    entry.summary,
  );

  const proposed = await session.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.projection.pendingCheckProposal);
  await session.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.projection.pendingCheckProposal.id,
  });
  const before = session.canonicalSnapshot();
  const projectionBefore = session.projection();
  assert.ok(before.pendingChoice);

  await collect(session.streamPresentation(entry.id, { regenerate: true }));
  await collect(session.streamPresentation(entry.id, { regenerate: true }));
  assert.deepEqual(session.canonicalSnapshot(), before);
  assert.deepEqual(session.projection(), projectionBefore);
  assert.equal(session.presentations().at(-1)?.text, "Retained attempt 3.");
});
