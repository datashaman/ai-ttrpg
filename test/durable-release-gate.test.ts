import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInMemoryAdventureRepository,
  createLocalAdventureRepository,
  type AdventureRepository,
  type OpenAdventure,
} from "../src/adventure-repository.js";
import {
  createStructuredPlayApplication,
  type CanonicalEvent,
  type CheckActionDefinition,
  type StructuredPlayApplication,
  type StructuredPlayOptions,
} from "../src/structured-play.js";
import { canonicalV1Fixtures } from "./support/canonical-v1-fixtures.js";

type ApplicationOptions = Omit<
  StructuredPlayOptions,
  "eventStore" | "randomSource" | "timelineStore"
>;

const repositoryDirectory = (): string =>
  mkdtempSync(join(tmpdir(), "ai-ttrpg-durable-gate-"));

const repositoryFactories = [
  {
    name: "in-memory",
    create: (): AdventureRepository => createInMemoryAdventureRepository(),
  },
  {
    name: "local durable",
    create: (): AdventureRepository =>
      createLocalAdventureRepository(repositoryDirectory()),
  },
] as const;

const application = (
  adventure: OpenAdventure,
  options: ApplicationOptions = {},
): StructuredPlayApplication =>
  createStructuredPlayApplication({
    ...options,
    timelineStore: adventure.timelineStore,
  });

const configure = (app: StructuredPlayApplication): void => {
  const result = app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits: { Might: 2, Wits: 1, Presence: 0 },
  });
  assert.equal(result.status, "accepted");
};

const begin = (app: StructuredPlayApplication): void => {
  assert.equal(app.submit({ type: "begin-adventure" }).status, "accepted");
};

const resolvePendingCheck = (app: StructuredPlayApplication): void => {
  const pendingChoice = app.view().state.pendingChoice;
  assert.ok(pendingChoice);
  assert.equal(
    app.submit({
      type: "resolve-pending-check",
      pendingChoiceId: pendingChoice.id,
      choice: "decline",
    }).status,
    "accepted",
  );
};

const revealCheck = (
  app: StructuredPlayApplication,
  actionId: string,
): void => {
  const proposed = app.submit({ type: "choose-action", actionId });
  assert.equal(proposed.status, "accepted");
  assert.ok(proposed.state.pendingCheckProposal);
  const revealed = app.submit({
    type: "confirm-check-proposal",
    proposalId: proposed.state.pendingCheckProposal.id,
  });
  assert.equal(revealed.status, "accepted");
  assert.ok(revealed.state.pendingChoice);
};

const normalizedAdventure = (
  adventure: OpenAdventure,
  options: ApplicationOptions = {},
): string => {
  const timeline = adventure.timelineStore.view();
  return JSON.stringify({
    events: timeline.timelines.map(({ id }) => ({
      timelineId: id,
      events: adventure.timelineStore.readTimeline(id),
    })),
    projection: application(adventure, options).view().state,
    timeline,
    activeTimelineId: timeline.activeTimelineId,
    randomPosition: adventure.randomSource.position(),
  });
};

const assertRestartAt = (
  name: string,
  drive: (app: StructuredPlayApplication, adventure: OpenAdventure) => void,
  options: ApplicationOptions = {},
): void => {
  const directory = repositoryDirectory();
  const firstProcess = createLocalAdventureRepository(directory);
  const adventure = firstProcess.create(`Restart at ${name}`);
  const app = application(adventure, options);
  configure(app);
  begin(app);
  drive(app, adventure);
  const beforeRestart = normalizedAdventure(adventure, options);
  const adventureId = adventure.id;
  adventure.close();

  const reopened = createLocalAdventureRepository(directory).open(adventureId);
  assert.equal(normalizedAdventure(reopened, options), beforeRestart);
  reopened.close();
};

const injuredAction: CheckActionDefinition = {
  id: "cross-broken-floor",
  label: "Cross the broken floor",
  kind: "Check",
  goal: "Cross the broken floor",
  trait: "Might",
  stakes: {
    Setback: {
      summary: "The broken floor causes harm.",
      consequences: [{ type: "lose-health", amount: 1 }],
    },
    "Success with Cost": {
      summary: "The crossing causes harm.",
      consequences: [{ type: "lose-health", amount: 1 }],
    },
    "Clean Success": {
      summary: "The crossing still causes harm.",
      consequences: [{ type: "lose-health", amount: 1 }],
    },
  },
};

const injuryOptions: ApplicationOptions = {
  checkActions: [injuredAction],
  oracleActions: [],
  freeActions: [],
  sceneTransitions: [],
  adventureEndings: [],
};

const confrontationAction: CheckActionDefinition = {
  id: "drive-back-guardian",
  label: "Drive back the guardian",
  kind: "Check",
  goal: "Drive the guardian back",
  trait: "Might",
  availableInScenes: ["confrontation"],
  repeatable: true,
  stakes: {
    Setback: {
      summary: "The guardian yields ground at a cost.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
      ],
    },
    "Success with Cost": {
      summary: "The guardian yields ground at a cost.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
      ],
    },
    "Clean Success": {
      summary: "The guardian yields ground.",
      consequences: [
        { type: "advance-clock", clock: "Resistance", amount: 1 },
      ],
    },
  },
};

