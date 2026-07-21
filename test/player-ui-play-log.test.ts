import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDeterministicPlayerSession } from "../src/player-ui/deterministic-player-session.js";
import { createJsonlPlayerUiPlayLog } from "../src/player-ui-play-log.js";
import type {
  PlayerUiPlayLog,
  PlayerUiPlayLogInput,
} from "../src/player-ui-play-log.js";

test("Player UI commands produce redacted durable operational records", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-player-log-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "player-ui.jsonl");
  const playLog = createJsonlPlayerUiPlayLog({
    path,
    now: () => "2026-07-21T10:00:00.000Z",
  });
  const session = createDeterministicPlayerSession("locked-manor", {
    sessionToken: "raw-cookie-must-not-leak",
    playLog,
  });
  const privateCommand = {
    type: "configure-player-character" as const,
    name: "Mara Private",
    pronouns: "secret/pronouns",
    motivation: "Find sk-private-api-key",
    traits: { Might: 0, Wits: 0, Presence: 0 } as const,
  };

  session.submit(privateCommand);
  session.submit({
    ...privateCommand,
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });

  const serialized = readFileSync(path, "utf8");
  const records = serialized
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(records.length, 2);
  const { durationMs, ...firstRecord } = records[0]!;
  assert.deepEqual(firstRecord, {
    schemaVersion: 1,
    timestamp: "2026-07-21T10:00:00.000Z",
    sessionId: "session:c02907035b84aeeb",
    adventureId: "locked-manor",
    commandType: "configure-player-character",
    status: "rejected",
    errorCode: "invalid-trait-assignment",
    sceneBefore: null,
    sceneAfter: null,
    appendedEvents: [],
    pendingChoiceBefore: false,
    pendingChoiceAfter: false,
    presentationStatus: "not-requested",
  });
  assert.equal(typeof durationMs, "number");
  assert.ok((durationMs as number) >= 0);
  assert.equal(records[1]!.status, "accepted");
  assert.equal(records[1]!.errorCode, null);
  assert.deepEqual(
    (records[1]!.appendedEvents as { readonly type: string }[]).map(
      (event) => event.type,
    ),
    ["PlayerCharacterConfigured"],
  );
  assert.match(
    (records[1]!.appendedEvents as { readonly id: string }[])[0]!.id,
    /^[0-9a-f-]{36}$/,
  );
  assert.doesNotMatch(
    serialized,
    /Mara Private|secret\/pronouns|sk-private-api-key|raw-cookie-must-not-leak/,
  );
});

test("a Scene transition log identifies its command, events, and presentation", () => {
  const records: PlayerUiPlayLogInput[] = [];
  const playLog: PlayerUiPlayLog = {
    recordCommand: (record) => records.push(record),
  };
  const session = createDeterministicPlayerSession("locked-manor", {
    sessionToken: "transition-session",
    playLog,
  });
  const submit = session.submit;
  const choose = (label: string) => {
    const action = session
      .projection()
      .availableActions.find((candidate) => candidate.label === label);
    assert.ok(action, `Missing action: ${label}`);
    submit({ type: "choose-action", actionId: action.id });
  };

  submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  submit({ type: "begin-adventure" });
  choose("Survey the manor grounds");
  choose("Ask whether someone is inside the manor");
  let projection = session.projection();
  submit({
    type: "confirm-oracle-likelihood",
    recommendationId: projection.oracleConfirmation!.id,
    likelihood: "Likely",
  });
  choose("Pick the side-door lock");
  projection = session.projection();
  submit({
    type: "confirm-check-proposal",
    proposalId: projection.pendingCheckProposal!.id,
  });
  projection = session.projection();
  submit({
    type: "resolve-pending-check",
    pendingChoiceId: projection.pendingChoice!.id,
    choice: "decline",
  });

  const transition = records.at(-1)!;
  assert.equal(transition.commandType, "resolve-pending-check");
  assert.equal(transition.status, "accepted");
  assert.equal(transition.sceneBefore, "arrival");
  assert.equal(transition.sceneAfter, "discovery");
  assert.equal(transition.pendingChoiceBefore, true);
  assert.equal(transition.pendingChoiceAfter, false);
  assert.equal(transition.presentationStatus, "deterministic-summary");
  assert.deepEqual(
    transition.appendedEvents.map((event) => event.type),
    ["CheckResolved", "SceneTransitioned"],
  );
});
