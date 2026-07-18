import type { CanonicalEvent, EventStore } from "./structured-play.js";

export const createInMemoryEventStore = (): EventStore => {
  const events: CanonicalEvent[] = [];
  return {
    readAll: () => [...events],
    append: (event) => events.push(event),
  };
};
