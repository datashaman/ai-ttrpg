import assert from "node:assert/strict";

export const LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID =
  "cellar-guardian-identity";
export const LOCKED_MANOR_HIDDEN_KNOWLEDGE_TEXT =
  "The manor's housekeeper is the cellar guardian in disguise.";

export const assertLockedManorHiddenKnowledgeAbsent = (
  value: unknown,
): void => {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(
    serialized,
    new RegExp(LOCKED_MANOR_HIDDEN_KNOWLEDGE_ID, "i"),
  );
  assert.doesNotMatch(
    serialized,
    /housekeeper|cellar guardian|secretly guards|disguise/i,
  );
};
