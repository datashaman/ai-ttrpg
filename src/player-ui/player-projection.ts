import {
  DEFAULT_PLAYER_ACTOR_SCOPE,
  type StructuredPlayApplication,
} from "../structured-play.js";
import type {
  PlayerActionOption,
  PlayerAdventureProjection,
  PlayerLedgerEntry,
} from "./application-client.js";

const sceneTitle = (scene: string): string =>
  `${scene.slice(0, 1).toUpperCase()}${scene.slice(1)}`;

const playerActions = (
  app: StructuredPlayApplication,
): readonly PlayerActionOption[] =>
  app
    .view()
    .availableActions.filter(
      (action): action is typeof action & PlayerActionOption =>
        action.kind === "Free Action" ||
        action.kind === "Check" ||
        action.kind === "Oracle" ||
        action.kind === "Recovery",
    )
    .map(({ id, kind, label }) => ({ id, kind, label }));

export const projectPlayerAdventure = ({
  adventureId,
  app,
  ledger,
}: {
  readonly adventureId: string;
  readonly app: StructuredPlayApplication;
  readonly ledger: readonly PlayerLedgerEntry[];
}): PlayerAdventureProjection => {
  const view = app.view();
  const playerCharacter = view.state.playerCharacter;
  const pendingChoice = view.state.pendingChoice;
  const proposal = view.state.pendingCheckProposal;
  const oracle = view.state.pendingNarratorRecommendation;
  const relationships = app
    .worldKnowledge(DEFAULT_PLAYER_ACTOR_SCOPE)
    .entries.filter((entry) => entry.kind === "Relationship")
    .map(({ id, content }) => ({ id, content }));
  return {
    id: adventureId,
    title: "The Locked Manor",
    playerCharacter:
      playerCharacter === null
        ? null
        : {
            name: playerCharacter.name,
            pronouns: playerCharacter.pronouns,
            motivation: playerCharacter.motivation,
            traits: playerCharacter.traits,
            health: playerCharacter.health,
            resolve: playerCharacter.resolve,
            inventory: playerCharacter.inventory,
          },
    activeScene:
      view.state.activeScene === null
        ? null
        : { id: view.state.activeScene, title: sceneTitle(view.state.activeScene) },
    conditions: view.state.conditions,
    clocks:
      view.state.confrontation === null
        ? []
        : [
            {
              name: "Resistance",
              current: view.state.confrontation.resistanceClock.current,
              capacity: view.state.confrontation.resistanceClock.capacity,
            },
            {
              name: "Danger",
              current: view.state.confrontation.dangerClock.current,
              capacity: view.state.confrontation.dangerClock.capacity,
            },
          ],
    relationships,
    availableActions: playerActions(app),
    pendingCheckProposal:
      proposal === null
        ? null
        : {
            id: proposal.id,
            goal: proposal.goal,
            trait: proposal.trait,
            stakes: {
              setback: proposal.stakes.Setback.summary,
              successWithCost: proposal.stakes["Success with Cost"].summary,
              cleanSuccess: proposal.stakes["Clean Success"].summary,
            },
          },
    pendingChoice:
      pendingChoice === null
        ? null
        : {
            id: pendingChoice.id,
            formula: `${pendingChoice.roll.random.inputs[0]} + ${pendingChoice.roll.random.inputs[1]} + ${pendingChoice.proposal.trait} ${pendingChoice.roll.modifiers[0].value} = ${pendingChoice.roll.result.total}`,
            total: pendingChoice.roll.result.total,
            canSpendResolve: pendingChoice.availableChoices.includes("spend-resolve"),
          },
    oracleConfirmation:
      oracle === null
        ? null
        : {
            id: oracle.id,
            proposition: oracle.proposition.text,
            recommendation: oracle.likelihood,
            supportingFacts: oracle.evidence.map((fact) => fact.text),
          },
    ledger: [...ledger],
  };
};
