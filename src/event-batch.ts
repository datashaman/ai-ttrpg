import type {
  CanonicalEvent,
  EventBatchRequest,
  EventBatchResult,
} from "./structured-play.js";

const sameEvents = (
  left: readonly CanonicalEvent[],
  right: readonly CanonicalEvent[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const acceptEventBatch = (
  history: readonly CanonicalEvent[],
  request: EventBatchRequest,
  persist: (events: readonly CanonicalEvent[]) => void,
): EventBatchResult => {
  const existing = history.filter(
    (event) => event.causationId === request.idempotencyKey,
  );
  if (existing.length > 0) {
    return sameEvents(existing, request.events)
      ? {
          status: "replayed",
          events: structuredClone(existing),
          actualPosition: history.length,
        }
      : {
          status: "rejected",
          code: "idempotency-conflict",
          message: "That idempotency identity was already used for different content.",
          expectedPosition: request.expectedPosition,
          actualPosition: history.length,
        };
  }
  if (
    request.events.length === 0 ||
    request.events.some(
      (event, index) =>
        event.sequence !== request.expectedPosition + index + 1 ||
        event.causationId !== request.idempotencyKey,
    )
  ) {
    return {
      status: "rejected",
      code: "invalid-batch",
      message: "The event batch does not match its stream position or identity.",
      expectedPosition: request.expectedPosition,
      actualPosition: history.length,
    };
  }
  if (request.expectedPosition !== history.length) {
    return {
      status: "rejected",
      code: "stale-position",
      message: "The expected stream position is stale.",
      expectedPosition: request.expectedPosition,
      actualPosition: history.length,
    };
  }
  const next = [...history, ...structuredClone(request.events)];
  try {
    persist(next);
  } catch {
    return {
      status: "rejected",
      code: "persistence-failed",
      message: "The event batch could not be persisted.",
      expectedPosition: request.expectedPosition,
      actualPosition: history.length,
    };
  }
  return {
    status: "accepted",
    events: structuredClone(request.events),
    actualPosition: next.length,
  };
};
