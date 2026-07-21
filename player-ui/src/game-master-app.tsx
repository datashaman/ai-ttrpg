import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createHttpApplicationClient } from "../../src/player-ui/http-application-client.js";
import type {
  GameMasterDecision,
  GameMasterCommand,
  GameMasterOutcomeTrace,
  GameMasterQueueItem,
  GameMasterWorkspace,
} from "../../src/gm-ui/application-client.js";
import { ErrorSummary, Status } from "./ui-primitives.js";

const client = createHttpApplicationClient();

export const GameMasterScopeSelectionRoute = () => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const select = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.selectGameMasterScope();
      navigate("/gm/campaigns/locked-manor/work");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Game Master scope could not be selected.");
      setBusy(false);
    }
  };
  return (
    <main className="threshold scope-selection">
      <p className="eyebrow">Local actor scope</p>
      <h1 ref={heading} tabIndex={-1}>Game Master workspace</h1>
      <p className="lede">This trusted local session can inspect privileged campaign evidence and submit attributed interventions.</p>
      {error === null ? null : <ErrorSummary title="Scope unavailable." message={error} />}
      <button className="primary-action" disabled={busy} onClick={select}>Select Game Master scope</button>
    </main>
  );
};

const decisionLabel: Record<GameMasterDecision, string> = {
  approve: "Approve",
  edit: "Edit",
  reject: "Reject",
  override: "Override",
};

