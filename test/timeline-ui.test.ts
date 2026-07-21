import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryTimelineStore,
  createStructuredPlayApplication,
  DEFAULT_PLAYER_ACTOR_SCOPE,
  GAME_MASTER_ACTOR_SCOPE,
} from "../src/structured-play.js";
import { createTimelineWorkspace } from "../src/timeline-ui.js";

const playedTimeline = () => {
  const store = createInMemoryTimelineStore({ seed: 5 });
  const app = createStructuredPlayApplication({ timelineStore: store });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  app.submit({ type: "begin-adventure" });
  app.submit({ type: "choose-action", actionId: "force-side-door" });
  return { app, store };
};

test("Timeline workspace branches without changing its source and attributes divergence", () => {
  const { app, store } = playedTimeline();
  const sourceId = store.view().activeTimelineId;
  const sourceEvents = store.readTimeline(sourceId);
  const workspace = createTimelineWorkspace({
    timelineStore: store,
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
  });

  const branch = workspace.branch(3);
  assert.equal(branch.status, "accepted");
  assert.deepEqual(store.readTimeline(sourceId), sourceEvents);
  assert.equal(branch.workspace.activeTimeline.parentTimelineId, sourceId);
  assert.equal(branch.workspace.activeTimeline.branchEventPosition, 3);
  assert.equal(branch.workspace.activeTimeline.randomPosition, 0);

  const proposal = app.view().state.pendingCheckProposal;
  assert.ok(proposal);
  app.submit({ type: "withdraw-check-proposal", proposalId: proposal.id });
  const compared = workspace.view(sourceId);
  assert.equal(compared.comparison?.baselineTimelineId, sourceId);
  assert.equal(compared.comparison?.comparedTimelineId, branch.workspace.activeTimelineId);
  assert.deepEqual(compared.comparison?.events.added.map(({ type }) => type), [
    "CheckProposalWithdrawn",
  ]);
  assert.deepEqual(compared.comparison?.events.removed.map(({ type }) => type), []);
  assert.ok(compared.comparison?.commands.some(({ value }) =>
    value.includes("withdraw-check-proposal"),
  ));
  assert.equal("narration" in (compared.comparison ?? {}), false);
});

test("Timeline workspace preserves selection and projection while switching Timelines", () => {
  const { store } = playedTimeline();
  const workspace = createTimelineWorkspace({
    timelineStore: store,
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
  });
  const sourceId = store.view().activeTimelineId;
  const branched = workspace.branch(2);
  assert.equal(branched.status, "accepted");
  const branchId = branched.workspace.activeTimelineId;
  assert.equal(branched.workspace.activeTimeline.projection.scene, "arrival");

  const selected = workspace.select(sourceId, branchId);
  assert.equal(selected.status, "accepted");
  assert.equal(selected.workspace.activeTimelineId, sourceId);
  assert.equal(selected.workspace.comparison?.baselineTimelineId, branchId);

  const reopened = workspace.view(branchId);
  assert.equal(reopened.activeTimelineId, sourceId);
  assert.equal(reopened.timelines.find(({ id }) => id === branchId)?.parentTimelineId, sourceId);
  assert.equal(reopened.comparison?.comparedTimelineId, sourceId);
});

test("Timeline workspace filters sensitive detail at the actor boundary", () => {
  const { store } = playedTimeline();
  const player = createTimelineWorkspace({
    timelineStore: store,
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
  }).view();
  const gameMaster = createTimelineWorkspace({
    timelineStore: store,
    actorScope: GAME_MASTER_ACTOR_SCOPE,
  }).view();

  assert.ok(gameMaster.activeTimeline.worldKnowledge.length > player.activeTimeline.worldKnowledge.length);
  assert.ok(gameMaster.activeTimeline.events.length > player.activeTimeline.events.length);
  assert.ok(player.activeTimeline.worldKnowledge.every(({ visibility }) => visibility === "Player-visible"));
  assert.ok(player.activeTimeline.events.every(({ visibility }) => visibility === "Player-visible"));
  assert.equal(
    gameMaster.activeTimeline.events.find(({ type }) => type === "WorldKnowledgeEstablished")?.commandType,
    "begin-adventure",
  );
  assert.ok(store.readAll().every(({ commandType }) => commandType !== undefined));
});

test("Timeline comparison includes actor-visible World Knowledge differences", () => {
  const { app, store } = playedTimeline();
  const proposal = app.view().state.pendingCheckProposal;
  assert.ok(proposal);
  app.submit({ type: "withdraw-check-proposal", proposalId: proposal.id });
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const workspace = createTimelineWorkspace({
    timelineStore: store,
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
  });

  const branched = workspace.branch(2);
  assert.equal(branched.status, "accepted");
  assert.deepEqual(
    branched.workspace.comparison?.worldKnowledge.removed.map(({ id }) => id),
    ["fresh-footprints"],
  );
  assert.deepEqual(branched.workspace.comparison?.worldKnowledge.added, []);
});

test("Timeline workspace rejects invalid branches and unknown selections without mutation", () => {
  const { store } = playedTimeline();
  const workspace = createTimelineWorkspace({
    timelineStore: store,
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
  });
  const before = store.view();

  assert.equal(workspace.branch(0).status, "rejected");
  assert.equal(workspace.select("timeline-missing").status, "rejected");
  assert.deepEqual(store.view(), before);
});
