import type { PlayerAdventureProjection } from "../../src/player-ui/application-client.js";

export const CharacterFolio = ({ projection }: { readonly projection: PlayerAdventureProjection }) => {
  const character = projection.playerCharacter!;
  return (
    <aside className="folio" aria-label="Player Character folio">
      <div>
        <p className="eyebrow">Player Character</p>
        <h2>{character.name}</h2>
        <p>{character.pronouns}</p>
        <blockquote>{character.motivation}</blockquote>
      </div>
      <div className="resources" aria-label="Resources">
        <p><span>Health {character.health} of 3</span><meter min="0" max="3" value={character.health} /></p>
        <p><span>Resolve {character.resolve} of 3</span><meter min="0" max="3" value={character.resolve} /></p>
      </div>
      <dl className="traits">
        {Object.entries(character.traits).map(([trait, rating]) => (
          <div key={trait}><dt>{trait}</dt><dd>+{rating}</dd></div>
        ))}
      </dl>
      <div>
        <h3>Inventory</h3>
        <ul className="compact-list">
          {character.inventory.map((item) => (
            <li key={item.name} data-state={item.state}>{item.name}</li>
          ))}
        </ul>
      </div>
      <div><h3>Conditions</h3><p className="quiet">{projection.conditions.length === 0 ? "None" : projection.conditions.join(", ")}</p></div>
      <div>
        <h3>Clocks</h3>
        {projection.clocks.length === 0 ? <p className="quiet">None active</p> : (
          <ul className="compact-list">{projection.clocks.map((clock) => <li key={clock.name}>{clock.name} {clock.current} of {clock.capacity}</li>)}</ul>
        )}
      </div>
      <div>
        <h3>Relationships</h3>
        {projection.relationships.length === 0 ? <p className="quiet">None established</p> : (
          <ul className="compact-list">{projection.relationships.map((relationship) => <li key={relationship.id}>{relationship.content}</li>)}</ul>
        )}
      </div>
    </aside>
  );
};
