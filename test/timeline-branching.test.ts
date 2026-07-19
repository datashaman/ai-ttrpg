import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  type StructuredPlayApplication,
} from "../src/structured-play.js";
import { runStructuredPlay } from "../src/structured-play-runner.js";
import { scriptedIO } from "./support/scripted-io.js";

const configureAndPropose = () => {
  const timelineStore = createInMemoryTimelineStore({ seed: 5 });
  const app = createStructuredPlayApplication({ timelineStore });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "force-side-door" });
  return { app, timelineStore };
};

const revealAndResolvePendingCheck = (app: StructuredPlayApplication) => {
  const proposal = app.view().state.pendingCheckProposal;
  assert.ok(proposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposal.id,
  });
  assert.ok(revealed.state.pendingChoice);
  const resolved = app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: revealed.state.pendingChoice.id,
    choice: "decline",
  });
  assert.equal(resolved.status, "accepted");
  return { proposal, revealed, resolved };
};

test("branching at an accepted event preserves and can resume the source Timeline", () => {
  const { app, timelineStore } = configureAndPropose();
  const sourceTimelineId = timelineStore.view().activeTimelineId;
  const { proposal } = revealAndResolvePendingCheck(app);
  const sourceEvents = timelineStore.readTimeline(sourceTimelineId);

  const branched = app.submit({
    type: "branch-timeline",
    eventPosition: 3,
  });

  assert.equal(branched.status, "accepted");
  assert.notEqual(timelineStore.view().activeTimelineId, sourceTimelineId);
  assert.equal(timelineStore.view().activeTimeline.parentTimelineId, sourceTimelineId);
  assert.equal(timelineStore.view().activeTimeline.branchEventPosition, 4);
  assert.equal(branched.state.pendingCheckProposal?.id, proposal.id);
  assert.equal(branched.state.pendingChoice, null);
  assert.deepEqual(timelineStore.readTimeline(sourceTimelineId), sourceEvents);

  const selected = app.submit({
    type: "select-timeline",
    timelineId: sourceTimelineId,
  });
  assert.equal(selected.status, "accepted");
  assert.equal(selected.state.lastCheckResolution?.proposalId, proposal.id);
  assert.deepEqual(timelineStore.readTimeline(sourceTimelineId), sourceEvents);
});

test("a branch inherits the random position so identical play cannot reroll", () => {
  const { app, timelineStore } = configureAndPropose();
  const sourceTimelineId = timelineStore.view().activeTimelineId;
  const { revealed: sourceReveal } = revealAndResolvePendingCheck(app);
  assert.ok(sourceReveal.state.pendingChoice);
  const sourceInputs = sourceReveal.state.pendingChoice.roll.random.inputs;

  app.submit({ type: "branch-timeline", eventPosition: 3 });
  const matchingTimelineId = timelineStore.view().activeTimelineId;
  const branchProposal = app.view().state.pendingCheckProposal;
  assert.ok(branchProposal);
  const branchReveal = app.submit({
    type: "confirm-check-proposal",
    proposalId: branchProposal.id,
  });
  assert.ok(branchReveal.state.pendingChoice);

  assert.deepEqual(branchReveal.state.pendingChoice.roll.random.inputs, sourceInputs);
  assert.equal(timelineStore.view().activeTimeline.randomPosition, 2);

  app.submit({ type: "select-timeline", timelineId: sourceTimelineId });
  app.submit({ type: "branch-timeline", eventPosition: 3 });
  const divergentTimelineId = timelineStore.view().activeTimelineId;
  const divergentProposal = app.view().state.pendingCheckProposal;
  assert.ok(divergentProposal);
  app.submit({
    type: "withdraw-check-proposal",
    proposalId: divergentProposal.id,
  });

  assert.deepEqual(
    timelineStore.readTimeline(divergentTimelineId).map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "WorldKnowledgeEstablished",
      "SceneStarted",
      "CheckProposalCreated",
      "CheckProposalWithdrawn",
    ],
  );
  assert.deepEqual(
    timelineStore.readTimeline(matchingTimelineId).map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "WorldKnowledgeEstablished",
      "SceneStarted",
      "CheckProposalCreated",
      "CheckRollRevealed",
    ],
  );
  assert.deepEqual(
    timelineStore.readTimeline(sourceTimelineId).map((event) => event.type),
    [
      "PlayerCharacterConfigured",
      "WorldKnowledgeEstablished",
      "SceneStarted",
      "CheckProposalCreated",
      "CheckRollRevealed",
      "CheckResolved",
    ],
  );
});

test("a branch after a roll inherits the next random inputs", () => {
  const { app, timelineStore } = configureAndPropose();
  revealAndResolvePendingCheck(app);
  const sourceTimelineId = timelineStore.view().activeTimelineId;

  app.submit({ type: "branch-timeline", eventPosition: 5 });
  const branchTimelineId = timelineStore.view().activeTimelineId;
  assert.equal(timelineStore.view().activeTimeline.randomPosition, 2);

  app.submit({ type: "select-timeline", timelineId: sourceTimelineId });
  const sourceProposal = app.submit({
    type: "choose-action",
    actionId: "inspect-dark-entryway",
  });
  assert.ok(sourceProposal.state.pendingCheckProposal);
  const sourceReveal = app.submit({
    type: "confirm-check-proposal",
    proposalId: sourceProposal.state.pendingCheckProposal.id,
  });
  assert.ok(sourceReveal.state.pendingChoice);

  app.submit({ type: "select-timeline", timelineId: branchTimelineId });
  const branchProposal = app.submit({
    type: "choose-action",
    actionId: "inspect-dark-entryway",
  });
  assert.ok(branchProposal.state.pendingCheckProposal);
  const branchReveal = app.submit({
    type: "confirm-check-proposal",
    proposalId: branchProposal.state.pendingCheckProposal.id,
  });
  assert.ok(branchReveal.state.pendingChoice);

  assert.deepEqual(
    branchReveal.state.pendingChoice.roll.random.inputs,
    sourceReveal.state.pendingChoice.roll.random.inputs,
  );
  assert.equal(timelineStore.view().activeTimeline.randomPosition, 4);
});

