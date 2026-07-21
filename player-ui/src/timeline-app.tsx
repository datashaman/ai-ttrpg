import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { createHttpApplicationClient } from "../../src/player-ui/http-application-client.js";
import type { TimelineWorkspaceView } from "../../src/timeline-ui.js";
import { ErrorSummary, Status } from "./ui-primitives.js";

const client = createHttpApplicationClient();

const shortId = (id: string): string =>
  id === "timeline-main" ? "Main Timeline" : `Branch ${id.slice(-8)}`;

export const TimelineWorkspaceRoute = ({
  actor,
}: {
  readonly actor: "Player" | "Game Master";
}) => {
  const { adventureId, campaignId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const compareWith = searchParams.get("compareWith") ?? undefined;
  const selectedTimelineId = searchParams.get("timeline") ?? undefined;
  const id = adventureId ?? campaignId ?? "locked-manor";
  const [workspace, setWorkspace] = useState<TimelineWorkspaceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const remember = useCallback((next: TimelineWorkspaceView) => {
    const parameters: Record<string, string> = { timeline: next.activeTimelineId };
    if (next.comparison !== null) {
      parameters.compareWith = next.comparison.baselineTimelineId;
    }
    setSearchParams(parameters, { replace: true });
  }, [setSearchParams]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let next = await client.readTimelineWorkspace(
        id,
        actor,
        compareWith,
      );
      if (selectedTimelineId !== undefined && selectedTimelineId !== next.activeTimelineId) {
        next = (await client.selectTimeline(
          id,
          actor,
          selectedTimelineId,
          compareWith,
        )).workspace;
      }
      setWorkspace(next);
      remember(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Timeline workspace could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [actor, compareWith, id, remember, selectedTimelineId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (workspace !== null) heading.current?.focus(); }, [workspace === null]);

  const branch = async (position: number) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await client.branchTimeline(id, actor, position);
      setWorkspace(result.workspace);
      if (result.status === "accepted") {
        setMessage(result.message);
        remember(result.workspace);
      }
      else setError(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Timeline could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const select = async (timelineId: string) => {
    if (workspace === null || timelineId === workspace.activeTimelineId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await client.selectTimeline(
        id,
        actor,
        timelineId,
        workspace.activeTimelineId,
      );
      setWorkspace(result.workspace);
      if (result.status === "accepted") {
        setMessage(result.message);
        remember(result.workspace);
      }
      else setError(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Timeline could not be selected.");
    } finally {
      setBusy(false);
    }
  };

  if (workspace === null && error !== null) {
    return <main className="loading"><ErrorSummary title="Timeline workspace unavailable." message={error} /><button onClick={load}>Retry</button></main>;
  }
  if (workspace === null) return <main className="loading"><p role="status">Opening Timelines…</p></main>;
  const active = workspace.activeTimeline;
  return (
    <main className="gm-shell timeline-shell">
      <Link to={actor === "Game Master" ? `/gm/campaigns/${id}/work` : `/player/adventures/${id}`}>
        Back to {actor === "Game Master" ? "Game Master work" : "Adventure"}
      </Link>
      <header className="gm-page-heading">
        <p className="eyebrow">{actor} scope · {id}</p>
        <h1 ref={heading} tabIndex={-1}>Timelines</h1>
        <p className="lede">Inspect accepted history, branch from an event, and compare canonical outcomes without treating presentation wording as game truth.</p>
        <Status>{shortId(active.id)} active</Status>
      </header>
      {error === null ? null : <ErrorSummary title="Timeline operation not applied." message={error} />}
      {message === null ? null : <p className="operation-status" role="status">{message}</p>}

      <section className="timeline-picker" aria-labelledby="timeline-list-heading">
        <h2 id="timeline-list-heading">Timeline ancestry</h2>
        <div className="timeline-cards">
          {workspace.timelines.map((timeline) => (
            <button
              aria-pressed={timeline.id === workspace.activeTimelineId}
              disabled={busy}
              key={timeline.id}
              onClick={() => void select(timeline.id)}
            >
              <strong>{shortId(timeline.id)}</strong>
              <span>{timeline.parentTimelineId === null ? "Root Timeline" : `From ${shortId(timeline.parentTimelineId)} at event ${timeline.branchEventPosition}`}</span>
              <small>{timeline.eventCount} events · random position {timeline.randomPosition}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="timeline-detail" aria-labelledby="active-timeline-heading">
        <div className="section-heading"><div><p className="eyebrow">Active selection</p><h2 id="active-timeline-heading">{shortId(active.id)}</h2></div><span className="ledger-rule" /></div>
        <dl className="gm-work-metadata">
          <div><dt>Identity</dt><dd><code>{active.id}</code></dd></div>
          <div><dt>Parent</dt><dd>{active.parentTimelineId === null ? "None" : <code>{active.parentTimelineId}</code>}</dd></div>
          <div><dt>Branch</dt><dd>{active.branchEventPosition ?? "Root"}</dd></div>
          <div><dt>Random</dt><dd>Position {active.randomPosition}</dd></div>
        </dl>
        <h3>Accepted events</h3>
        <ol className="timeline-events">
          {active.events.map((event) => (
            <li key={event.id}>
              <div><code>{event.position}</code><span><strong>{event.type}</strong>{event.summary}</span><Status>{event.visibility}</Status></div>
              <button disabled={busy} onClick={() => void branch(event.position)}>Branch here</button>
            </li>
          ))}
        </ol>
      </section>

      <section className="timeline-projection" aria-labelledby="projection-heading">
        <h2 id="projection-heading">Current projection</h2>
        <dl className="gm-work-metadata">
          <div><dt>Scene</dt><dd>{active.projection.scene ?? "Not begun"}</dd></div>
          <div><dt>Health</dt><dd>{active.projection.health ?? "—"}</dd></div>
          <div><dt>Resolve</dt><dd>{active.projection.resolve ?? "—"}</dd></div>
          <div><dt>Conditions</dt><dd>{active.projection.conditions.join(", ") || "None"}</dd></div>
        </dl>
        <h3>World Knowledge</h3>
        <ul>{active.worldKnowledge.map((entry) => <li key={entry.id}><span>{entry.content}</span><small>{entry.visibility} · {entry.sourceReference}</small></li>)}</ul>
      </section>

      {workspace.comparison === null ? null : (
        <section className="timeline-comparison" aria-labelledby="comparison-heading">
          <p className="eyebrow">Canonical difference</p>
          <h2 id="comparison-heading">Compare {shortId(workspace.comparison.baselineTimelineId)} with {shortId(workspace.comparison.comparedTimelineId)}</h2>
          <div className="comparison-grid">
            <div><h3>Commands</h3><ul>{workspace.comparison.commands.map(({ value, attribution }) => <li key={value}><code>{value}</code><small>{attribution}</small></li>)}</ul></div>
            <div><h3>Events</h3><ul>{workspace.comparison.events.removed.map((event) => <li key={`removed:${event.id}`}>Removed: {event.type}</li>)}{workspace.comparison.events.added.map((event) => <li key={`added:${event.id}`}>Added: {event.type}</li>)}</ul></div>
            <div><h3>World Knowledge differences</h3><ul>{workspace.comparison.worldKnowledge.removed.map((entry) => <li key={`removed:${entry.id}`}>Removed: {entry.content}</li>)}{workspace.comparison.worldKnowledge.added.map((entry) => <li key={`added:${entry.id}`}>Added: {entry.content}</li>)}</ul></div>
            <div><h3>Resources</h3><ul>{workspace.comparison.resources.map(({ value, attribution }) => <li key={value}>{value}<small>{attribution}</small></li>)}</ul></div>
            <div><h3>Rules</h3><ul>{workspace.comparison.rules.map(({ value, attribution }) => <li key={value}><code>{value}</code><small>{attribution}</small></li>)}</ul></div>
            <div><h3>Random stream</h3>{workspace.comparison.randomPosition === null ? null : <p>{workspace.comparison.randomPosition.value}<small>{workspace.comparison.randomPosition.attribution}</small></p>}<ul>{workspace.comparison.randomInputs.map(({ value, attribution }) => <li key={value}><code>{value}</code><small>{attribution}</small></li>)}</ul></div>
            <div><h3>Resulting projection</h3><ul>{workspace.comparison.projection.map(({ value, attribution }) => <li key={value}>{value}<small>{attribution}</small></li>)}</ul></div>
          </div>
        </section>
      )}
    </main>
  );
};
