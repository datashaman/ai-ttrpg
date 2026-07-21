import type {
  PlayerPresentationEvent,
  PlayerRetainedPresentation,
} from "../../src/player-ui/player-presentation.js";

export interface ActivePresentation {
  readonly outcomeEventId: string;
  readonly deterministicSummary: string;
  readonly status: "streaming" | "recoverable" | "completed";
  readonly segments: readonly Extract<
    PlayerPresentationEvent,
    { readonly type: "segment" }
  >["segment"][];
  readonly restoreFocus: boolean;
  readonly message: string;
}

export type RetainedPresentations = Readonly<
  Record<string, PlayerRetainedPresentation>
>;
