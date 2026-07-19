import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAdventureCli } from "../src/adventure-cli.js";
import { createLocalAdventureRepository } from "../src/adventure-repository.js";
import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type CanonicalEvent,
  type EventStore,
  type RandomSource,
} from "../src/structured-play.js";
import { createSeededRandomSourceAtPosition } from "../src/random-source.js";
import {
  runNaturalLanguagePlay,
  type InterpretationModel,
} from "../src/natural-language-play.js";
import type { PresentationModel } from "../src/structured-play-runner.js";
import { scriptedIO } from "./support/scripted-io.js";

const beginDurableAdventure = () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-decisions-"));
  const repository = createLocalAdventureRepository(directory);
  const adventure = repository.create("Interrupted at the Manor");
  const app = createStructuredPlayApplication({
    eventStore: adventure.eventStore,
    randomSource: adventure.randomSource,
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 0, Wits: 2, Presence: 1 },
  });
  app.submit({ type: "begin-adventure" });
  return { directory, repository, adventure, app };
};

const copiedStore = (events: readonly CanonicalEvent[]): EventStore => {
  const store = createInMemoryEventStore();
  events.forEach((event) => store.append(structuredClone(event)));
  return store;
};

const sourceAt = (source: RandomSource): RandomSource => {
  const seed = source.metadata().seed;
  assert.notEqual(seed, null);
  return createSeededRandomSourceAtPosition(seed!, source.position());
};

const payloads = (events: readonly CanonicalEvent[]): string =>
  JSON.stringify(
    events.map((event) => ({ type: event.type, payload: event.payload })),
    (_key, value: unknown) =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
        ? "<id>"
        : value,
  );

test("reopening a durable Check Proposal restores every Player choice and uninterrupted resolution", async () => {
  const { directory, adventure, app } = beginDurableAdventure();
  const proposed = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  const proposal = proposed.state.pendingCheckProposal;
  assert.ok(proposal);
  const beforeClose = JSON.stringify(app.view());

  const controlStore = copiedStore(adventure.eventStore.readAll());
  const control = createStructuredPlayApplication({
    eventStore: controlStore,
    randomSource: sourceAt(adventure.randomSource),
  });
  control.submit({ type: "confirm-check-proposal", proposalId: proposal.id });
  const controlChoice = control.view().state.pendingChoice;
  assert.ok(controlChoice);
  control.submit({
    type: "resolve-pending-check",
    pendingChoiceId: controlChoice.id,
    choice: "decline",
  });
  const expectedEvents = controlStore.readAll().slice(-2);
  adventure.close();

  const reopenedRepository = createLocalAdventureRepository(directory);
  const reopened = reopenedRepository.open(adventure.id);
  assert.equal(
    JSON.stringify(
      createStructuredPlayApplication({
        eventStore: reopened.eventStore,
        randomSource: reopened.randomSource,
      }).view(),
    ),
    beforeClose,
  );
  reopened.close();

  const script = scriptedIO(["c", "d"]);
  await runAdventureCli(
    ["open", adventure.id],
    script.io,
    reopenedRepository,
    { runToAdventureEnd: false },
  );

  const transcript = script.output.join("");
  assert.match(transcript, /Resuming Check Proposal/);
  assert.match(transcript, new RegExp(proposal.goal));
  assert.match(transcript, new RegExp(`Trait: ${proposal.trait}`));
  assert.match(transcript, /Setback:/);
  assert.match(transcript, /Success with Cost:/);
  assert.match(transcript, /Clean Success:/);
  assert.match(
    transcript,
    /Confirm \(c\), correct goal \(g\), correct Trait \(t\), revise action \(r\), or withdraw \(w\)/,
  );
  const completed = reopenedRepository.open(adventure.id);
  assert.equal(payloads(completed.eventStore.readAll().slice(-2)), payloads(expectedEvents));
  completed.close();
});

