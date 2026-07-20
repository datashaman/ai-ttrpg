import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInMemoryAdventureRepository,
  createLocalAdventureRepository,
} from "../src/adventure-repository.js";
import { canonicalHistoryRevision } from "../src/canonical-history-revision.js";
import {
  parseAdventureMarkdown,
  renderAdventureMarkdown,
  reviewAdventureMarkdownEdit,
} from "../src/adventure-markdown.js";
import {
  createStructuredPlayApplication,
  type CanonicalEvent,
} from "../src/structured-play.js";
import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  GAME_MASTER_ACTOR_SCOPE,
} from "../src/world-knowledge.js";
import { beginAdventureFixture } from "./support/adventure-fixture.js";

const renderInput = (events: readonly CanonicalEvent[]) => ({
  adventureId: "adventure:locked-manor",
  adventureName: "The Locked Manor",
  timelineId: "timeline:primary",
  actorScope: GAME_MASTER_ACTOR_SCOPE,
  events,
});

const editFrontmatter = (
  markdown: string,
  edit: (document: Record<string, unknown>) => void,
): string => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(match);
  const document = JSON.parse(match[1]!) as Record<string, unknown>;
  edit(document);
  return markdown.replace(match[1]!, JSON.stringify(document, null, 2));
};

const revealCellarGuardian = (markdown: string): string =>
  editFrontmatter(markdown, (document) => {
    const entities = document.entities as Array<Record<string, unknown>>;
    const target = entities.find(
      (entry) => entry.id === "cellar-guardian-identity",
    );
    assert.ok(target);
    target.visibility = "Player-visible";
    target.knowledgeScope = ["Game Master", "Player Character"];
  });

