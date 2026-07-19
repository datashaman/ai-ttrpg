import { appendFileSync } from "node:fs";

const sensitiveKey =
  /^(?:authorization|api[-_]?key|token|secret|credential|password)$/i;
const credentialPattern = /\b(?:sk-[a-z0-9_-]+|bearer\s+[^\s"']+)/gi;
const redacted = "[REDACTED]";

export const redactModelDiagnosticValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.replace(credentialPattern, redacted);
  }
  if (Array.isArray(value)) {
    return value.map(redactModelDiagnosticValue);
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveKey.test(key) ? redacted : redactModelDiagnosticValue(child),
    ]),
  );
};

export interface ModelDiagnosticCapture {
  capture(value: unknown): void;
}

export const createLocalModelDiagnosticCapture = (
  path: string,
): ModelDiagnosticCapture => ({
  capture: (value) =>
    appendFileSync(
      path,
      `${JSON.stringify(redactModelDiagnosticValue(value))}\n`,
      "utf8",
    ),
});
