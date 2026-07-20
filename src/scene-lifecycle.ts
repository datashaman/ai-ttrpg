import { immutableSnapshot } from "./model-boundary.js";
import type {
  ApplicationView,
  CanonicalEvent,
  Scene,
} from "./structured-play.js";

export type SceneLifecycleStatus =
  | "proposed"
  | "active"
  | "paused"
  | "resolving"
  | "ended";

export const SCENE_LIFECYCLE_TRANSITIONS: Readonly<
  Record<SceneLifecycleStatus, readonly SceneLifecycleStatus[]>
> = immutableSnapshot({
  proposed: ["active"],
  active: ["paused", "resolving", "ended"],
  paused: ["active", "resolving", "ended"],
  resolving: ["active", "paused", "ended"],
  ended: [],
});

export interface SceneExit {
  readonly kind: "Scene" | "Adventure";
  readonly destination: string;
  readonly eventId: string;
}

export interface SceneLifecycle {
  readonly scene: Scene;
  readonly status: SceneLifecycleStatus;
  readonly allowedTransitions: readonly SceneLifecycleStatus[];
  readonly exit: SceneExit | null;
}

export const projectSceneLifecycle = ({
  scene,
  events,
  application,
}: {
  readonly scene: Scene;
  readonly events: readonly CanonicalEvent[];
  readonly application: ApplicationView;
}): SceneLifecycle => {
  let enteredAt = -1;
  events.forEach((event, index) => {
    if (
      (event.type === "SceneStarted" && event.payload.scene === scene) ||
      (event.type === "SceneTransitioned" && event.payload.to === scene)
    ) {
      enteredAt = index;
    }
  });
  let status: SceneLifecycleStatus = "proposed";
  let exit: SceneExit | null = null;
  if (enteredAt >= 0) {
    const exitEvent = events.slice(enteredAt + 1).find(
      (event) =>
        (event.type === "SceneTransitioned" && event.payload.from === scene) ||
        (event.type === "AdventureEnded" && event.payload.from === scene),
    );
    if (exitEvent?.type === "SceneTransitioned") {
      status = "ended";
      exit = {
        kind: "Scene",
        destination: exitEvent.payload.to,
        eventId: exitEvent.id,
      };
    } else if (exitEvent?.type === "AdventureEnded") {
      status = "ended";
      exit = {
        kind: "Adventure",
        destination: exitEvent.payload.ending.id,
        eventId: exitEvent.id,
      };
    } else if (
      application.state.pendingChoice !== null ||
      application.state.pendingNarratorRecommendation !== null
    ) {
      status = "paused";
    } else if (application.state.pendingCheckProposal !== null) {
      status = "resolving";
    } else {
      status = "active";
    }
  }
  return immutableSnapshot({
    scene,
    status,
    allowedTransitions: SCENE_LIFECYCLE_TRANSITIONS[status],
    exit,
  });
};