test("Adventure Markdown round-trips structured World Knowledge and descriptive prose", () => {
  const { eventStore } = beginAdventureFixture();
  const rendered = renderAdventureMarkdown(renderInput(eventStore.readAll()));

  const parsed = parseAdventureMarkdown(rendered.markdown);

  assert.deepEqual(parsed, rendered.document);
  assert.equal(parsed.format, "ai-ttrpg-adventure-markdown-v1");
  assert.match(parsed.revision, /^[0-9a-f]{64}$/);
  assert.equal(parsed.adventureId, "adventure:locked-manor");
  assert.equal(parsed.timelineId, "timeline:primary");
  assert.ok(
    parsed.entities.some(
      (entry) =>
        entry.id === "cellar-guardian-identity" &&
        entry.visibility === "Game Master-only" &&
        entry.knowledgeScope.includes("Game Master") &&
        entry.provenance.originKind === "authored-content",
    ),
  );
  assert.ok(
    parsed.relationships.some(
      (entry) =>
        entry.id === "housekeeper-guards-cellar" &&
        entry.sourceId === "manor-housekeeper" &&
        entry.targetId === "manor-cellar",
    ),
  );
  assert.deepEqual(parsed.events, eventStore.readAll());
  assert.match(rendered.markdown, /# The Locked Manor World Knowledge/);
  assert.match(rendered.markdown, /## Established Facts/);
  assert.match(rendered.markdown, /## Relationships/);
  assert.match(rendered.markdown, /housekeeper guards the cellar/i);
  assert.equal(Object.isFrozen(rendered), true);
  assert.equal(Object.isFrozen(rendered.document.entities), true);

  const playerRendered = renderAdventureMarkdown({
    ...renderInput(eventStore.readAll()),
    actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
  });
  assert.deepEqual(
    parseAdventureMarkdown(playerRendered.markdown),
    playerRendered.document,
  );
});

test("an unchanged reread is idempotent and creates no command", () => {
  const { eventStore } = beginAdventureFixture();
  const before = structuredClone(eventStore.readAll());
  const rendered = renderAdventureMarkdown(renderInput(before));

  const review = reviewAdventureMarkdownEdit({
    base: rendered.document,
    editedMarkdown: rendered.markdown,
    current: renderInput(eventStore.readAll()),
    reviewerScope: GAME_MASTER_ACTOR_SCOPE,
  });

  assert.deepEqual(review, { status: "unchanged" });
  assert.deepEqual(eventStore.readAll(), before);
});

test("one reviewed Markdown Reveal changes World Knowledge only after its command commits", () => {
  const { app, eventStore } = beginAdventureFixture();
  const rendered = renderAdventureMarkdown(
    renderInput(eventStore.readAll()),
  );
  const editedMarkdown = revealCellarGuardian(rendered.markdown);
  const before = structuredClone(eventStore.readAll());

  const review = reviewAdventureMarkdownEdit({
    base: rendered.document,
    editedMarkdown,
    current: renderInput(eventStore.readAll()),
    reviewerScope: GAME_MASTER_ACTOR_SCOPE,
  });

  assert.equal(review.status, "command");
  if (review.status !== "command") return;
  assert.equal(review.command.type, "review-world-knowledge-reveal");
  assert.equal(
    review.command.worldKnowledgeId,
    "cellar-guardian-identity",
  );
  assert.equal(Object.isFrozen(review.command), true);
  assert.deepEqual(eventStore.readAll(), before);
  assert.equal(
    app.worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE).entries.some(
      (entry) => entry.id === "cellar-guardian-identity",
    ),
    false,
  );

  const accepted = app.submit(review.command);

  assert.equal(accepted.status, "accepted");
  assert.deepEqual(accepted.appendedEvents.map(({ type }) => type), [
    "WorldKnowledgeRevealed",
  ]);
  assert.equal(
    app.worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE).entries.some(
      (entry) => entry.id === "cellar-guardian-identity",
    ),
    true,
  );
});

test("invalid external edits produce deterministic conflicts without mutation", async (t) => {
  const cases = [
    {
      name: "stale",
      expectedCode: "stale",
      prepare: () => {
        const fixture = beginAdventureFixture();
        const rendered = renderAdventureMarkdown(
          renderInput(fixture.eventStore.readAll()),
        );
        return {
          fixture,
          rendered,
          editedMarkdown: editFrontmatter(
            revealCellarGuardian(rendered.markdown),
            (document) => {
              document.revision = "0".repeat(64);
            },
          ),
          reviewerScope: GAME_MASTER_ACTOR_SCOPE,
        };
      },
    },
    {
      name: "simultaneous",
      expectedCode: "simultaneous",
      prepare: () => {
        const fixture = beginAdventureFixture();
        const rendered = renderAdventureMarkdown(
          renderInput(fixture.eventStore.readAll()),
        );
        fixture.app.submit({ type: "choose-action", actionId: "survey-manor" });
        return {
          fixture,
          rendered,
          editedMarkdown: revealCellarGuardian(rendered.markdown),
          reviewerScope: GAME_MASTER_ACTOR_SCOPE,
        };
      },
    },
    {
      name: "contradictory",
      expectedCode: "contradictory",
      prepare: () => {
        const fixture = beginAdventureFixture();
        const rendered = renderAdventureMarkdown(
          renderInput(fixture.eventStore.readAll()),
        );
        return {
          fixture,
          rendered,
          editedMarkdown: editFrontmatter(rendered.markdown, (document) => {
            const entities = document.entities as Array<Record<string, unknown>>;
            entities[0]!.text = "A contradictory replacement fact.";
          }),
          reviewerScope: GAME_MASTER_ACTOR_SCOPE,
        };
      },
    },
    {
      name: "contradictory replacement alongside a Reveal",
      expectedCode: "contradictory",
      prepare: () => {
        const fixture = beginAdventureFixture();
        const rendered = renderAdventureMarkdown(
          renderInput(fixture.eventStore.readAll()),
        );
        return {
          fixture,
          rendered,
          editedMarkdown: editFrontmatter(
            revealCellarGuardian(rendered.markdown),
            (document) => {
              const entities = document.entities as Array<Record<string, unknown>>;
              const replacement = entities.find(
                (entry) => entry.id === "manor-housekeeper",
              );
              assert.ok(replacement);
              replacement.id = "replacement-housekeeper";
            },
          ),
          reviewerScope: GAME_MASTER_ACTOR_SCOPE,
        };
      },
    },
    {
      name: "malformed",
      expectedCode: "malformed",
      prepare: () => {
        const fixture = beginAdventureFixture();
        const rendered = renderAdventureMarkdown(
          renderInput(fixture.eventStore.readAll()),
        );
        return {
          fixture,
          rendered,
          editedMarkdown: "# Missing structured frontmatter",
          reviewerScope: GAME_MASTER_ACTOR_SCOPE,
        };
      },
    },
    {
      name: "malformed structured entry",
      expectedCode: "malformed",
      prepare: () => {
        const fixture = beginAdventureFixture();
        const rendered = renderAdventureMarkdown(
          renderInput(fixture.eventStore.readAll()),
        );
        return {
          fixture,
          rendered,
          editedMarkdown: editFrontmatter(rendered.markdown, (document) => {
            document.entities = [42];
          }),
          reviewerScope: GAME_MASTER_ACTOR_SCOPE,
        };
      },
    },
    {
      name: "unauthorized",
      expectedCode: "unauthorized",
      prepare: () => {
        const fixture = beginAdventureFixture();
        const rendered = renderAdventureMarkdown(
          renderInput(fixture.eventStore.readAll()),
        );
        return {
          fixture,
          rendered,
          editedMarkdown: revealCellarGuardian(rendered.markdown),
          reviewerScope: DEFAULT_PLAYER_ACTOR_SCOPE,
        };
      },
    },
  ] as const;

  for (const candidate of cases) {
    await t.test(candidate.name, () => {
      const prepared = candidate.prepare();
      const before = structuredClone(prepared.fixture.eventStore.readAll());

      const review = reviewAdventureMarkdownEdit({
        base: prepared.rendered.document,
        editedMarkdown: prepared.editedMarkdown,
        current: renderInput(prepared.fixture.eventStore.readAll()),
        reviewerScope: prepared.reviewerScope,
      });

      assert.equal(review.status, "conflict");
      if (review.status !== "conflict") return;
      assert.equal(review.code, candidate.expectedCode);
      assert.match(review.message, /Markdown|edit|state|Game Master/i);
      assert.deepEqual(prepared.fixture.eventStore.readAll(), before);
      assert.equal(Object.isFrozen(review), true);
    });
  }
});

test("review commands rejected at the application boundary append no events", async (t) => {
  await t.test("a simultaneous canonical write makes a reviewed command stale", () => {
    const { app, eventStore } = beginAdventureFixture();
    const rendered = renderAdventureMarkdown(renderInput(eventStore.readAll()));
    const review = reviewAdventureMarkdownEdit({
      base: rendered.document,
      editedMarkdown: revealCellarGuardian(rendered.markdown),
      current: renderInput(eventStore.readAll()),
      reviewerScope: GAME_MASTER_ACTOR_SCOPE,
    });
    assert.equal(review.status, "command");
    if (review.status !== "command") return;
    assert.equal(
      app.submit({ type: "choose-action", actionId: "survey-manor" }).status,
      "accepted",
    );
    const before = structuredClone(eventStore.readAll());

    const rejected = app.submit(review.command);

    assert.equal(rejected.status, "rejected");
    if (rejected.status !== "rejected") return;
    assert.equal(rejected.code, "write-conflict");
    assert.deepEqual(eventStore.readAll(), before);
  });

  await t.test("a forged review command cannot reveal unknown knowledge", () => {
    const { app, eventStore } = beginAdventureFixture();
    const before = structuredClone(eventStore.readAll());

    const rejected = app.submit({
      type: "review-world-knowledge-reveal",
      reviewerScope: GAME_MASTER_ACTOR_SCOPE,
      worldKnowledgeId: "world-knowledge:unknown",
      knowledgeScope: ["Game Master", "Player Character"],
      sourceRevision: "0".repeat(64),
      expectedEventCount: before.length,
      expectedHistoryRevision: canonicalHistoryRevision(before),
    });

    assert.equal(rejected.status, "rejected");
    if (rejected.status !== "rejected") return;
    assert.equal(rejected.code, "invalid-world-knowledge");
    assert.deepEqual(eventStore.readAll(), before);
  });

  await t.test("a forged review command cannot target a Relationship", () => {
    const { app, eventStore } = beginAdventureFixture();
    const before = structuredClone(eventStore.readAll());

    const rejected = app.submit({
      type: "review-world-knowledge-reveal",
      reviewerScope: GAME_MASTER_ACTOR_SCOPE,
      worldKnowledgeId: "housekeeper-guards-cellar",
      knowledgeScope: ["Game Master", "Player Character"],
      sourceRevision: "0".repeat(64),
      expectedEventCount: before.length,
      expectedHistoryRevision: canonicalHistoryRevision(before),
    });

    assert.equal(rejected.status, "rejected");
    if (rejected.status !== "rejected") return;
    assert.equal(rejected.code, "invalid-world-knowledge");
    assert.deepEqual(eventStore.readAll(), before);
  });

  await t.test("a review command cannot be transplanted to another history", () => {
    const source = beginAdventureFixture();
    const rendered = renderAdventureMarkdown(
      renderInput(source.eventStore.readAll()),
    );
    const review = reviewAdventureMarkdownEdit({
      base: rendered.document,
      editedMarkdown: revealCellarGuardian(rendered.markdown),
      current: renderInput(source.eventStore.readAll()),
      reviewerScope: GAME_MASTER_ACTOR_SCOPE,
    });
    assert.equal(review.status, "command");
    if (review.status !== "command") return;
    const destination = beginAdventureFixture();
    const before = structuredClone(destination.eventStore.readAll());

    const rejected = destination.app.submit(review.command);

    assert.equal(rejected.status, "rejected");
    if (rejected.status !== "rejected") return;
    assert.equal(rejected.code, "write-conflict");
    assert.deepEqual(destination.eventStore.readAll(), before);
  });
});

test("a reviewed Markdown Reveal survives replay, durable reopen, and archive transfer", () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-ttrpg-markdown-review-"));
  const repository = createLocalAdventureRepository(directory);
  let adventure = repository.create("The Portable Locked Manor");
  let app = createStructuredPlayApplication({
    timelineStore: adventure.timelineStore,
  });
  assert.equal(
    app.submit({
      type: "configure-player-character",
      name: "Mara Vey",
      pronouns: "she/her",
      motivation: "Find her missing sister",
      traits: { Might: 0, Wits: 2, Presence: 1 },
    }).status,
    "accepted",
  );
  assert.equal(app.submit({ type: "begin-adventure" }).status, "accepted");
  const timelineId = adventure.timelineStore.view().activeTimelineId;
  const rendered = renderAdventureMarkdown({
    adventureId: adventure.id,
    adventureName: adventure.name,
    timelineId,
    actorScope: GAME_MASTER_ACTOR_SCOPE,
    events: adventure.timelineStore.readAll(),
  });
  const review = reviewAdventureMarkdownEdit({
    base: rendered.document,
    editedMarkdown: revealCellarGuardian(rendered.markdown),
    current: {
      adventureId: adventure.id,
      adventureName: adventure.name,
      timelineId,
      actorScope: GAME_MASTER_ACTOR_SCOPE,
      events: adventure.timelineStore.readAll(),
    },
    reviewerScope: GAME_MASTER_ACTOR_SCOPE,
  });
  assert.equal(review.status, "command");
  if (review.status !== "command") return;
  assert.equal(app.submit(review.command).status, "accepted");
  const expectedHistory = structuredClone(adventure.timelineStore.readAll());
  const expectedPlayerKnowledge = structuredClone(
    app.worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE),
  );
  const expectedMarkdown = renderAdventureMarkdown({
    adventureId: adventure.id,
    adventureName: adventure.name,
    timelineId,
    actorScope: GAME_MASTER_ACTOR_SCOPE,
    events: expectedHistory,
  }).markdown;
  const adventureId = adventure.id;
  adventure.close();

  adventure = createLocalAdventureRepository(directory).open(adventureId);
  app = createStructuredPlayApplication({ timelineStore: adventure.timelineStore });
  assert.deepEqual(adventure.timelineStore.readAll(), expectedHistory);
  assert.deepEqual(
    app.worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE),
    expectedPlayerKnowledge,
  );
  assert.equal(
    renderAdventureMarkdown({
      adventureId: adventure.id,
      adventureName: adventure.name,
      timelineId,
      actorScope: GAME_MASTER_ACTOR_SCOPE,
      events: adventure.timelineStore.readAll(),
    }).markdown,
    expectedMarkdown,
  );

  const archive = createLocalAdventureRepository(directory).exportArchive(
    adventureId,
  );
  const imported = createInMemoryAdventureRepository().importArchive(archive);
  const importedApp = createStructuredPlayApplication({
    timelineStore: imported.timelineStore,
  });
  assert.deepEqual(imported.timelineStore.readAll(), expectedHistory);
  assert.deepEqual(
    importedApp.worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE),
    expectedPlayerKnowledge,
  );
  assert.equal(
    renderAdventureMarkdown({
      adventureId: imported.id,
      adventureName: imported.name,
      timelineId: imported.timelineStore.view().activeTimelineId,
      actorScope: GAME_MASTER_ACTOR_SCOPE,
      events: imported.timelineStore.readAll(),
    }).markdown,
    expectedMarkdown,
  );
  imported.close();
  adventure.close();
});
