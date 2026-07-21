import { useEffect, useRef } from "react";

import type { PlayerAdventureProjection, PlayerCommand } from "../../src/player-ui/application-client.js";
import { CharacterFolio } from "./character-folio.js";
import { DecisionPanel } from "./decision-panel.js";
import { SceneLedger } from "./scene-ledger.js";
import { ErrorSummary, Status } from "./ui-primitives.js";

export const SceneWorkspace = ({ projection, submit, busy, error }: {
  readonly projection: PlayerAdventureProjection;
  readonly submit: (command: PlayerCommand) => Promise<void>;
  readonly busy: boolean;
  readonly error: string | null;
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [projection.activeScene?.id]);
  if (projection.activeScene === null) {
    return (
      <main className="threshold">
        <p className="eyebrow">Player Character ready</p>
        <h1 ref={headingRef} tabIndex={-1}>{projection.title}</h1>
        <p>{projection.playerCharacter!.name} waits beyond the iron gate.</p>
        <button className="primary-action" disabled={busy} onClick={() => submit({ type: "begin-adventure" })}>Begin Adventure</button>
      </main>
    );
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href={`/player/adventures/${projection.id}`}><span aria-hidden="true">✦</span> {projection.title}</a>
        <nav aria-label="Player workspace"><strong>Scene</strong><span aria-disabled="true">Timeline</span></nav>
        <p><Status>{projection.inputMode === "structured" ? "Structured Play" : "Natural Language Play"}</Status></p>
      </header>
      <CharacterFolio projection={projection} />
      <main className="scene-workspace">
        <header className="scene-heading">
          <p className="eyebrow">Active Scene</p><h1 ref={headingRef} tabIndex={-1}>{projection.activeScene.title}</h1>
          <p>At the rain-dark manor, each committed choice leaves a trace.</p>
        </header>
        {error === null ? null : <ErrorSummary title="Recoverable error." message={`${error} Review the current choices and try again.`} />}
        <SceneLedger projection={projection} />
        <DecisionPanel projection={projection} submit={submit} busy={busy} />
      </main>
    </div>
  );
};
