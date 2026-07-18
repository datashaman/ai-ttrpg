# AI TTRPG Engine

An AI-assisted tabletop role-playing game engine designed around a deterministic, event-sourced core.

The engine will interpret natural-language player input, retrieve relevant rules and world facts, resolve mechanics, persist campaign state, and narrate the result. Language models assist with interpretation and presentation; they do not own dice, rules, or canonical state.

> [!IMPORTANT]
> This repository is in early implementation. The current runnable slice covers Player Character setup, entry into the arrival Scene, and one Structured Play Free Action; it is not yet a complete Adventure.

## Try the current slice

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Choose a name, pronouns, Motivation, and assign `0`, `1`, and `2` exactly once among Might, Wits, and Presence. The CLI then starts the arrival Scene and offers its authored Free Action. This path does not call a language model.

For development:

```sh
npm test
npm run typecheck
```

## Goals

- Support multiple game systems through replaceable, versioned rulesets.
- Enable solo, cooperative, and GM-assisted play.
- Keep mechanics deterministic, testable, and usable without an LLM.
- Preserve campaigns as replayable, auditable event histories.
- Ground model output in attributable rules, entities, and events.
- Make storage, model providers, interfaces, and integrations replaceable.
- Start with text play, then expand to voice and virtual tabletop integrations.

## Architecture

```text
Player / GM / External Tool
             |
        Input Adapter
             |
     Utterance Classifier
             |
       Scene Controller
       /      |       \
 Retrieval  Rules   Oracles
       \      |       /
        Command Planner
             |
      Deterministic Runtime
             |
       Validated Events
          /       \
  Event Store   Event Bus
       |          |
  Projections   Integrations
       |
 Narration Context
       |
  LLM Narrator / UI
```

The central authority boundary is simple: the model may classify, extract, propose, summarize, and narrate; application code validates commands, resolves mechanics, records events, and derives state.

## Design principles

1. **Code owns truth.** Dice, calculations, constraints, validation, and state mutation are deterministic.
2. **The LLM proposes; the engine disposes.** Model output passes through constrained schemas and validation.
3. **Events are canonical.** Current state is rebuilt from an append-only event history.
4. **Rules are data.** Game systems are represented by versioned definitions plus explicit runtime primitives where needed.
5. **Retrieval is evidence.** Rules and world facts supplied to models remain attributable.
6. **Boundaries are replaceable.** Models, databases, interfaces, speech providers, and VTTs are adapters.
7. **The core works offline.** The game loop and hand-authored rules do not require a language model.
8. **Vertical slices come first.** Each implementation phase should leave an end-to-end capability that can be tested.

## Documentation

| Document | Description |
| --- | --- |
| [Domain glossary](CONTEXT.md) | Canonical gameplay language and the boundaries between closely related concepts. |
| [Implementation plan](docs/engine-implementation-plan.md) | Domain model, quality requirements, phased roadmap, acceptance criteria, risks, and success criteria. |
| [Architecture decisions](docs/adr/) | Durable decisions whose trade-offs would otherwise be difficult to reconstruct. |
| [System architecture](docs/system-architecture.html) | Interactive component and authority-boundary diagram. |
| [Player turn](docs/player-turn.html) | Interactive sequence showing interpretation, resolution, commit, projection, and narration. |
| [Event-sourced world state](docs/event-sourcing.html) | Interactive view of commands, immutable events, projections, and integrations. |

The HTML diagrams are standalone files. Open them directly in a browser; no build step or server is required. Each supports light and dark themes and can export to SVG, PNG, JPEG, or WebP.

## Planned delivery

The first vertical slice is intentionally narrow: one campaign, one player, text input, a hand-authored micro-ruleset, and a bounded adventure. From there, the plan advances through:

1. Product boundaries and executable scenarios.
2. Architecture contracts and a runnable repository skeleton.
3. Domain schemas, event storage, projections, and branching.
4. Deterministic rules and world-state memory.
5. Rule authoring, retrieval, and constrained LLM capabilities.
6. Scene orchestration, narration, testing, and simulation.
7. User interfaces, voice, VTT integrations, and multiplayer.
8. Operations, an extension SDK, and production readiness.

See the [full implementation plan](docs/engine-implementation-plan.md#implementation-phases) for phase-specific deliverables and acceptance criteria.

## Current repository structure

```text
.
├── README.md
└── docs
    ├── engine-implementation-plan.md
    ├── event-sourcing.html
    ├── player-turn.html
    └── system-architecture.html
```

## Contributing

The project is pre-implementation, so the most useful contributions are currently design reviews, executable scenario proposals, domain terminology corrections, and feedback on authority boundaries. Before proposing implementation work, read the implementation plan and keep changes aligned with its core rule: models may assist, but only deterministic code may commit mechanically significant facts.

## License

No license has been added yet. Until one is selected, the repository's contents remain under the copyright holder's default rights.
