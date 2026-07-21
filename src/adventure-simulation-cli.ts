import { runDurableAdventureSimulation } from "./adventure-simulation.js";

const report = await runDurableAdventureSimulation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === "failed") process.exitCode = 1;
