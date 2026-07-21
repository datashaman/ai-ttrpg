import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { CanonicalEvent, Scene } from "./structured-play.js";

export type PlayerUiPresentationStatus =
  | "not-requested"
  | "deterministic-summary";

export interface PlayerUiPlayLogInput {
  readonly sessionToken: string;
  readonly adventureId: string;
  readonly commandType: string;
  readonly status: "accepted" | "rejected";
  readonly errorCode: string | null;
  readonly sceneBefore: Scene | null;
  readonly sceneAfter: Scene | null;
  readonly appendedEvents: readonly Pick<CanonicalEvent, "id" | "type">[];
  readonly pendingChoiceBefore: boolean;
  readonly pendingChoiceAfter: boolean;
  readonly presentationStatus: PlayerUiPresentationStatus;
  readonly durationMs: number;
}

export interface PlayerUiPlayLog {
  recordCommand(input: PlayerUiPlayLogInput): void;
}

const anonymousSessionId = (sessionToken: string): string =>
  `session:${createHash("sha256").update(sessionToken).digest("hex").slice(0, 16)}`;

export const createJsonlPlayerUiPlayLog = ({
  path,
  now = () => new Date().toISOString(),
}: {
  readonly path: string;
  readonly now?: () => string;
}): PlayerUiPlayLog => ({
  recordCommand(input) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        timestamp: now(),
        sessionId: anonymousSessionId(input.sessionToken),
        adventureId: input.adventureId,
        commandType: input.commandType,
        status: input.status,
        errorCode: input.errorCode,
        sceneBefore: input.sceneBefore,
        sceneAfter: input.sceneAfter,
        appendedEvents: input.appendedEvents.map(({ id, type }) => ({ id, type })),
        pendingChoiceBefore: input.pendingChoiceBefore,
        pendingChoiceAfter: input.pendingChoiceAfter,
        presentationStatus: input.presentationStatus,
        durationMs: Math.round(input.durationMs * 1_000) / 1_000,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  },
});
