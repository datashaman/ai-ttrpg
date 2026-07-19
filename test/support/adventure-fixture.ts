import {
  createInMemoryEventStore,
  createStructuredPlayApplication,
  type RandomSource,
  type StructuredPlayOptions,
  type TraitRatings,
} from "../../src/structured-play.js";

export const beginAdventureFixture = ({
  traits = { Might: 0, Wits: 2, Presence: 1 },
  randomSource,
  applicationOptions = {},
}: {
  readonly traits?: TraitRatings;
  readonly randomSource?: RandomSource;
  readonly applicationOptions?: Omit<
    StructuredPlayOptions,
    "eventStore" | "randomSource" | "timelineStore"
  >;
} = {}) => {
  const eventStore = createInMemoryEventStore();
  const app = createStructuredPlayApplication({
    ...applicationOptions,
    eventStore,
    ...(randomSource === undefined ? {} : { randomSource }),
  });
  app.submit({
    type: "configure-player-character",
    name: "Mara Vey",
    pronouns: "she/her",
    motivation: "Find her missing sister",
    traits,
  });
  app.submit({ type: "begin-adventure" });
  return { app, eventStore };
};
