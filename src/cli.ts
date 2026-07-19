import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  argv,
  cwd,
  env,
  loadEnvFile,
  stderr,
  stdin,
  stdout,
} from "node:process";

import { runAdventureCli } from "./adventure-cli.js";
import { createLocalAdventureRepository } from "./adventure-repository.js";
import { createModelRuntimeFromEnvironment } from "./model-runtime.js";
import type { StructuredPlayIO } from "./structured-play-runner.js";

const localEnvironmentPath = join(cwd(), ".env.local");
if (existsSync(localEnvironmentPath)) loadEnvFile(localEnvironmentPath);

const terminal = createInterface({ input: stdin, output: stdout });
const answers = terminal[Symbol.asyncIterator]();
const io: StructuredPlayIO = {
  read: async (prompt) => {
    stdout.write(prompt);
    const answer = await answers.next();
    if (answer.done) {
      throw new Error("Structured Play input ended before the session finished.");
    }
    return answer.value;
  },
  write: (text) => stdout.write(text),
};

try {
  const dataDirectory =
    env.AI_TTRPG_DATA_DIRECTORY ?? join(homedir(), ".ai-ttrpg", "adventures");
  const modelRuntime = createModelRuntimeFromEnvironment(env);
  await runAdventureCli(
    argv.slice(2),
    io,
    createLocalAdventureRepository(dataDirectory),
    modelRuntime === undefined
      ? {}
      : {
          modelGateway: modelRuntime.modelGateway,
          modelTimeoutMs: modelRuntime.timeoutMs,
        },
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  terminal.close();
}
