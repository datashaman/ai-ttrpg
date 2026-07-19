import type { StructuredPlayIO } from "../../src/structured-play-runner.js";

export const scriptedIO = (answers: readonly string[]) => {
  const remainingAnswers = [...answers];
  const output: string[] = [];
  const io: StructuredPlayIO = {
    read: async (prompt) => {
      output.push(prompt);
      const answer = remainingAnswers.shift();
      if (answer === undefined) throw new Error("Scripted input exhausted.");
      return answer;
    },
    write: (text) => output.push(text),
  };
  return { io, output };
};
