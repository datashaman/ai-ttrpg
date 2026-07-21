import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import { createServer as createViteServer } from "vite";

import { createDeterministicPlayerSession } from "./player-ui/deterministic-player-session.js";
import type { PlayerCommand } from "./player-ui/application-client.js";
import { createJsonlPlayerUiPlayLog } from "./player-ui-play-log.js";
import { createModelRuntimeFromEnvironment } from "./model-runtime.js";
import { narrateCommittedOutcomeThroughGateway } from "./grounded-narration.js";
import {
  createInMemoryModelCallRecordStore,
  type ModelCallRecordStore,
} from "./model-gateway.js";
import { DEFAULT_PLAYER_ACTOR_SCOPE } from "./structured-play.js";
import type { PlayerPresentationGenerator } from "./player-ui/player-presentation.js";
import {
  createDeterministicGameMasterSession,
  type GameMasterIntervention,
} from "./gm-ui/deterministic-game-master-session.js";
import { hasExactKeys, isRecord } from "./model-boundary.js";

const host = "127.0.0.1";
const port = 4173;
const playLogPath =
  process.env.AI_TTRPG_PLAYER_LOG_PATH?.trim() ||
  join(homedir(), ".ai-ttrpg", "logs", "player-ui.jsonl");
const playLog = createJsonlPlayerUiPlayLog({ path: playLogPath });
const modelRuntime = createModelRuntimeFromEnvironment(process.env);
const presentationGeneratorFor = (
  modelCallStore: ModelCallRecordStore,
): PlayerPresentationGenerator | undefined =>
  modelRuntime === undefined
    ? undefined
    : {
        async *generate(snapshot) {
          const presented = await narrateCommittedOutcomeThroughGateway({
            actorScope: DEFAULT_PLAYER_ACTOR_SCOPE,
            gateway: modelRuntime.modelGateway,
            modelCallStore,
            context: snapshot.context,
            acceptedEvents: snapshot.acceptedEvents,
            state: snapshot.state,
            timeoutMs: modelRuntime.timeoutMs,
          });
          if (presented.source !== "model") {
            throw new Error("Validated Narration was unavailable.");
          }
          const words = presented.text.split(/(?<=\s)/u);
          for (let index = 0; index < words.length; index += 8) {
            yield words.slice(index, index + 8).join("");
          }
        },
      };
type PlayerSession = ReturnType<typeof createDeterministicPlayerSession>;
const sessions = new Map<string, PlayerSession>();
type GameMasterSession = ReturnType<typeof createDeterministicGameMasterSession>;
const gameMasterSessions = new Map<string, GameMasterSession>();

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
  const modelCallStore = createInMemoryModelCallRecordStore();
  const presentationGenerator = presentationGeneratorFor(modelCallStore);
  const session = createDeterministicPlayerSession("locked-manor", {
    sessionToken: nextSessionId,
    playLog,
    onPlayLogError: (error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      process.stderr.write(`Player Interface play log failed: ${message}\n`);
    },
    modelCallStore,
    ...(modelRuntime === undefined ? {} : { modelGateway: modelRuntime.modelGateway }),
    ...(presentationGenerator === undefined ? {} : { presentationGenerator }),
  });
  sessions.set(nextSessionId, session);
  response.setHeader(
    "Set-Cookie",
    `ai_ttrpg_session=${nextSessionId}; Path=/; HttpOnly; SameSite=Strict`,
  );
  return session;
};

const gameMasterSessionFor = (
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): GameMasterSession => {
  const sessionId = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ai_ttrpg_gm_session="))
    ?.slice("ai_ttrpg_gm_session=".length);
  if (sessionId !== undefined) {
    const existing = gameMasterSessions.get(sessionId);
    if (existing !== undefined) return existing;
  }
  const nextSessionId = randomUUID();
  const session = createDeterministicGameMasterSession({
    actor: { kind: "Game Master", campaignIds: ["locked-manor"] },
  });
  gameMasterSessions.set(nextSessionId, session);
  response.setHeader(
    "Set-Cookie",
    `ai_ttrpg_gm_session=${nextSessionId}; Path=/; HttpOnly; SameSite=Strict`,
  );
  return session;
};