const confrontationOptions: ApplicationOptions = {
  checkActions: [confrontationAction],
  oracleActions: [],
  freeActions: [
    {
      id: "enter-cellar",
      label: "Enter the cellar",
      kind: "Free Action",
      establishedFact: {
        id: "cellar-entered",
        text: "Mara enters the cellar.",
      },
      availableInScenes: ["arrival"],
      requiredFactIds: [],
    },
  ],
  sceneTransitions: [
    {
      from: "arrival",
      to: "confrontation",
      requiredFactIds: ["cellar-entered"],
      automatic: true,
    },
  ],
  adventureEndings: [],
  confrontation: {
    id: "cellar-guardian",
    resistanceClock: {
      capacity: 2,
      fillingConsequence: {
        id: "guardian-overcome",
        text: "The cellar guardian is overcome.",
      },
    },
    dangerClock: {
      capacity: 2,
      fillingConsequence: {
        id: "guardian-prevails",
        text: "The cellar guardian prevails.",
      },
    },
    healthZeroConsequence: {
      id: "mara-overcome",
      text: "Mara is overcome in the cellar.",
    },
    defeatEffects: [],
  },
};

test("every canonical durability checkpoint reopens byte-equivalently", async (t) => {
  const checkpoints: ReadonlyArray<{
    name: string;
    options?: ApplicationOptions;
    drive(app: StructuredPlayApplication, adventure: OpenAdventure): void;
  }> = [
    {
      name: "Check Proposal",
      drive: (app) => {
        assert.equal(
          app.submit({ type: "choose-action", actionId: "force-side-door" })
            .status,
          "accepted",
        );
        assert.ok(app.view().state.pendingCheckProposal);
      },
    },
    {
      name: "revealed Pending Choice",
      drive: (app) => {
        revealCheck(app, "force-side-door");
      },
    },
    {
      name: "Check resolution",
      drive: (app) => {
        revealCheck(app, "force-side-door");
        resolvePendingCheck(app);
      },
    },
    {
      name: "Oracle recommendation",
      drive: (app) => {
        app.submit({ type: "choose-action", actionId: "survey-manor" });
        const result = app.submit({
          type: "choose-action",
          actionId: "ask-someone-inside-manor",
        });
        assert.equal(result.status, "accepted");
        assert.ok(result.state.pendingNarratorRecommendation);
      },
    },
    {
      name: "Oracle answer",
      drive: (app) => {
        app.submit({ type: "choose-action", actionId: "survey-manor" });
        const recommended = app.submit({
          type: "choose-action",
          actionId: "ask-someone-inside-manor",
        });
        assert.ok(recommended.state.pendingNarratorRecommendation);
        assert.equal(
          app.submit({
            type: "confirm-oracle-likelihood",
            recommendationId:
              recommended.state.pendingNarratorRecommendation.id,
            likelihood: "Even",
          }).status,
          "accepted",
        );
        assert.ok(app.view().state.lastOracleResolution);
      },
    },
    {
      name: "Inventory Item use",
      options: injuryOptions,
      drive: (app) => {
        revealCheck(app, injuredAction.id);
        resolvePendingCheck(app);
        assert.equal(
          app.submit({ type: "use-field-kit", resource: "Health" }).status,
          "accepted",
        );
      },
    },
    {
      name: "Scene transition",
      options: confrontationOptions,
      drive: (app) => {
        assert.equal(
          app.submit({ type: "choose-action", actionId: "enter-cellar" })
            .status,
          "accepted",
        );
        assert.equal(app.view().state.activeScene, "confrontation");
      },
    },
    {
      name: "Confrontation exchange",
      options: confrontationOptions,
      drive: (app) => {
        app.submit({ type: "choose-action", actionId: "enter-cellar" });
        revealCheck(app, confrontationAction.id);
        resolvePendingCheck(app);
        assert.equal(app.view().state.confrontation?.resistanceClock.current, 1);
      },
    },
    {
      name: "Adventure ending",
      drive: (app) => {
        app.submit({ type: "choose-action", actionId: "survey-manor" });
        assert.equal(
          app.submit({
            type: "choose-action",
            actionId: "withdraw-from-manor",
          }).status,
          "accepted",
        );
        assert.ok(app.view().state.adventureEnding);
      },
    },
    {
      name: "Timeline branch",
      drive: (app) => {
        assert.equal(
          app.submit({ type: "branch-timeline", eventPosition: 2 }).status,
          "accepted",
        );
      },
    },
    {
      name: "Timeline selection",
      drive: (app, adventure) => {
        const sourceTimelineId = adventure.timelineStore.view().activeTimelineId;
        app.submit({ type: "branch-timeline", eventPosition: 2 });
        assert.equal(
          app.submit({ type: "select-timeline", timelineId: sourceTimelineId })
            .status,
          "accepted",
        );
      },
    },
  ];

  for (const checkpoint of checkpoints) {
    await t.test(checkpoint.name, () => {
      assertRestartAt(
        checkpoint.name,
        checkpoint.drive,
        checkpoint.options ?? {},
      );
    });
  }
});

