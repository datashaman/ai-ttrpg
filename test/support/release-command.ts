import assert from "node:assert/strict";

export function assertDeterministicReleaseCommand(
  releaseCommand: string | undefined,
): asserts releaseCommand is string {
  assert.ok(releaseCommand);
  assert.match(releaseCommand, /^npm test/);
  assert.match(releaseCommand, /npm run typecheck/);
  assert.match(releaseCommand, /npm run evaluate:release$/);
}
