import type { CanonicalEvent } from "./structured-play.js";

export interface RandomSource {
  rollDie(sides: 6 | 100): number;
  metadata(): { readonly source: string; readonly seed: number | null };
  position(): number;
}

export const createSeededRandomSource = (seed: number): RandomSource => {
  const normalizedSeed = seed >>> 0;
  let state = normalizedSeed;
  let rolls = 0;
  return {
    rollDie(sides) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      rolls += 1;
      return Math.floor((state / 0x1_0000_0000) * sides) + 1;
    },
    metadata: () => ({ source: "seeded-lcg", seed: normalizedSeed }),
    position: () => rolls,
  };
};

export const committedRandomPosition = (
  events: readonly CanonicalEvent[],
): number =>
  events.reduce(
    (position, event) =>
      position +
      (event.type === "CheckRollRevealed"
        ? event.payload.pendingChoice.roll.random.inputs.length
        : event.type === "OracleAnswered"
          ? event.payload.trace.random.inputs.length
          : 0),
    0,
  );

export const createSeededRandomSourceAtPosition = (
  seed: number,
  position: number,
): RandomSource => {
  const source = createSeededRandomSource(seed);
  for (let index = 0; index < position; index += 1) source.rollDie(6);
  return source;
};
