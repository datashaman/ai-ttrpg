import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readProjectFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the Milestone B report maps every PRD story and Phase 5-9 criterion", () => {
  const report = readProjectFile("docs/milestone-b-release-report.md");

  for (let story = 1; story <= 38; story += 1) {
    assert.match(
      report,
      new RegExp(`PRD-69-US-${String(story).padStart(2, "0")}\\s*\\|\\s*Pass`),
    );
  }

  const acceptanceCriteriaByPhase = new Map([
    [5, 5],
    [6, 6],
    [7, 6],
    [8, 6],
    [9, 9],
  ]);
  for (const [phase, criterionCount] of acceptanceCriteriaByPhase) {
    for (let criterion = 1; criterion <= criterionCount; criterion += 1) {
      assert.match(
        report,
        new RegExp(
          `Phase-${phase}-AC-${String(criterion).padStart(2, "0")}\\s*\\|\\s*(?:Pass|Approved HITL)`,
        ),
      );
    }
  }

  assert.doesNotMatch(report, /\|\s*(?:Unresolved|Blocked)\s*\|/);
});

test("the required release command is credential-free and excludes optional provider smoke", () => {
  const packageJson = JSON.parse(readProjectFile("package.json")) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
  const workflow = readProjectFile(".github/workflows/ci.yml");
  const report = readProjectFile("docs/milestone-b-release-report.md");
  const releaseCommand = packageJson.scripts["verify:release"];

  assert.equal(releaseCommand, "npm test && npm run typecheck");
  assert.match(workflow, /run: npm run verify:release/);
  assert.doesNotMatch(releaseCommand, /openai|smoke|OPENAI_API_KEY/i);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|test:openai-smoke/);
  assert.match(report, /npm run verify:release/);
  assert.match(report, /npm run test:openai-smoke/);
  assert.match(report, /Known limitations/);
  assert.match(report, /\*\*Pass\.\*\*/);
});
