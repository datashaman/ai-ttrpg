import type { PlayerAdventureProjection } from "../../src/player-ui/application-client.js";
import { Status } from "./ui-primitives.js";
import { EvidenceTrace } from "./evidence-trace.js";
import type { RetainedPresentations } from "./presentation-view-model.js";

export const SceneLedger = ({
  projection,
  retainedPresentations,
  regenerate,
  presentationBusy,
}: {
  readonly projection: PlayerAdventureProjection;
  readonly retainedPresentations: RetainedPresentations;
  readonly regenerate: (outcomeEventId: string, summary: string) => Promise<void>;
  readonly presentationBusy: boolean;
}) => (
  <section className="ledger" aria-label="Scene ledger">
    <div className="section-heading">
      <div><p className="eyebrow">Committed history</p><h2>Scene ledger</h2></div>
      <span className="ledger-rule" aria-hidden="true" />
    </div>
    {projection.ledger.length === 0 ? <p className="empty-ledger">Your committed outcomes will gather here.</p> : (
      <ol>
        {projection.ledger.map((entry, index) => {
          const narration = retainedPresentations[entry.id];
          return (
          <li key={entry.id}>
            <span className="turn-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <article>
              <div className="entry-heading"><h3>{entry.action}</h3><Status>{entry.status}</Status></div>
              <p className="presentation-label">{entry.presentation}</p>
              <p className="input-origin">Chosen through {entry.inputMode}</p>
              <p>{entry.summary}</p>
              {narration === undefined ? (
                <p className="narration-status">Narration unavailable</p>
              ) : (
                <section className="retained-narration" aria-label={`Retained Narration for ${entry.action}`}>
                  <p className="presentation-label">{narration.source} · Retained Narration</p>
                  <p>{narration.text}</p>
                  {narration.modelCallIds.length === 0 ? null : (
                    <p className="narration-trace"><strong>Model Call:</strong> <code>{narration.modelCallIds.join(", ")}</code></p>
                  )}
                </section>
              )}
              <button
                className="presentation-action"
                data-presentation-trigger={entry.id}
                disabled={presentationBusy}
                onClick={() => void regenerate(entry.id, entry.summary)}
              >Regenerate Narration</button>
              {entry.interpretation === null ? null : <EvidenceTrace {...entry.interpretation} summary="Inspect Natural Language interpretation" />}
              <details>
                <summary>Inspect mechanic and evidence</summary>
                <div className="trace">
                  {entry.mechanic.ruleReference === null ? null : <p><strong>Rule</strong> <code>{entry.mechanic.ruleReference}</code></p>}
                  {entry.mechanic.calculation === null ? null : <p><strong>Resolution</strong> <code>{entry.mechanic.calculation}</code></p>}
                  <p><strong>Evidence Bundle:</strong> <code>{entry.mechanic.evidenceBundle.id}</code></p>
                  <ul>{entry.mechanic.evidenceBundle.references.map((reference) => <li key={reference}><code>{reference}</code></li>)}</ul>
                </div>
              </details>
            </article>
          </li>
          );
        })}
      </ol>
    )}
  </section>
);
