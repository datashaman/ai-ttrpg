import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAdventureCli } from "../src/adventure-cli.js";
import { createLocalAdventureRepository } from "../src/adventure-repository.js";
import { createStructuredPlayApplication } from "../src/structured-play.js";
import { scriptedIO } from "./support/scripted-io.js";

test("CLI creates, lists, and opens a durable Adventure without a model or storage argument", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-cli-"));
  const firstProcess = createLocalAdventureRepository(directory);
  const creation = scriptedIO([
    "Mara Vey",
    "she/her",
    "Find her missing sister",
    "0",
    "2",
    "1",
    "1",
    "s",
  ]);

  await runAdventureCli(["create", "The Locked Manor"], creation.io, firstProcess, {
    runToAdventureEnd: false,
  });

  const [summary] = firstProcess.list();
  assert.ok(summary);
  assert.equal(summary.name, "The Locked Manor");
  assert.equal(summary.eventCount, 3);
  assert.match(creation.output.join(""), /Created Adventure "The Locked Manor"/);

  const listing = scriptedIO([]);
  await runAdventureCli(["list"], listing.io, firstProcess);
  assert.match(listing.output.join(""), new RegExp(summary.id));
  assert.match(listing.output.join(""), /The Locked Manor/);

  const finishing = firstProcess.open(summary.id);
  createStructuredPlayApplication({ eventStore: finishing.eventStore }).submit({
    type: "choose-action",
    actionId: "withdraw-from-manor",
  });
  finishing.close();

  const secondProcess = createLocalAdventureRepository(directory);
  const reopening = scriptedIO([]);
  await runAdventureCli(["open", summary.id], reopening.io, secondProcess);
  const transcript = reopening.output.join("");
  assert.match(transcript, /Opened Adventure "The Locked Manor"/);
  assert.match(transcript, /Adventure ended unresolved/);
  assert.doesNotMatch(transcript, /language model|storage path/i);
});

test("CLI reports usage without creating an unnamed Adventure", async () => {
  const repository = createLocalAdventureRepository(
    mkdtempSync(join(tmpdir(), "ai-ttrpg-cli-")),
  );
  const script = scriptedIO([]);

  await runAdventureCli([], script.io, repository);

  assert.match(script.output.join(""), /create <name>\|list\|open <id>/);
  assert.deepEqual(repository.list(), []);
});
