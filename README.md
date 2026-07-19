# AI TTRPG Engine

An AI-assisted tabletop role-playing game engine designed around a deterministic, event-sourced core.

The engine will interpret natural-language player input, retrieve relevant rules and world facts, resolve mechanics, persist campaign state, and narrate the result. Language models assist with interpretation and presentation; they do not own dice, rules, or canonical state.

> [!IMPORTANT]
> This repository is in early implementation. The current runnable slice is a complete, hand-authored locked-manor Adventure covering Player Character setup, Structured Play and natural-language actions, event-driven Scene transitions, recoverable Check and Resolve decisions, grounded Oracle answers, Inventory Item permissions and removal, Field Kit recovery, temporary Conditions, a clock-driven Confrontation, rewind through branching Timelines, and safe presentation of committed outcomes.

## Try the current slice

Requirements: Node.js 20 or newer.

```sh
npm install
npm start -- create "The Locked Manor"
```

Adventures created by the CLI are durable. They are stored in the Player's
default application-data directory, so no storage path or language model is
required. List them and reopen one by its displayed id:

```sh
npm start -- list
npm start -- open <adventure-id>
```

Choose a name, pronouns, Motivation, and assign `0`, `1`, and `2` exactly once among Might, Wits, and Presence. The CLI then starts the arrival Scene and offers authored Free Actions and uncertain actions. An uncertain action presents its complete Check Proposal before you confirm, correct, revise, or withdraw it. A confirmed Check records and reveals `2d6 + Trait`; before the outcome commits, you may spend one Resolve for `+1` or decline. The selected predeclared stakes commit only after that Pending Choice is resolved. Closing and reopening the Adventure replays its durable event history to restore the same Player-visible state, after which accepted actions append to that same history.

Surveying the manor establishes visible evidence for an authored Unresolved Proposition. Continue in the Scene to ask the Oracle question: the Narrator recommends a grounded Likelihood, the Player confirms or changes it, and a recorded percentile roll establishes a visible Yes or No fact. Extreme rolls attach an Exceptional Consequence without changing the answer. The recommendation, evidence, confirmation, roll, committed events, and projected fact remain inspectable in the trace. This path does not call a language model.

Inventory Items are explicitly either `carried` or `removed`. The Lantern, Lockpick Set, and Short Blade permit authored approaches but never add numeric modifiers. Predeclared loss, breakage, surrender, or consumption removes an item. Outside a Confrontation, the single-use Field Kit restores exactly one Health or Resolve (up to 3); neither resource recovers passively. Shaken blocks Resolve spending until its Scene ends, while Restrained blocks actions requiring free movement until explicitly removed.

Inside the cellar, active opposition is resolved through the same Player-facing Check flow as every other uncertain action. There is no initiative, round structure, Non-Player Character turn, or opposed roll. Each validated outcome advances the visible Resistance Clock, advances the visible Danger Clock, or applies another predeclared Mechanical Effect. Filling Resistance commits the authored successful ending; filling Danger or reaching zero Health commits a non-death Defeat, applies its consequences, and enters a consequence Scene. Both Clock totals and filling consequences remain visible and rebuild entirely from canonical events.

The locked manor is a non-linear graph rather than a mandatory sequence. Visible Oracle answers and Established Facts can route the Player from arrival into social discovery or directly to the Confrontation. Social discovery can reveal the cellar route or resolve the mystery without a Confrontation. The Player may also withdraw with the mystery unresolved, while Confrontation victory and Defeat lead to favourable and adverse endings. Scene transitions and Adventure endings occur only when committed events satisfy pre-authored exit conditions; the Narrator cannot end either one. The Structured Play path completes every route with no language-model calls.

Structured Play also exposes Timeline controls after the first accepted event. The Player can branch from any accepted event position to explore another choice without deleting or rewriting the source Timeline, and can select any existing Timeline to inspect or resume it. Each Timeline appends and projects independently. A child inherits the parent's random-stream position at its branch point, so repeating identical confirmed play reproduces the same Check and Oracle rolls rather than granting a reroll. The in-memory Timeline store preserves the graph, active selection, and random positions when the application is reconstructed around that store.

Applications may provide a replaceable interpretation model for natural-language play. It receives an immutable snapshot of the Player's utterance, Player-visible Established Facts and entities, and currently available capabilities—never the application or event store. Its strictly validated classification may select one exposed capability, but application code creates the command and routes it through the same Check Proposal, Pending Choice, Oracle Likelihood, rules, and event boundaries as Structured Play. Ambiguity, unavailable capabilities, nonexistent entity references, invalid schema, timeout, or adversarial authority fields append no gameplay events and ask for clarification or reject safely.

Applications may also provide a replaceable presentation model to narrate an outcome only after its events commit. The model receives an immutable snapshot containing only Player-visible Established Facts, the committed resolution trace, and the just-appended events—never the private deterministic fallback, an application command, or an event-store handle. Schema-invalid, contradictory, timed-out, or mechanically ungrounded output falls back to the private deterministic summary without replaying the action. The Player may regenerate narration or ask a grounded rules question repeatedly from the same committed inputs; neither interaction appends events or changes projected game state. Without a presentation model, Structured Play continues to use deterministic summaries.

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
| [v1 release report](docs/v1-release-report.md) | Completed automated and moderated release-gate evidence and the terminal-accessibility baseline. |
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

## Contributing

The project is in early implementation, so useful contributions include vertical slices, executable scenarios, design reviews, domain terminology corrections, and feedback on authority boundaries. Before proposing implementation work, read the implementation plan and keep changes aligned with its core rule: models may assist, but only deterministic code may commit mechanically significant facts.

## License

No license has been added yet. Until one is selected, the repository's contents remain under the copyright holder's default rights.
