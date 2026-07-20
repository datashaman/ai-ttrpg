import { createHash } from "node:crypto";

import type { CanonicalEvent } from "./structured-play.js";

export const canonicalHistoryRevision = (
  events: readonly CanonicalEvent[],
): string => createHash("sha256").update(JSON.stringify(events)).digest("hex");
