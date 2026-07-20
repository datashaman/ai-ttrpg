import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalAdventureRepository } from "../src/adventure-repository.js";
import { createStructuredPlayApplication } from "../src/structured-play.js";

const beginDurableTimelineAdventure = (name: string) => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-timelines-"));
  const repository = createLocalAdventureRepository(directory);
  const adventure = repository.create(name);
  const app = createStructuredPlayApplication({
    timelineStore: adventure.timelineStore,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  return { directory, repository, adventure, app };
};

test("a fresh repository instance restores the complete Timeline graph and active selection", () => {
  const { directory, adventure, app } =
    beginDurableTimelineAdventure("The Branching Manor");
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
  const sourceEvents = adventure.timelineStore.readTimeline(sourceTimelineId);
  const branched = app.submit({ type: "branch-timeline", eventPosition: 2 });
  assert.equal(branched.status, "accepted");
  const beforeClose = adventure.timelineStore.view();
  adventure.close();

  const reopened = createLocalAdventureRepository(directory).open(adventure.id);

  assert.deepEqual(reopened.timelineStore.view(), beforeClose);
  assert.deepEqual(reopened.timelineStore.readTimeline(sourceTimelineId), sourceEvents);
  assert.equal(reopened.timelineStore.view().timelines.length, 2);
  assert.equal(
    reopened.timelineStore.view().activeTimeline.parentTimelineId,
    sourceTimelineId,
  );
  assert.equal(reopened.timelineStore.view().activeTimeline.branchEventPosition, 3);
  reopened.close();
});

test("a durable branch inherits and reproduces its source random result after restart", () => {
  const { directory, adventure, app } =
    beginDurableTimelineAdventure("The Repeating Manor");
  const proposed = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  assert.ok(revealed.state.pendingChoice);
  const sourceInputs = revealed.state.pendingChoice.roll.random.inputs;
  app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: revealed.state.pendingChoice.id,
    choice: "decline",
  });
  const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
  const sourceHistory = adventure.timelineStore.readTimeline(sourceTimelineId);
  app.submit({ type: "branch-timeline", eventPosition: 3 });
  const childTimelineId = adventure.timelineStore.view().activeTimelineId;
  adventure.close();

  const reopened = createLocalAdventureRepository(directory).open(adventure.id);
  assert.equal(reopened.timelineStore.view().activeTimelineId, childTimelineId);
  assert.equal(reopened.timelineStore.view().activeTimeline.randomPosition, 0);
  const resumed = createStructuredPlayApplication({
    timelineStore: reopened.timelineStore,
  });
  const childProposal = resumed.view().state.pendingCheckProposal;
  assert.ok(childProposal);
  const childReveal = resumed.submit({
    type: "confirm-check-proposal",
    proposalId: childProposal.id,
  });
  assert.ok(childReveal.state.pendingChoice);

  assert.deepEqual(childReveal.state.pendingChoice.roll.random.inputs, sourceInputs);
  assert.deepEqual(
    reopened.timelineStore.readTimeline(sourceTimelineId),
    sourceHistory,
  );
  assert.equal(reopened.timelineStore.view().activeTimeline.randomPosition, 2);
  reopened.close();

  const restarted = createLocalAdventureRepository(directory).open(adventure.id);
  assert.equal(restarted.timelineStore.view().activeTimelineId, childTimelineId);
  assert.equal(restarted.timelineStore.view().activeTimeline.randomPosition, 2);
  restarted.close();
});

test("durable Timeline selection isolates appends and rejects invalid changes", () => {
  const { directory, adventure, app } =
    beginDurableTimelineAdventure("The Diverging Manor");
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
  app.submit({ type: "branch-timeline", eventPosition: 2 });
  const childTimelineId = adventure.timelineStore.view().activeTimelineId;
  adventure.close();

  const reopened = createLocalAdventureRepository(directory).open(adventure.id);
  const resumed = createStructuredPlayApplication({
    timelineStore: reopened.timelineStore,
  });
  const beforeInvalid = JSON.stringify(
    reopened.timelineStore.view().timelines.map((timeline) => ({
      ...timeline,
      events: reopened.timelineStore.readTimeline(timeline.id),
    })),
  );
  const unknown = resumed.submit({
    type: "select-timeline",
    timelineId: "timeline-unknown",
  });
  const invalidBranch = resumed.submit({
    type: "branch-timeline",
    eventPosition: 0,
  });
  assert.equal(unknown.status, "rejected");
  assert.equal(invalidBranch.status, "rejected");
  assert.equal(
    JSON.stringify(
      reopened.timelineStore.view().timelines.map((timeline) => ({
        ...timeline,
        events: reopened.timelineStore.readTimeline(timeline.id),
      })),
    ),
    beforeInvalid,
  );

  resumed.submit({ type: "select-timeline", timelineId: sourceTimelineId });
  resumed.submit({ type: "choose-action", actionId: "force-side-door" });
  const sourceAfter = reopened.timelineStore.readTimeline(sourceTimelineId);
  const childBefore = reopened.timelineStore.readTimeline(childTimelineId);
  assert.equal(sourceAfter.at(-1)?.type, "CheckProposalCreated");
  assert.equal(childBefore.length, 3);

  resumed.submit({ type: "select-timeline", timelineId: childTimelineId });
  resumed.submit({ type: "choose-action", actionId: "survey-manor" });
  assert.deepEqual(reopened.timelineStore.readTimeline(sourceTimelineId), sourceAfter);
  assert.equal(
    reopened.timelineStore.readTimeline(childTimelineId).at(-1)?.type,
    "FreeActionCompleted",
  );
  const beforeRestart = reopened.timelineStore.view();
  reopened.close();

  const restarted = createLocalAdventureRepository(directory).open(adventure.id);
  assert.deepEqual(restarted.timelineStore.view(), beforeRestart);
  assert.deepEqual(restarted.timelineStore.readTimeline(sourceTimelineId), sourceAfter);
  assert.equal(
    restarted.timelineStore.readTimeline(childTimelineId).at(-1)?.type,
    "FreeActionCompleted",
  );
  restarted.close();
});
