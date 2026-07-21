import { useEffect, useRef, useState, type FormEvent } from "react";

import type { PlayerCommand } from "../../src/player-ui/application-client.js";
import { ErrorSummary } from "./ui-primitives.js";

const ratings = [0, 1, 2] as const;

export const PlayerSetup = ({
  submit,
  busy,
  error,
}: {
  readonly submit: (command: PlayerCommand) => Promise<void>;
  readonly busy: boolean;
  readonly error: string | null;
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [motivation, setMotivation] = useState("");
  const [traits, setTraits] = useState({ Might: 0, Wits: 1, Presence: 2 } as const);
  useEffect(() => headingRef.current?.focus(), []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await submit({
      type: "configure-player-character",
      name,
      pronouns,
      motivation,
      traits,
    });
  };

  return (
    <main className="setup-shell">
      <div className="setup-mark" aria-hidden="true">I</div>
      <section className="setup-panel" aria-labelledby="setup-title">
        <p className="eyebrow">The Locked Manor · Player setup</p>
        <h1 id="setup-title" ref={headingRef} tabIndex={-1}>Enter the locked manor</h1>
        <p className="lede">
          Name the person who crosses the iron gate, then assign each Trait rating once.
        </p>
        {error === null ? null : (
          <ErrorSummary title="Player Character not created." message={error} />
        )}
        <form onSubmit={onSubmit}>
          <div className="identity-fields">
            <label>
              <span>Player Character name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              <span>Pronouns</span>
              <input value={pronouns} onChange={(event) => setPronouns(event.target.value)} required />
            </label>
          </div>
          <label>
            <span>Motivation</span>
            <textarea value={motivation} onChange={(event) => setMotivation(event.target.value)} required />
          </label>
          <fieldset className="trait-ledger">
            <legend>Assign Traits</legend>
            <p>Use +0, +1, and +2 exactly once.</p>
            {(["Might", "Wits", "Presence"] as const).map((trait) => (
              <div className="trait-row" key={trait}>
                <strong>{trait}</strong>
                <div className="rating-options">
                  {ratings.map((rating) => (
                    <label key={rating}>
                      <input
                        type="radio"
                        name={trait}
                        aria-label={`${trait} +${rating}`}
                        checked={traits[trait] === rating}
                        onChange={() => setTraits({ ...traits, [trait]: rating })}
                      />
                      <span>+{rating}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <button className="primary-action" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create Player Character"}
          </button>
        </form>
      </section>
    </main>
  );
};
