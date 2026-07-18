import { createInterface } from "node:readline";
import { stderr, stdin, stdout } from "node:process";

import { runStructuredPlay, type TextPlayIO } from "./text-play.js";

const terminal = createInterface({ input: stdin, output: stdout });
const answers = terminal[Symbol.asyncIterator]();
const io: TextPlayIO = {
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
  await runStructuredPlay({ io });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  terminal.close();
}
