import type { PresentationContext } from "../presentation.js";
import type { CanonicalEvent, GameState } from "../structured-play.js";

export interface PlayerPresentationSnapshot {
  readonly outcomeEventId: string;
  readonly deterministicSummary: string;
  readonly context: PresentationContext;
  readonly acceptedEvents: readonly CanonicalEvent[];
  readonly state: GameState;
}

export interface PlayerPresentationGenerator {
  generate(snapshot: PlayerPresentationSnapshot): AsyncIterable<string>;
}

export interface PlayerRetainedPresentation {
  readonly id: string;
  readonly outcomeEventId: string;
  readonly source: "Narrator";
  readonly status: "Retained";
  readonly text: string;
  readonly modelCallIds: readonly string[];
}

interface PlayerPresentationEventBase {
  readonly streamId: string;
  readonly correlationId: string;
  readonly sequence: number;
}

export type PlayerPresentationEvent =
  | (PlayerPresentationEventBase & {
      readonly type: "segment";
      readonly segment: {
        readonly id: string;
        readonly source: "Narrator";
        readonly status: "Provisional";
        readonly text: string;
      };
    })
  | (PlayerPresentationEventBase & {
      readonly type: "completed";
      readonly presentation: PlayerRetainedPresentation;
    })
  | (PlayerPresentationEventBase & {
      readonly type: "failed";
      readonly message: string;
      readonly deterministicSummary: string;
    });
