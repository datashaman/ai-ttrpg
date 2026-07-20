import assert from "node:assert/strict";

import {
  createSeededRandomSource,
  type StructuredPlayOptions,
} from "../../src/structured-play.js";
import { beginAdventureFixture } from "./adventure-fixture.js";

export const reachLockedManorDiscovery = (
  applicationOptions: Omit<
    StructuredPlayOptions,
    "eventStore" | "randomSource" | "timelineStore"
  > = {},
) => {
  const fixture = beginAdventureFixture({
    randomSource: createSeededRandomSource(1),
    applicationOptions,
  });
  const proposed = fixture.app.submit({
    type: "choose-action",
    actionId: "pick-side-door-lock",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  const rolled = fixture.app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  assert.ok(rolled.state.pendingChoice);
  fixture.app.submit({
    type: "resolve-pending-check",
    pendingChoiceId: rolled.state.pendingChoice.id,
    choice: "decline",
  });
  fixture.app.submit({ type: "transition-scene", scene: "discovery" });
  return fixture;
};