const readBody = async (request: import("node:http").IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const isGameMasterCommand = (
  value: unknown,
): value is NonNullable<GameMasterIntervention["command"]> =>
  isRecord(value) &&
  ((hasExactKeys(value, ["type", "actionId"]) &&
    value.type === "choose-action" &&
    typeof value.actionId === "string") ||
    (hasExactKeys(value, ["type", "candidateId"]) &&
      value.type === "publish-rule-candidate" &&
      typeof value.candidateId === "string"));

const isGameMasterIntervention = (
  value: unknown,
): value is GameMasterIntervention => {
  if (!isRecord(value)) return false;
  const keys = value.command === undefined
    ? ["decision", "expectedRevision", "idempotencyKey", "itemId"]
    : ["command", "decision", "expectedRevision", "idempotencyKey", "itemId"];
  return (
    hasExactKeys(value, keys) &&
    typeof value.itemId === "string" &&
    Number.isInteger(value.expectedRevision) &&
    typeof value.idempotencyKey === "string" &&
    ["approve", "edit", "reject", "override"].includes(String(value.decision)) &&
    (value.command === undefined || isGameMasterCommand(value.command))
  );
};

const vite = await createViteServer({
  configFile: "vite.player.config.ts",
  server: { middlewareMode: true },
  appType: "spa",
});

const server = createHttpServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const gameMasterWorkspaceMatch = url.pathname.match(
    /^\/api\/gm\/campaigns\/([^/]+)\/workspace$/,
  );
  if (gameMasterWorkspaceMatch !== null && request.method === "GET") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const campaignId = decodeURIComponent(gameMasterWorkspaceMatch[1]!);
    try {
      response.end(JSON.stringify(gameMasterSessionFor(request, response).workspace(campaignId)));
    } catch {
      response.statusCode = 403;
      response.end(JSON.stringify({ message: "Campaign scope is not authorized." }));
    }
    return;
  }
  const gameMasterTraceMatch = url.pathname.match(
    /^\/api\/gm\/campaigns\/([^/]+)\/outcomes\/([^/]+)\/trace$/,
  );
  if (gameMasterTraceMatch !== null && request.method === "GET") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      response.end(JSON.stringify(gameMasterSessionFor(request, response).trace(
        decodeURIComponent(gameMasterTraceMatch[1]!),
        decodeURIComponent(gameMasterTraceMatch[2]!),
      )));
    } catch {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Outcome trace not found." }));
    }
    return;
  }
  const gameMasterInterventionMatch = url.pathname.match(
    /^\/api\/gm\/campaigns\/([^/]+)\/interventions$/,
  );
  if (gameMasterInterventionMatch !== null && request.method === "POST") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      const intervention = await readBody(request);
      if (!isGameMasterIntervention(intervention)) throw new Error("Invalid intervention");
      response.end(JSON.stringify(await gameMasterSessionFor(request, response).intervene(
        decodeURIComponent(gameMasterInterventionMatch[1]!),
        intervention,
      )));
    } catch {
      response.statusCode = 400;
      response.end(JSON.stringify({ message: "Invalid Game Master intervention." }));
    }
    return;
  }
  const gameMasterRetryMatch = url.pathname.match(
    /^\/api\/gm\/campaigns\/([^/]+)\/outcomes\/([^/]+)\/retry-narration$/,
  );
  if (gameMasterRetryMatch !== null && request.method === "POST") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      response.end(JSON.stringify(await gameMasterSessionFor(request, response).retryNarration(
        decodeURIComponent(gameMasterRetryMatch[1]!),
        decodeURIComponent(gameMasterRetryMatch[2]!),
      )));
    } catch {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Outcome presentation not found." }));
    }
    return;
  }
  const presentationsMatch = url.pathname.match(
    /^\/api\/player\/adventures\/([^/]+)\/presentations$/,
  );
  if (presentationsMatch !== null && request.method === "GET") {
    const adventureId = decodeURIComponent(presentationsMatch[1]!);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (adventureId !== "locked-manor") {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Adventure not found." }));
      return;
    }
    response.end(JSON.stringify(sessionFor(request, response).presentations()));
    return;
  }
  const presentationMatch = url.pathname.match(
    /^\/api\/player\/adventures\/([^/]+)\/presentations\/([^/]+)\/stream$/,
  );
  if (presentationMatch !== null && request.method === "GET") {
    const adventureId = decodeURIComponent(presentationMatch[1]!);
    if (adventureId !== "locked-manor") {
      response.statusCode = 404;
      response.end("Adventure not found.");
      return;
    }
    const session = sessionFor(request, response);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    try {
      for await (const event of session.streamPresentation(
        decodeURIComponent(presentationMatch[2]!),
        { regenerate: url.searchParams.get("regenerate") === "true" },
      )) {
        if (response.destroyed) return;
        response.write(
          `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      }
    } catch {
      if (!response.destroyed) {
        response.write(
          `event: failed\ndata: ${JSON.stringify({
            type: "failed",
            streamId: randomUUID(),
            correlationId: decodeURIComponent(presentationMatch[2]!),
            sequence: 0,
            message: "Narration is unavailable. The committed outcome is safe.",
            deterministicSummary: "The accepted outcome remains committed.",
          })}\n\n`,
        );
      }
    }
    response.end();
    return;
  }
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
        response.end(
          JSON.stringify(await session.submit((await readBody(request)) as PlayerCommand)),
        );
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
