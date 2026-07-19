import { appendFileSync } from "node:fs";

const sensitiveKeys = new Set([
  "authorization",
  "proxyauthorization",
  "apikey",
  "xapikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "secret",
  "clientsecret",
  "secretaccesskey",
  "awssecretaccesskey",
  "credential",
  "credentials",
  "password",
  "passwd",
  "privatekey",
  "cookie",
  "setcookie",
]);
const credentialPattern = /\b(?:sk-[a-z0-9_-]+|bearer\s+[^\s"']+)/gi;
const redacted = "[REDACTED]";

const isSensitiveKey = (key: string): boolean =>
  sensitiveKeys.has(key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en"));

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
      isSensitiveKey(key) ? redacted : redactModelDiagnosticValue(child),
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
