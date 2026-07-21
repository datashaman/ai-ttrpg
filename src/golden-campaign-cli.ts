import { readFileSync } from "node:fs";

import {
  evaluateGoldenCampaignText,
  supportedGoldenCampaignAdapters,
} from "./golden-campaign-evaluation.js";

const fixturePath = process.argv[2];
const serializedFixture = readFileSync(
  fixturePath ?? new URL("../benchmarks/golden-campaign-v1.json", import.meta.url),
  "utf8",
);
const report = await evaluateGoldenCampaignText({
  serializedFixture,
  adapters: supportedGoldenCampaignAdapters(),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (
  report.diagnostics.length > 0 ||
  report.runs.some(({ status }) => status === "failed")
) {
  process.exitCode = 1;
}
