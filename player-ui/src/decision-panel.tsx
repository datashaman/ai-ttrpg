import { useEffect, useRef, useState } from "react";

import type { PlayerAdventureProjection, PlayerCommand } from "../../src/player-ui/application-client.js";
import { Status } from "./ui-primitives.js";

export const DecisionPanel = ({ projection, submit, busy }: {
  readonly projection: PlayerAdventureProjection;
  readonly submit: (command: PlayerCommand) => Promise<void>;
  readonly busy: boolean;
}) => {
  const decisionRef = useRef<HTMLFieldSetElement>(null);
  const [likelihood, setLikelihood] = useState<"Unlikely" | "Even" | "Likely">("Likely");
  const pendingChoice = projection.pendingChoice;
  const oracle = projection.oracleConfirmation;
  useEffect(() => decisionRef.current?.focus(), [pendingChoice?.id, oracle?.id]);

  if (pendingChoice !== null) {
    return (
      <fieldset className="decision" aria-label="Resolve the Check" ref={decisionRef} tabIndex={-1}>
        <legend>Resolve the Check</legend><Status>Action required</Status>
        <p className="roll">{pendingChoice.formula}</p>
        <p>The roll is recorded. Choose once; it will not be rerolled.</p>
        <div className="button-row">
          <button className="primary-action" disabled={busy || !pendingChoice.canSpendResolve} onClick={() => submit({ type: "resolve-pending-check", pendingChoiceId: pendingChoice.id, choice: "spend-resolve" })}>Spend 1 Resolve</button>
          <button disabled={busy} onClick={() => submit({ type: "resolve-pending-check", pendingChoiceId: pendingChoice.id, choice: "decline" })}>Decline Resolve</button>
        </div>
      </fieldset>
    );
  }
  if (oracle !== null) {
    const odds = { Unlikely: 25, Even: 50, Likely: 75 } as const;
    return (
      <fieldset className="decision" aria-label="Confirm Likelihood" ref={decisionRef} tabIndex={-1}>
        <legend>Confirm Likelihood</legend><Status>Action required</Status>
        <h3>{oracle.proposition}</h3>
        <p>Narrator recommendation: <strong>{oracle.recommendation}</strong></p>
        <ul className="evidence-list">{oracle.supportingFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
        <div className="likelihoods">
          {(["Unlikely", "Even", "Likely"] as const).map((option) => (
            <label key={option}>
              <input type="radio" name="likelihood" checked={likelihood === option} onChange={() => setLikelihood(option)} aria-label={`${option} — ${odds[option]}% Yes`} />
              <span>{option}<small>{odds[option]}% Yes</small></span>
            </label>
          ))}
        </div>
        <button className="primary-action" disabled={busy} onClick={() => submit({ type: "confirm-oracle-likelihood", recommendationId: oracle.id, likelihood })}>Ask the Oracle</button>
      </fieldset>
    );
  }
  if (projection.pendingCheckProposal !== null) {
    const proposal = projection.pendingCheckProposal;
    return (
      <section className="decision" aria-labelledby="proposal-heading">
        <Status>Action required</Status><h2 id="proposal-heading">Check Proposal</h2>
        <p><strong>Goal:</strong> {proposal.goal}</p><p><strong>Trait:</strong> {proposal.trait}</p>
        <dl className="stakes">
          <div><dt>Setback</dt><dd>{proposal.stakes.setback}</dd></div>
          <div><dt>Success with Cost</dt><dd>{proposal.stakes.successWithCost}</dd></div>
          <div><dt>Clean Success</dt><dd>{proposal.stakes.cleanSuccess}</dd></div>
        </dl>
        <button className="primary-action" disabled={busy} onClick={() => submit({ type: "confirm-check-proposal", proposalId: proposal.id })}>Confirm and roll</button>
      </section>
    );
  }
  return (
    <section className="actions" aria-labelledby="actions-heading">
      <p className="eyebrow">Structured Play</p><h2 id="actions-heading">What do you do?</h2>
      <div className="action-list">
        {projection.availableActions.map((action) => (
          <button key={action.id} disabled={busy} onClick={() => submit({ type: "choose-action", actionId: action.id })}>
            <span>{action.label}</span><small>{action.kind}</small>
          </button>
        ))}
      </div>
    </section>
  );
};
