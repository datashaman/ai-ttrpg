import type { CanonicalEvent, EventStore } from "./structured-play.js";
import { acceptEventBatch } from "./event-batch.js";

export const createInMemoryEventStore = (): EventStore => {
  const events: CanonicalEvent[] = [];
  return {
    readAll: () => [...events],
    append: (event) => events.push(event),
    appendBatch: (request) => {
      const result = acceptEventBatch(events, request, () => {});
      if (result.status === "accepted") events.push(...structuredClone(result.events));
      return result;
    },
  };
};
