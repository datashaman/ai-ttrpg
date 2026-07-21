import { useEffect, useRef } from "react";

import type { PlayerAdventureProjection, PlayerCommand } from "../../src/player-ui/application-client.js";
import { CharacterFolio } from "./character-folio.js";
import { DecisionPanel } from "./decision-panel.js";
import { SceneLedger } from "./scene-ledger.js";
import { ErrorSummary, Status } from "./ui-primitives.js";
import type {
  ActivePresentation,
  RetainedPresentations,
} from "./presentation-view-model.js";

export const SceneWorkspace = ({
  projection,
  submit,
  busy,
  error,
  presentation,
  retainedPresentations,
  cancelPresentation,
  present,
}: {
  readonly projection: PlayerAdventureProjection;
  readonly submit: (command: PlayerCommand) => Promise<void>;
  readonly busy: boolean;
  readonly error: string | null;
  readonly presentation: ActivePresentation | null;
  readonly retainedPresentations: RetainedPresentations;
  readonly cancelPresentation: () => void;
  readonly present: (
    outcomeEventId: string,
    deterministicSummary: string,
    regenerate?: boolean,
  ) => Promise<void>;
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
        {presentation?.status === "streaming" ? (
          <PresentationStream
            presentation={presentation}
            cancel={cancelPresentation}
          />
        ) : presentation?.status === "recoverable" ? (
          <PresentationRecovery
            presentation={presentation}
            retry={() => present(
                presentation.outcomeEventId,
                presentation.deterministicSummary,
                true,
              )}
          />
        ) : presentation?.status === "completed" ? (
          <PresentationCompletion presentation={presentation} />
        ) : null}
        <SceneLedger
          projection={projection}
          retainedPresentations={retainedPresentations}
          presentationBusy={presentation?.status === "streaming"}
          regenerate={(id, summary) => present(id, summary, true)}
        />
        <DecisionPanel projection={projection} submit={submit} busy={busy} />
      </main>
    </div>
  );
};

const PresentationRecovery = ({ presentation, retry }: {
  readonly presentation: ActivePresentation;
  readonly retry: () => Promise<void>;
}) => {
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => summaryRef.current?.focus(), []);
  return (
    <div className="presentation-recovery" role="alert" tabIndex={-1} ref={summaryRef}>
      <Status>Recoverable error</Status>
      <h2>Narration interrupted</h2>
      <p>{presentation.message}</p>
      <p><strong>Committed summary:</strong> {presentation.deterministicSummary}</p>
      <button className="primary-action" onClick={() => void retry()}>Retry Narration</button>
    </div>
  );
};

const PresentationStream = ({ presentation, cancel }: {
  readonly presentation: ActivePresentation;
  readonly cancel: () => void;
}) => {
  return (
    <section
      className="presentation-stream"
      aria-label="Provisional Narration transcript"
      aria-busy="true"
    >
      <div className="entry-heading"><h2>Narrator</h2><Status>Provisional</Status></div>
      <p
        aria-live="off"
        aria-label="Narrator, provisional Narration"
        data-segment-ids={presentation.segments.map(({ id }) => id).join(" ")}
      >
        {presentation.segments.length === 0 ? "Preparing Narration…" :
          presentation.segments.map(({ text }) => text).join("")}
      </p>
      <p className="quiet">This text is presentation only. The deterministic outcome below is already committed.</p>
      <button onClick={cancel}>Cancel Narration</button>
    </section>
  );
};

const PresentationCompletion = ({ presentation }: {
  readonly presentation: ActivePresentation;
}) => {
  useEffect(() => {
    if (!presentation.restoreFocus) return;
    document.querySelector<HTMLButtonElement>(
      `[data-presentation-trigger="${CSS.escape(presentation.outcomeEventId)}"]`,
    )?.focus();
  }, [presentation.outcomeEventId, presentation.restoreFocus]);
  return <p className="presentation-completion" role="status">{presentation.message}</p>;
};