test("reopening a revealed roll restores the exact Pending Choice without model authority or rerolling", async () => {
  const { directory, adventure, app } = beginDurableAdventure();
  const proposed = app.submit({
    type: "choose-action",
    actionId: "force-side-door",
  });
  assert.ok(proposed.state.pendingCheckProposal);
  app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  const pendingChoice = app.view().state.pendingChoice;
  assert.ok(pendingChoice);
  const beforeClose = JSON.stringify(app.view());

  const controlStore = copiedStore(adventure.eventStore.readAll());
  const control = createStructuredPlayApplication({
    eventStore: controlStore,
    randomSource: sourceAt(adventure.randomSource),
  });
  control.submit({
    type: "resolve-pending-check",
    pendingChoiceId: pendingChoice.id,
    choice: "decline",
  });
  const expectedEvent = controlStore.readAll().at(-1)!;
  const expectedOutcome = control.view().state.lastCheckResolution?.outcome;
  adventure.close();

  const reopenedRepository = createLocalAdventureRepository(directory);
  const reopened = reopenedRepository.open(adventure.id);
  assert.equal(reopened.randomSource.position(), 2);
  assert.equal(
    JSON.stringify(
      createStructuredPlayApplication({
        eventStore: reopened.eventStore,
        randomSource: reopened.randomSource,
      }).view(),
    ),
    beforeClose,
  );
  let interpretationCalls = 0;
  const interpreter: InterpretationModel = {
    interpret: async () => {
      interpretationCalls += 1;
      throw new Error("model unavailable");
    },
  };
  const narrator: PresentationModel = {
    narrate: async () => {
      throw new Error("model unavailable");
    },
    explainRules: async () => {
      throw new Error("model unavailable");
    },
  };
  const script = scriptedIO(["d", "c"]);
  const result = await runNaturalLanguagePlay({
    io: script.io,
    interpreter,
    narrator,
    eventStore: reopened.eventStore,
    randomSource: reopened.randomSource,
  });

  assert.equal(interpretationCalls, 0);
  assert.equal(reopened.randomSource.position(), 2);
  assert.equal(result.state.pendingChoice, null);
  assert.equal(result.state.lastCheckResolution?.outcome, expectedOutcome);
  assert.equal(
    payloads(reopened.eventStore.readAll().slice(-1)),
    payloads([expectedEvent]),
  );
  const transcript = script.output.join("");
  assert.match(transcript, /Resuming Pending Choice/);
  assert.match(transcript, new RegExp(pendingChoice.roll.random.inputs.join(", ")));
  assert.match(transcript, /Modifiers: Might \+0/);
  assert.match(
    transcript,
    new RegExp(
      `Roll: ${pendingChoice.roll.result.diceTotal} \\+ 0 = ${pendingChoice.roll.result.total}`,
    ),
  );
  assert.match(transcript, /Spend 1 Resolve \(s\) or decline \(d\)/);
  assert.match(transcript, /Narration \(deterministic fallback\)/);
  reopened.close();
});

test("reopening a Narrator Likelihood recommendation restores evidence and the uninterrupted Oracle answer", async () => {
  const { directory, adventure, app } = beginDurableAdventure();
  app.submit({ type: "choose-action", actionId: "survey-manor" });
  const recommended = app.submit({
    type: "choose-action",
    actionId: "ask-someone-inside-manor",
  });
  const recommendation = recommended.state.pendingNarratorRecommendation;
  assert.ok(recommendation);
  const beforeClose = JSON.stringify(app.view());

  const controlStore = copiedStore(adventure.eventStore.readAll());
  const control = createStructuredPlayApplication({
    eventStore: controlStore,
    randomSource: sourceAt(adventure.randomSource),
  });
  control.submit({
    type: "confirm-oracle-likelihood",
    recommendationId: recommendation.id,
    likelihood: "Unlikely",
  });
  const expectedEvent = controlStore.readAll().at(-1)!;
  adventure.close();

  const reopenedRepository = createLocalAdventureRepository(directory);
  const reopened = reopenedRepository.open(adventure.id);
  assert.equal(
    JSON.stringify(
      createStructuredPlayApplication({
        eventStore: reopened.eventStore,
        randomSource: reopened.randomSource,
      }).view(),
    ),
    beforeClose,
  );
  reopened.close();

  const script = scriptedIO(["u"]);
  await runAdventureCli(
    ["open", adventure.id],
    script.io,
    reopenedRepository,
    { runToAdventureEnd: false },
  );

  const transcript = script.output.join("");
  assert.match(transcript, /Resuming Narrator Likelihood recommendation/);
  assert.match(transcript, new RegExp(recommendation.proposition.text.replace("?", "\\?")));
  assert.match(transcript, /Narrator recommendation: Likely/);
  assert.match(transcript, new RegExp(recommendation.evidence[0]!.text));
  assert.match(transcript, /Unlikely \(u\), Even \(e\), Likely \(l\)/);
  const completed = reopenedRepository.open(adventure.id);
  assert.equal(
    payloads(completed.eventStore.readAll().slice(-1)),
    payloads([expectedEvent]),
  );
  completed.close();
});
