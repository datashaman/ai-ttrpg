import { useEffect, useRef, useState } from "react";

import type {
  PlayerAdventureProjection,
  PlayerCommand,
} from "../../src/player-ui/application-client.js";
import { EvidenceTrace } from "./evidence-trace.js";
import { Status } from "./ui-primitives.js";

const StructuredChoices = ({
  projection,
  submit,
  busy,
}: {
  readonly projection: PlayerAdventureProjection;
  readonly submit: (command: PlayerCommand) => Promise<void>;
  readonly busy: boolean;
}) => (
  <div className="action-list">
    {projection.availableActions.map((action) => (
      <button key={action.id} disabled={busy} onClick={() => submit({ type: "choose-action", actionId: action.id })}>
        <span>{action.label}</span><small>{action.kind}</small>
      </button>
    ))}
  </div>
);

export const DecisionPanel = ({ projection, submit, busy }: {
  readonly projection: PlayerAdventureProjection;
  readonly submit: (command: PlayerCommand) => Promise<void>;
  readonly busy: boolean;
}) => {
  const decisionRef = useRef<HTMLFieldSetElement>(null);
  const [likelihood, setLikelihood] = useState<"Unlikely" | "Even" | "Likely">("Likely");
  const [utterance, setUtterance] = useState("");
  const pendingChoice = projection.pendingChoice;
  const oracle = projection.oracleConfirmation;
  const natural = projection.naturalLanguage;
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
  const interpreted = natural.pendingProposal;
  return (
    <section className="actions" aria-labelledby="actions-heading">
      <div className="input-mode-heading">
        <div><p className="eyebrow">Player input</p><h2 id="actions-heading">What do you do?</h2></div>
        <div className="mode-switch" role="group" aria-label="Input mode">
          <button aria-pressed={projection.inputMode === "structured"} disabled={busy} onClick={() => submit({ type: "set-input-mode", mode: "structured" })}>Structured Play</button>
          <button aria-pressed={projection.inputMode === "natural-language"} disabled={busy} onClick={() => submit({ type: "set-input-mode", mode: "natural-language" })}>Natural Language Play</button>
        </div>
      </div>
      {interpreted === null ? null : (
        <div className="interpreted-action" role="region" aria-label="Confirm interpreted action">
          <Status>Provisional</Status>
          <h3>Interpretation</h3>
          <p>“{interpreted.utterance}” means <strong>{interpreted.actionLabel}</strong>.</p>
          <p>No Adventure event has been committed yet.</p>
          <button className="primary-action" disabled={busy} onClick={() => submit({ type: "confirm-natural-language-command", proposalId: interpreted.id })}>Confirm interpreted action</button>
          <EvidenceTrace {...interpreted} />
        </div>
      )}
      {natural.response === null ? null : (
        <div className="natural-response" role={natural.response.kind === "rules-answer" || natural.response.kind === "acknowledgement" ? "status" : "alert"}>
          <Status>{natural.response.status}</Status>
          <h3>{natural.response.kind === "rules-answer" ? "Rules answer" : natural.response.kind === "clarification" ? "Clarification needed" : natural.response.kind === "acknowledgement" ? "Acknowledged" : "Natural Language Play"}</h3>
          <p>{natural.response.message}</p>
          {natural.response.evidence.length === 0 ? null : <EvidenceTrace {...natural.response} />}
        </div>
      )}
      {projection.inputMode === "natural-language" && interpreted === null ? (
        <form className="natural-input" onSubmit={(event) => {
          event.preventDefault();
          if (utterance.trim() === "") return;
          void submit({ type: "submit-natural-language", utterance }).then(() => setUtterance(""));
        }}>
          <label htmlFor="natural-language-input">Describe an action or ask a rules question</label>
          <textarea id="natural-language-input" value={utterance} onChange={(event) => setUtterance(event.target.value)} disabled={busy} />
          <button className="primary-action" disabled={busy || utterance.trim() === ""}>Interpret input</button>
        </form>
      ) : null}
      {projection.inputMode === "structured" || natural.response?.status === "Action required" || natural.response?.status === "Recoverable error" || natural.response?.status === "Unavailable" ? (
        <StructuredChoices projection={projection} submit={submit} busy={busy} />
      ) : null}
    </section>
  );
};