test("every repository adapter pair round-trips the complete portable Adventure", async (t) => {
  for (const sourceFactory of repositoryFactories) {
    for (const destinationFactory of repositoryFactories) {
      await t.test(
        `${sourceFactory.name} to ${destinationFactory.name}`,
        () => {
          const sourceRepository = sourceFactory.create();
          const source = sourceRepository.create("The Portable Gate");
          const sourceApp = application(source);
          configure(sourceApp);
          begin(sourceApp);
          sourceApp.submit({
            type: "choose-action",
            actionId: "survey-manor",
          });
          sourceApp.submit({ type: "branch-timeline", eventPosition: 2 });
          const expected = normalizedAdventure(source);
          const archive = sourceRepository.exportArchive(source.id);
          source.close();

          const imported = destinationFactory.create().importArchive(archive);
          assert.equal(normalizedAdventure(imported), expected);
          imported.close();
        },
      );
    }
  }
});

const appendCanonicalHistory = (
  adventure: OpenAdventure,
  events: readonly CanonicalEvent[],
): void => {
  let position = 0;
  while (position < events.length) {
    const idempotencyKey = events[position]!.causationId;
    let end = position + 1;
    while (
      end < events.length &&
      events[end]!.causationId === idempotencyKey
    ) {
      end += 1;
    }
    const result = adventure.eventStore.appendBatch({
      expectedPosition: position,
      idempotencyKey,
      events: events.slice(position, end),
    });
    assert.equal(result.status, "accepted");
    position = end;
  }
};

test("every canonical v1 fixture survives durable close and reopen", async (t) => {
  for (const fixture of await canonicalV1Fixtures()) {
    await t.test(fixture.name, () => {
      const directory = repositoryDirectory();
      const adventure = createLocalAdventureRepository(directory).create(
        `Durable ${fixture.name}`,
      );
      appendCanonicalHistory(adventure, fixture.eventStore.readAll());
      assert.equal(
        JSON.stringify(application(adventure).view().state),
        JSON.stringify(fixture.state),
      );
      const beforeRestart = normalizedAdventure(adventure);
      const adventureId = adventure.id;
      adventure.close();

      const reopened = createLocalAdventureRepository(directory).open(
        adventureId,
      );
      assert.equal(normalizedAdventure(reopened), beforeRestart);
      reopened.close();
    });
  }
});

test("Structured Play completes a durable Adventure across process-facing restarts without a model", () => {
  const directory = repositoryDirectory();
  const adventure = createLocalAdventureRepository(directory).create(
    "The Restarted Manor",
  );
  const adventureId = adventure.id;
  let current = adventure;

  const restart = (): void => {
    const beforeRestart = normalizedAdventure(current);
    current.close();
    current = createLocalAdventureRepository(directory).open(adventureId);
    assert.equal(normalizedAdventure(current), beforeRestart);
  };

  configure(application(current));
  restart();
  begin(application(current));
  restart();
  assert.equal(
    application(current).submit({
      type: "choose-action",
      actionId: "survey-manor",
    }).status,
    "accepted",
  );
  restart();
  assert.equal(
    application(current).submit({
      type: "choose-action",
      actionId: "withdraw-from-manor",
    }).status,
    "accepted",
  );
  restart();
  assert.equal(
    application(current).view().state.adventureEnding?.id,
    "withdrawal-without-answers",
  );
  current.close();
});

test("a 10,000-event durable fixture replays repeatedly without projection divergence", () => {
  const directory = repositoryDirectory();
  const repository = createLocalAdventureRepository(directory);
  const adventure = repository.create("The Long Manor");
  const app = application(adventure);
  configure(app);
  begin(app);

  const events: CanonicalEvent[] = Array.from(
    { length: 9_997 },
    (_, index): CanonicalEvent => {
      const sequence = index + 4;
      return {
        id: `large-fixture-event-${sequence}`,
        streamId: "adventure",
        sequence,
        type: "FreeActionCompleted",
        schemaVersion: 1,
        timestamp: "2026-07-19T00:00:00.000Z",
        origin: "structured-play",
        correlationId: `large-fixture-command-${sequence}`,
        causationId: "large-fixture",
        payload: {
          actionId: "record-long-history",
          establishedFact: {
            id: "long-history-recorded",
            text: "The long Adventure history remains established.",
          },
        },
      };
    },
  );
  const appended = adventure.eventStore.appendBatch({
    expectedPosition: 3,
    idempotencyKey: "large-fixture",
    events,
  });
  assert.equal(appended.status, "accepted");
  assert.equal(adventure.eventStore.readAll().length, 10_000);
  const expectedProjection = JSON.stringify(application(adventure).view().state);
  const adventureId = adventure.id;
  adventure.close();

  for (let replay = 0; replay < 3; replay += 1) {
    const reopened = createLocalAdventureRepository(directory).open(adventureId);
    assert.equal(reopened.eventStore.readAll().length, 10_000);
    assert.equal(
      JSON.stringify(application(reopened).view().state),
      expectedProjection,
    );
    reopened.close();
  }
});