test("application restart preserves Timeline relationships, selection, and random positions", () => {
  const { app, timelineStore } = configureAndPropose();
  const sourceTimelineId = timelineStore.view().activeTimelineId;
  revealAndResolvePendingCheck(app);
  app.submit({ type: "branch-timeline", eventPosition: 3 });
  const beforeRestart = app.view();

  const restarted = createStructuredPlayApplication({ timelineStore }).view();

  assert.deepEqual(restarted, beforeRestart);
  assert.equal(restarted.timeline?.timelines.length, 2);
  assert.equal(restarted.timeline?.activeTimeline.parentTimelineId, sourceTimelineId);
  assert.deepEqual(
    restarted.timeline?.timelines.map((timeline) => timeline.randomPosition),
    [2, 0],
  );
});

test("branching rejects positions that do not identify an accepted event", () => {
  const { app, timelineStore } = configureAndPropose();
  const before = timelineStore.view();

  const beforeFirstEvent = app.submit({
    type: "branch-timeline",
    eventPosition: 0,
  });
  const afterLastEvent = app.submit({
    type: "branch-timeline",
    eventPosition: 4,
  });

  assert.equal(beforeFirstEvent.status, "rejected");
  assert.equal(
    beforeFirstEvent.status === "rejected" ? beforeFirstEvent.code : null,
    "invalid-timeline-position",
  );
  assert.equal(afterLastEvent.status, "rejected");
  assert.deepEqual(timelineStore.view(), before);
});

test("Oracle and Check inputs share the inherited Timeline random stream", () => {
  const timelineStore = createInMemoryTimelineStore({ seed: 140 });
  const app = createStructuredPlayApplication({ timelineStore });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const recommended = app.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  });
  assert.ok(recommended.state.pendingNarratorRecommendation);
  app.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommended.state.pendingNarratorRecommendation.id,
    likelihood: "Likely",
  });
  const sourceTimelineId = timelineStore.view().activeTimelineId;
  assert.equal(timelineStore.view().activeTimeline.randomPosition, 1);

  app.submit({ type: "branch-timeline", eventPosition: 5 });
  const branchTimelineId = timelineStore.view().activeTimelineId;
  app.submit({ type: "select-timeline", timelineId: sourceTimelineId });
  const sourceProposal = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(sourceProposal.state.pendingCheckProposal);
  const sourceReveal = app.submit({
    type: "confirm-check-proposal",
    proposalId: sourceProposal.state.pendingCheckProposal.id,
  });
  assert.ok(sourceReveal.state.pendingChoice);

  app.submit({ type: "select-timeline", timelineId: branchTimelineId });
  const branchProposal = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(branchProposal.state.pendingCheckProposal);
  const branchReveal = app.submit({
    type: "confirm-check-proposal",
    proposalId: branchProposal.state.pendingCheckProposal.id,
  });
  assert.ok(branchReveal.state.pendingChoice);

  assert.deepEqual(
    branchReveal.state.pendingChoice.roll.random.inputs,
    sourceReveal.state.pendingChoice.roll.random.inputs,
  );
  assert.equal(timelineStore.view().activeTimeline.randomPosition, 3);
});

test("the Player can branch at an accepted event through Structured Play", async () => {
  const timelineStore = createInMemoryTimelineStore({ seed: 5 });
  const app = createStructuredPlayApplication({ timelineStore });
  const sourceTimelineId = timelineStore.view().activeTimelineId;
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const branchIndex = app
    .view()
    .availableActions.findIndex((action) => action.id === "branch-timeline");
  assert.notEqual(branchIndex, -1);
  const script = scriptedIO([String(branchIndex + 1), "2"]);

  const branched = await runStructuredPlay({ io: script.io, timelineStore });

  assert.equal(branched.timeline?.timelines.length, 2);
  assert.equal(branched.timeline?.activeTimeline.branchEventPosition, 2);
  assert.equal(branched.state.activeScene, "arrival");
  assert.deepEqual(branched.state.establishedFacts, []);
  assert.match(script.output.join(""), /1\. PlayerCharacterConfigured/);
  assert.match(script.output.join(""), /2\. SceneStarted/);
  assert.match(script.output.join(""), /3\. FreeActionCompleted/);
  assert.match(script.output.join(""), /accepted event position/i);

  const selectionIndex = app
    .view()
    .availableActions.findIndex(
      (action) => action.id === `select-timeline:${sourceTimelineId}`,
    );
  assert.notEqual(selectionIndex, -1);
  const selection = scriptedIO([String(selectionIndex + 1)]);
  const resumedSource = await runStructuredPlay({
    io: selection.io,
    timelineStore,
  });

  assert.equal(resumedSource.timeline?.activeTimelineId, sourceTimelineId);
  assert.deepEqual(resumedSource.state.establishedFacts, [
    {
      id: "fresh-footprints",
      text: "Fresh footprints lead from the manor gate toward a dark side entrance.",
    },
  ]);
});
