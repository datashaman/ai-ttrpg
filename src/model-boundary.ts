export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

export const immutableSnapshot = <Value>(value: Value): Value => {
  const snapshot = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (!isRecord(candidate) && !Array.isArray(candidate)) return;
    Object.freeze(candidate);
    Object.values(candidate).forEach(freeze);
  };
  freeze(snapshot);
  return snapshot;
};

export const invokeWithinTimeout = async (
  invocation: () => Promise<unknown>,
  timeoutMs: number,
): Promise<unknown> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(invocation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Model timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};