const QueueItem = ({
  item,
  busy,
  intervene,
}: {
  readonly item: GameMasterQueueItem;
  readonly busy: boolean;
  readonly intervene: (
    item: GameMasterQueueItem,
    decision: GameMasterDecision,
    command?: GameMasterCommand,
  ) => void;
}) => {
  const [commandValue, setCommandValue] = useState(
    JSON.stringify(item.candidateCommand ?? item.allowedCommands[0]?.command ?? null),
  );
  const needsCommand = item.allowedInterventions.some(
    (decision) => decision === "edit" || decision === "override",
  );
  return (
  <article className="gm-work-item">
    <header className="entry-heading">
      <div>
        <p className="eyebrow">{item.actor.kind} · {item.actor.label}</p>
        <h3>{item.taskType}</h3>
      </div>
      <Status>{item.status}</Status>
    </header>
    <p>{item.playerInput}</p>
    <dl className="gm-work-metadata">
      <div><dt>Campaign</dt><dd>{item.campaign.title}</dd></div>
      <div><dt>Age</dt><dd>{item.age}</dd></div>
      <div><dt>Evidence</dt><dd><code>{item.evidence.bundleId}</code> · {item.evidence.summary}</dd></div>
      <div><dt>Validation</dt><dd>{item.validationFindings.join(" ")}</dd></div>
    </dl>
    {item.status === "Under review" ? (
      <div aria-label={`Allowed interventions for ${item.taskType}`}>
        {needsCommand ? (
          <label className="gm-command-choice">
            <span>Validated command for edit or override</span>
            <select
              aria-label={`Command for ${item.taskType}`}
              value={commandValue}
              onChange={(event) => setCommandValue(event.target.value)}
            >
              {item.allowedCommands.map(({ command, label }) => (
                <option key={JSON.stringify(command)} value={JSON.stringify(command)}>{label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="button-row">
        {item.allowedInterventions.map((decision) => (
          <button
            className={decision === "approve" ? "primary-action" : undefined}
            disabled={busy}
            key={decision}
            onClick={() => intervene(
              item,
              decision,
              decision === "edit" || decision === "override"
                ? item.allowedCommands.find(({ command }) => JSON.stringify(command) === commandValue)?.command
                : undefined,
            )}
          >
            {decisionLabel[decision]} {item.taskType}
          </button>
        ))}
        </div>
      </div>
    ) : null}
  </article>
  );
};

export const GameMasterWorkspaceRoute = () => {
  const { campaignId = "locked-manor" } = useParams();
  const [workspace, setWorkspace] = useState<GameMasterWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await client.readWorkspace(campaignId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Game Master workspace could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (workspace !== null) heading.current?.focus(); }, [workspace === null]);

  const intervene = async (
    item: GameMasterQueueItem,
    decision: GameMasterDecision,
    selectedCommand?: GameMasterCommand,
  ) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const command = selectedCommand;
      const result = await client.intervene(campaignId, {
        itemId: item.id,
        expectedRevision: item.revision,
        idempotencyKey: crypto.randomUUID(),
        decision,
        ...(command === undefined ? {} : { command }),
      });
      if (result.status === "rejected") {
        setError(result.message);
      } else {
        setWorkspace(result.workspace);
        setMessage(result.message);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The intervention could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  if (workspace === null && error !== null) {
    return <main className="loading"><ErrorSummary title="Game Master workspace unavailable." message={error} /><Link to="/gm">Select Game Master scope</Link></main>;
  }
  if (workspace === null) return <main className="loading"><p role="status">Opening Game Master work…</p></main>;
  return (
    <main className="gm-shell">
      <header className="gm-page-heading">
        <p className="eyebrow">{workspace.campaign.title}</p>
        <h1 ref={heading} tabIndex={-1}>Game Master work</h1>
        <p className="lede">Review ambiguous or invalid work without turning presentation into game authority.</p>
        <Status>{workspace.status}</Status>
      </header>
      {error === null ? null : <ErrorSummary title="Review not applied." message={error} />}
      {message === null ? null : <p className="operation-status" role="status">{message}</p>}
      <section className="gm-narration" aria-label="Recent retained Narration">
        <p className="eyebrow">Retained Narration</p>
        <p>{workspace.recentNarration.text}</p>
        <Link to={workspace.recentNarration.traceHref}>Trace outcome</Link>
      </section>
      <p><Link to={`/gm/campaigns/${campaignId}/timelines`}>Inspect and compare Timelines</Link></p>
      <section className="gm-queue" aria-label="Intervention queue">
        <div className="section-heading"><div><p className="eyebrow">Action required</p><h2>Intervention queue</h2></div><span className="ledger-rule" /></div>
        {workspace.queue.map((item) => <QueueItem key={item.id} item={item} busy={busy} intervene={intervene} />)}
      </section>
    </main>
  );
};

const TraceSection = ({ title, children }: { readonly title: string; readonly children: React.ReactNode }) => (
  <section className="trace-section"><h2>{title}</h2>{children}</section>
);

export const GameMasterTraceRoute = () => {
  const { campaignId = "locked-manor", outcomeId = "outcome:side-door" } = useParams();
  const [trace, setTrace] = useState<GameMasterOutcomeTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const regenerateButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void client.readOutcomeTrace(campaignId, outcomeId)
      .then(setTrace)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The outcome trace could not be opened."));
  }, [campaignId, outcomeId]);
  useEffect(() => { if (trace !== null) heading.current?.focus(); }, [trace === null]);

  if (error !== null) return <main className="loading"><ErrorSummary title="Trace unavailable." message={error} /></main>;
  if (trace === null) return <main className="loading"><p role="status">Opening outcome trace…</p></main>;
  const retry = async () => {
    setRetryMessage(null);
    setRetryError(null);
    try {
      const result = await client.retryNarration(campaignId, outcomeId);
      if (result.status === "Recoverable error") {
        setRetryError(`${result.message} Retry Regenerate Narration.`);
      } else {
        setRetryMessage(result.message);
        requestAnimationFrame(() => regenerateButton.current?.focus());
      }
    } catch (reason) {
      setRetryError(`${reason instanceof Error ? reason.message : "Narration is unavailable."} Retry Regenerate Narration.`);
    }
  };
  return (
    <main className="gm-shell trace-page">
      <Link to={`/gm/campaigns/${campaignId}/work`}>Back to intervention queue</Link>
      <header className="gm-page-heading">
        <p className="eyebrow">Audit trace · {trace.id}</p>
        <h1 ref={heading} tabIndex={-1}>Why this outcome occurred</h1>
        <p className="lede">Follow the retained presentation back to evidence, approved rules, the authorized command, and replayable game truth.</p>
      </header>
      <TraceSection title="Retained Narration">
        <Status>{trace.narration.status}</Status><p>{trace.narration.text}</p>
        <button ref={regenerateButton} onClick={retry}>Regenerate Narration</button>
        {retryMessage === null ? null : <p role="status">{retryMessage}</p>}
        {retryError === null ? null : <ErrorSummary title="Recoverable error" message={retryError} />}
      </TraceSection>
      <TraceSection title="Evidence Bundle">
        <p><code>{trace.evidenceBundle.id}</code></p>
        <ul>{trace.evidenceBundle.items.map((item) => <li key={item.id}><strong>{item.source}</strong><span>{item.inclusionReason}</span><code>{item.citation}</code></li>)}</ul>
      </TraceSection>
      <TraceSection title="Approved rule and source passages">
        <p><code>{trace.rule.id}</code> · {trace.rule.packageVersion}</p>
        <ul>{trace.rule.sourcePassages.map((passage) => <li key={passage.id}><p>{passage.text}</p><code>{passage.citation}</code></li>)}</ul>
      </TraceSection>
      <TraceSection title="Model Call Record">
        <dl className="gm-work-metadata"><div><dt>ID</dt><dd><code>{trace.modelCall.id}</code></dd></div><div><dt>Task</dt><dd>{trace.modelCall.taskType}</dd></div><div><dt>Evidence</dt><dd><code>{trace.modelCall.evidenceBundleId}</code></dd></div><div><dt>Validation</dt><dd>{trace.modelCall.validation}</dd></div></dl>
      </TraceSection>
      <TraceSection title="Actor-authorized command">
        <p><code>{trace.command.id}</code> · {trace.command.input.type}</p>
      </TraceSection>
      <TraceSection title="Canonical events and random trace">
        <ol>{trace.events.map((event) => <li key={event.id}><code>{event.id}</code> · {event.type}</li>)}</ol>
        <p>Seed {trace.randomTrace.seed}, position {trace.randomTrace.position}, rolls {trace.randomTrace.rolls.join(" + ")}</p>
      </TraceSection>
      <TraceSection title="Authoritative projection">
        <p>{trace.projection.scene} · {trace.projection.acceptedEventCount} accepted event</p>
        <ul>{trace.projection.establishedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
      </TraceSection>
    </main>
  );
};
