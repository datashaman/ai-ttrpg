import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import { createServer as createViteServer } from "vite";

import { createDeterministicPlayerSession } from "./player-ui/deterministic-player-session.js";
import type { PlayerCommand } from "./player-ui/application-client.js";
import { createJsonlPlayerUiPlayLog } from "./player-ui-play-log.js";

const host = "127.0.0.1";
const port = 4173;
const playLogPath =
  process.env.AI_TTRPG_PLAYER_LOG_PATH?.trim() ||
  join(homedir(), ".ai-ttrpg", "logs", "player-ui.jsonl");
const playLog = createJsonlPlayerUiPlayLog({ path: playLogPath });
type PlayerSession = ReturnType<typeof createDeterministicPlayerSession>;
const sessions = new Map<string, PlayerSession>();

const sessionFor = (
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): PlayerSession => {
  const sessionId = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ai_ttrpg_session="))
    ?.slice("ai_ttrpg_session=".length);
  if (sessionId !== undefined) {
    const existing = sessions.get(sessionId);
    if (existing !== undefined) return existing;
  }
  const nextSessionId = randomUUID();
  const session = createDeterministicPlayerSession("locked-manor", {
    sessionToken: nextSessionId,
    playLog,
    onPlayLogError: (error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      process.stderr.write(`Player Interface play log failed: ${message}\n`);
    },
  });
  sessions.set(nextSessionId, session);
  response.setHeader(
    "Set-Cookie",
    `ai_ttrpg_session=${nextSessionId}; Path=/; HttpOnly; SameSite=Strict`,
  );
  return session;
};

const readBody = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as PlayerCommand;
};

const vite = await createViteServer({
  configFile: "vite.player.config.ts",
  server: { middlewareMode: true },
  appType: "spa",
});

const server = createHttpServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const adventureMatch = url.pathname.match(
    /^\/api\/player\/adventures\/([^/]+)(\/commands)?$/,
  );
  if (adventureMatch !== null) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const adventureId = decodeURIComponent(adventureMatch[1]!);
    if (adventureId !== "locked-manor") {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Adventure not found." }));
      return;
    }
    if (request.method === "GET" && adventureMatch[2] === undefined) {
      const session = sessionFor(request, response);
      response.end(JSON.stringify(session.projection()));
      return;
    }
    if (request.method === "POST" && adventureMatch[2] === "/commands") {
      try {
        const session = sessionFor(request, response);
        response.end(JSON.stringify(session.submit(await readBody(request))));
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ message: "Invalid Player command." }));
      }
      return;
    }
    response.statusCode = 405;
    response.end(JSON.stringify({ message: "Method not allowed." }));
    return;
  }
  vite.middlewares(request, response, () => {
    response.statusCode = 404;
    response.end("Not found");
  });
});

server.listen(port, host, () => {
  process.stdout.write(`Player Interface: http://${host}:${port}\n`);
  process.stdout.write(`Player Interface play log: ${playLogPath}\n`);
});
