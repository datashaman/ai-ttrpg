import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import type { PlayerAdventureProjection, PlayerCommand } from "../../src/player-ui/application-client.js";
import { createHttpApplicationClient } from "../../src/player-ui/http-application-client.js";
import { PlayerSetup } from "./player-setup.js";
import { SceneWorkspace } from "./scene-workspace.js";
import { ErrorSummary } from "./ui-primitives.js";

const client = createHttpApplicationClient();

const PlayerAdventure = () => {
  const { adventureId = "locked-manor" } = useParams();
  const [projection, setProjection] = useState<PlayerAdventureProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setProjection(await client.readPlayerAdventure(adventureId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Adventure could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [adventureId]);
  useEffect(() => { void load(); }, [load]);

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
  return <SceneWorkspace projection={projection} submit={submit} busy={busy} error={error} />;
};

export const PlayerApp = () => (
  <Routes>
    <Route path="/player/adventures/:adventureId" element={<PlayerAdventure />} />
    <Route path="*" element={<Navigate to="/player/adventures/locked-manor" replace />} />
  </Routes>
);
