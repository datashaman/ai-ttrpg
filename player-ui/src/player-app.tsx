import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import type { PlayerAdventureProjection, PlayerCommand } from "../../src/player-ui/application-client.js";
import { createHttpApplicationClient } from "../../src/player-ui/http-application-client.js";
import { PlayerSetup } from "./player-setup.js";
import { SceneWorkspace } from "./scene-workspace.js";
import { ErrorSummary } from "./ui-primitives.js";
import type {
  ActivePresentation,
  RetainedPresentations,
} from "./presentation-view-model.js";
import { GameMasterScopeSelectionRoute, GameMasterTraceRoute, GameMasterWorkspaceRoute } from "./game-master-app.js";

const client = createHttpApplicationClient();

const PlayerAdventure = () => {
  const { adventureId = "locked-manor" } = useParams();
  const [projection, setProjection] = useState<PlayerAdventureProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [presentation, setPresentation] = useState<ActivePresentation | null>(null);
  const [retainedPresentations, setRetainedPresentations] = useState<RetainedPresentations>({});
  const presentationAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextProjection, retained] = await Promise.all([
        client.readPlayerAdventure(adventureId),
        client.readPlayerPresentations(adventureId),
      ]);
      setProjection(nextProjection);
      setRetainedPresentations(Object.fromEntries(
        retained.map((item) => [item.outcomeEventId, item]),
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Adventure could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [adventureId]);
  useEffect(() => {
    void load();
    return () => presentationAbort.current?.abort();
  }, [load]);

  const present = useCallback(async (
    outcomeEventId: string,
    deterministicSummary: string,
    regenerate = false,
  ) => {
    presentationAbort.current?.abort();
    const abort = new AbortController();
    presentationAbort.current = abort;
    setPresentation({
      outcomeEventId,
      deterministicSummary,
      status: "streaming",
      segments: [],
      restoreFocus: regenerate,
      message: "Narration is arriving. It is provisional until complete.",
    });
    try {
      for await (const event of client.streamPlayerPresentation(
        adventureId,
        outcomeEventId,
        { regenerate, signal: abort.signal },
      )) {
        if (event.type === "segment") {
          setPresentation((current) => current?.outcomeEventId === outcomeEventId
            ? { ...current, segments: [...current.segments, event.segment] }
            : current);
        } else if (event.type === "completed") {
          setRetainedPresentations((current) => ({
            ...current,
            [event.presentation.outcomeEventId]: event.presentation,
          }));
          setPresentation({
            outcomeEventId,
            deterministicSummary,
            status: "completed",
            segments: [],
            restoreFocus: regenerate,
            message: "Narration complete and retained.",
          });
        } else {
          setPresentation({
            outcomeEventId,
            deterministicSummary: event.deterministicSummary,
            status: "recoverable",
            segments: [],
            restoreFocus: regenerate,
            message: event.message,
          });
        }
      }
    } catch (reason) {
      if (abort.signal.aborted) return;
      setPresentation({
        outcomeEventId,
        deterministicSummary,
        status: "recoverable",
        segments: [],
        restoreFocus: regenerate,
        message: `${reason instanceof Error ? reason.message : "Narration was interrupted."} The committed outcome is safe.`,
      });
    } finally {
      if (presentationAbort.current === abort) presentationAbort.current = null;
    }
  }, [adventureId]);

  const cancelPresentation = () => {
    const active = presentation;
    presentationAbort.current?.abort();
    presentationAbort.current = null;
    if (active !== null) {
      setPresentation({
        ...active,
        status: "recoverable",
        segments: [],
        message: "Narration was cancelled. The committed outcome is safe.",
      });
    }
  };

  const submit = async (command: PlayerCommand) => {
    setBusy(true);
    setError(null);
    try {
      const response = await client.submitPlayerCommand(adventureId, command);
      setProjection(response.projection);
      if (response.status === "rejected") {
        setError(response.message.includes("exactly once")
          ? "Assign +0, +1, and +2 exactly once, then submit again."
          : response.message);
      } else {
        const latest = response.projection.ledger.at(-1);
        const wasAlreadyPresent = projection?.ledger.some(
          ({ id }) => id === latest?.id,
        ) ?? false;
        if (
          latest !== undefined &&
          latest.narrationStatus === "Unavailable" &&
          !wasAlreadyPresent
        ) {
          void present(latest.id, latest.summary);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The command could not be submitted. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (projection === null && error !== null) {
    return (
      <main className="loading">
        <ErrorSummary title="Adventure unavailable." message={`${error} Retry opening the Adventure.`} />
        <button className="primary-action" disabled={busy} onClick={load}>Retry opening Adventure</button>
      </main>
    );
  }
  if (projection === null) return <main className="loading"><p role="status">Opening the Adventure…</p></main>;
  if (projection.playerCharacter === null) return <PlayerSetup submit={submit} busy={busy} error={error} />;
  return <SceneWorkspace
    projection={projection}
    submit={submit}
    busy={busy}
    error={error}
    presentation={presentation}
    retainedPresentations={retainedPresentations}
    cancelPresentation={cancelPresentation}
    present={present}
  />;
};

export const PlayerApp = () => (
  <Routes>
    <Route path="/player/adventures/:adventureId" element={<PlayerAdventure />} />
    <Route path="/gm" element={<GameMasterScopeSelectionRoute />} />
    <Route path="/gm/campaigns/:campaignId/work" element={<GameMasterWorkspaceRoute />} />
    <Route path="/gm/campaigns/:campaignId/outcomes/:outcomeId/trace" element={<GameMasterTraceRoute />} />
    <Route path="*" element={<Navigate to="/player/adventures/locked-manor" replace />} />
  </Routes>
);
