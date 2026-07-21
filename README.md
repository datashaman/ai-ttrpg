# AI TTRPG Engine

An AI-assisted tabletop role-playing game engine designed around a deterministic, event-sourced core.

The engine will interpret natural-language player input, retrieve relevant rules and world facts, resolve mechanics, persist campaign state, and narrate the result. Language models assist with interpretation and presentation; they do not own dice, rules, or canonical state.

> [!IMPORTANT]
> This repository is in early implementation. The current runnable slice is a complete, hand-authored locked-manor Adventure covering Player Character setup, Structured Play and natural-language actions, event-driven Scene transitions, recoverable Check and Resolve decisions, grounded Oracle answers, Inventory Item permissions and removal, Field Kit recovery, temporary Conditions, a clock-driven Confrontation, rewind through branching Timelines, and safe presentation of committed outcomes.

## Try the current slice

Requirements: Node.js 24 or newer.

```sh
npm install
npm start -- create "The Locked Manor"
```

The browser-first Player Interface runs locally and completes the arrival
Scene entirely through Structured Play—no model provider or credentials are
required:

```sh
npm run player-ui
```

Open `http://127.0.0.1:4173/player/adventures/locked-manor`. Configure the
Player Character, recover from any setup error in place, then use the authored
actions to confirm an Oracle Likelihood and Check Proposal, resolve the recorded
Pending Choice, and enter the next Scene. Each committed outcome exposes a
compact rule trace and its Player-visible Evidence Bundle references. The
interface is responsive from 320 CSS pixels and keeps Inventory Items,
Conditions, Clocks, and relevant relationships in a separate character folio.

Build the locally bundled interface or run its browser journey with:

```sh
npm run player-ui:build
npm run test:browser
```

The browser journey runs against the current local Chrome and Playwright's
current Firefox and WebKit builds; CI also runs the current Microsoft Edge
channel. WebKit provides early Safari compatibility feedback, while current
Safari remains a manual verification target as defined by ADR-0014.

Adventures created by the CLI are durable. They are stored in the Player's
default application-data directory, so no storage path or language model is
required. List them and reopen one by its displayed id:

```sh
npm start -- list
npm start -- open <adventure-id>
```

Export a complete Adventure—including every Timeline, accepted event, active
selection, and inherited random-stream position—to a versioned,
integrity-checked archive, then import it into another data directory:

```sh
npm start -- export <adventure-id> portable-adventure.json
npm start -- import portable-adventure.json
```

Import validates the complete archive before making the Adventure visible and
refuses to overwrite an existing Adventure with the same identity.
Archive import and export are repository-owner operations: the portable archive
intentionally preserves canonical knowledge for every actor scope and is not a
Player-visible projection. Player-facing exports must use an explicitly scoped
projection rather than exposing the canonical archive.

Choose a name, pronouns, Motivation, and assign `0`, `1`, and `2` exactly once among Might, Wits, and Presence. The CLI then starts the arrival Scene and offers authored Free Actions and uncertain actions. An uncertain action presents its complete Check Proposal before you confirm, correct, revise, or withdraw it. A confirmed Check records and reveals `2d6 + Trait`; before the outcome commits, you may spend one Resolve for `+1` or decline. The selected predeclared stakes commit only after that Pending Choice is resolved. Closing and reopening the Adventure replays its durable event history to restore the same Player-visible state, after which accepted actions append to that same history.

Surveying the manor establishes visible evidence for an authored Unresolved Proposition. Continue in the Scene to ask the Oracle question: the Narrator recommends a grounded Likelihood, the Player confirms or changes it, and a recorded percentile roll establishes a visible Yes or No fact. Extreme rolls attach an Exceptional Consequence without changing the answer. The recommendation, evidence, confirmation, roll, committed events, and projected fact remain inspectable in the trace. This path does not call a language model.

Inventory Items are explicitly either `carried` or `removed`. The Lantern, Lockpick Set, and Short Blade permit authored approaches but never add numeric modifiers. Predeclared loss, breakage, surrender, or consumption removes an item. Outside a Confrontation, the single-use Field Kit restores exactly one Health or Resolve (up to 3); neither resource recovers passively. Shaken blocks Resolve spending until its Scene ends, while Restrained blocks actions requiring free movement until explicitly removed.

Inside the cellar, active opposition is resolved through the same Player-facing Check flow as every other uncertain action. There is no initiative, round structure, Non-Player Character turn, or opposed roll. Each validated outcome advances the visible Resistance Clock, advances the visible Danger Clock, or applies another predeclared Mechanical Effect. Filling Resistance commits the authored successful ending; filling Danger or reaching zero Health commits a non-death Defeat, applies its consequences, and enters a consequence Scene.

While a Confrontation is active, its Clock totals and filling consequences remain
visible and rebuild entirely from canonical events. Ending it tears down those
Confrontation-only projections and short-lived conversation records while
retaining committed Adventure facts, Mechanical Effects, and attributable World
Knowledge. Conversation records belong to the open Adventure session, never to
the canonical Timeline or an Evidence Bundle, and are discarded on Scene or
Timeline changes and when the Adventure closes.

Player-facing World Knowledge queries carry an explicit Player Character
identity. A Player Character observes only entries in that character's
Knowledge Scope; another Player Character and an unauthenticated actor observe
none of those entries. This filtering happens before accepted events are
retrieved or budgeted into an Evidence Bundle, so rules explanations,
Narration, model calls, diagnostics, replay, and portable archives retain the
same boundary. Format-v1 knowledge that used the original generic `Player
Character` scope remains assigned to the primary Player Character.

Campaign-scale actor-scoped retrieval enters through one Retrieval Boundary with explicit
Player actor, Player Character, campaign, Model Task, and ruleset-version
scope. It deterministically links stable IDs, names, aliases, pronouns,
locations, active participants, and recent referents; traverses only visible
typed World Knowledge Relationships; selects only matching approved rule
packages at the requested version; and includes only causally relevant or
bounded-recent accepted events. Forbidden candidates are removed before
deduplication, ranking, and item budgeting. Every selected item retains its
stable ID, source, `Player-visible` Visibility, inclusion reason, and exact
source citation when applicable.

Integrations may render an actor-scoped World Knowledge projection as Adventure
Markdown: structured JSON frontmatter for machine review followed by derived,
descriptive prose for people. Rereading an unchanged document is a no-op. An
external edit is compared with both its exported revision and current canonical
state; stale, simultaneous, contradictory, malformed, and unauthorized edits
produce a Review Conflict without changing the Adventure. A supported Reveal
edit becomes a validated command, and World Knowledge changes only if the
application commits its canonical Reveal event. Adventure Markdown is therefore
a review surface, not a second history or a replacement for portable archives.

Rule Authoring accepts a bounded, versioned Rule Source whose sections and
passages retain stable anchors, exact text, and layout metadata. A separately
extracted draft is validated into a deeply immutable Rule Candidate: trigger,
prerequisites, inputs, procedure, outcomes, and name each cite exact source
passages or carry an Authored Interpretation with reviewer identity. Ingestion
cannot approve, register, publish, or execute the candidate; those remain
explicit later application boundaries.

A Rule Review correlates that exact candidate version with its source,
extracted fields, normalized rule, validation findings, and generated
conformance examples. A reviewer records an explicit approved, rejected, or
superseded decision. Only a valid, version-matched approval can produce the
versioned Executable Ruleset Package, whose manifest, licensing metadata,
field citations, and checksum are immutable. When supplied to Structured Play,
the package governs the existing deterministic Check runtime; the committed
trace and Player-facing rules answer identify both the package rule and exact
source passages. A candidate or tampered package is rejected before play and
cannot append an event.

Re-ingestion validates the complete Rule Source before deciding whether it is
unchanged. Byte-identical input and source-version or layout-only changes reuse
the existing executable package; a meaningful cited-field change produces a
Rule Candidate Diff with both old and new passages. Missing Check inputs,
unresolved references, reference cycles, and contradictory cited mechanics
block approval with narrowly attributable diagnostics. Rule Version History
retains prior packages unchanged when a later candidate is rejected, and a
corrected candidate may be reviewed and published under a new unique package
version.

The locked manor is a non-linear graph rather than a mandatory sequence. Visible Oracle answers and Established Facts can route the Player from arrival into social discovery or directly to the Confrontation. Social discovery can reveal the cellar route or resolve the mystery without a Confrontation. The Player may also withdraw with the mystery unresolved, while Confrontation victory and Defeat lead to favourable and adverse endings. Scene transitions and Adventure endings occur only when committed events satisfy pre-authored exit conditions; the Narrator cannot end either one. The Structured Play path completes every route with no language-model calls.

Structured Play also exposes Timeline controls after the first accepted event. The Player can branch from any accepted event position to explore another choice without deleting or rewriting the source Timeline, and can select any existing Timeline to inspect or resume it. Each Timeline appends and projects independently. A child inherits the parent's random-stream position at its branch point, so repeating identical confirmed play reproduces the same Check and Oracle rolls rather than granting a reroll. Both repository adapters share this contract, and the local durable repository preserves every Timeline history, relationship, active selection, and random position across process restarts.

Applications may provide a replaceable interpretation model for natural-language play. It receives an immutable snapshot of the Player's utterance, Player-visible Established Facts and entities, and currently available capabilities—never the application or event store. Its strictly validated classification may select one exposed capability, but application code creates the command and routes it through the same Check Proposal, Pending Choice, Oracle Likelihood, rules, and event boundaries as Structured Play. Ambiguity, unavailable capabilities, nonexistent entity references, invalid schema, timeout, or adversarial authority fields append no gameplay events and ask for clarification or reject safely.

The expanded provider-neutral contract separates Discourse Classification,
intent extraction, Rule Match Suggestion, and State Proposal tasks. Rule matching
has explicit `no-rule` and `needs-adjudication` outcomes. A State Proposal becomes
only a candidate command after actor authorization, exact schema, entity and
capability existence, Evidence Bundle citations, exact ruleset version, and
domain invariants all pass. The versioned 100-example baseline and results are
documented in the [Model Task evaluation report](docs/model-task-evaluation-report.md).
Expanded task results also expose Model Call, Evidence Bundle, evidence-item,
and exact rule IDs so a presentation can render its evidence and rule trace on
demand while the underlying Model Call Records remain outside the Timeline.

Applications may also provide a replaceable presentation model to narrate an outcome only after its events commit. The model receives an immutable snapshot containing only Player-visible Established Facts, the committed resolution trace, and the just-appended events—never the private deterministic fallback, an application command, or an event-store handle. Schema-invalid, contradictory, timed-out, or mechanically ungrounded output falls back to the private deterministic summary without replaying the action. The Player may regenerate narration or ask a grounded rules question repeatedly from the same committed inputs; neither interaction appends events or changes projected game state. Without a presentation model, Structured Play continues to use deterministic summaries.

The Scene Orchestration boundary coordinates classified input through
application-owned `proposed`, `active`, `resolving`, `paused`, and `ended`
lifecycle states. These states and every non-linear exit are projections of
canonical events, so replay and Timeline branches reproduce them without model
calls. Actor-authorized Game Master approval, edit, rejection, and override
decisions retain an attributable audit record and still submit ordinary
validated commands. Final Narration receives a committed snapshot only after
required Player choices and deterministic resolution finish; invalid claims
select the deterministic summary, and presentation-only regeneration cannot
append events or change projections.

The bounded Milestone B journey in `src/ten-scene-adventure.ts` composes these
boundaries across ten authored Scenes. The same confirmed choices complete it
through offline Structured Play or scripted model assistance with equivalent
commands, canonical events, random results, projections, lifecycle exits, and
ending. Its release scenario also exercises a reviewed Adventure Markdown
Reveal, exact published-rule citations, attributable retrieval, a Game Master
checkpoint, deterministic Narration and rules fallbacks, Pending Choice and
Scene-boundary restoration, Timeline branches around a discovery, and portable
export/import that excludes Model Call Records and conversation context.

For development:

```sh
npm test
npm run typecheck
npm run --silent evaluate:golden
```

The golden evaluation command prints a machine-readable report for the
versioned locked-manor campaign across every supported repository, scripted
provider, executable ruleset package, and presentation combination. A non-zero
exit status identifies a layer-specific mismatch against the committed golden
outputs.

## OpenAI-backed Natural Language Play

Structured Play remains the default and works offline. To enable the explicit
Natural Language Play mode with the OpenAI adapter, create an ignored
`.env.local` file at the repository root:

```dotenv
AI_TTRPG_MODEL_PROVIDER=openai
OPENAI_MODEL=gpt-5.6
OPENAI_API_KEY=your-project-api-key
AI_TTRPG_MODEL_TIMEOUT_MS=5000
```

Then start or reopen an Adventure in Natural Language Play:

```sh
npm start -- --mode natural-language create "The Locked Manor"
npm start -- --mode natural-language open <adventure-id>
```

Provider, model, credentials, and deadline are runtime configuration; they are
not Adventure state. If any required setting is missing or the deadline is not
a positive integer, Natural Language Play is unavailable and the CLI offers
Structured Play. Raw diagnostic capture is disabled by default. To explicitly
capture redacted local Model Task diagnostics, set
`AI_TTRPG_MODEL_DIAGNOSTIC_PATH` to a writable local JSONL path. Never commit
that file.

The adapter uses the stateless [Responses API](https://platform.openai.com/docs/api-reference/responses/create)
with `store: false` and task-specific [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
It sends no `previous_response_id`; each request contains only explicit Model
Task input and one Evidence Bundle.

Required tests use scripted or local HTTP adapters and make no paid calls. After
setting the runtime variables above, the separately opt-in real-provider smoke
test is:

```sh
npm run test:openai-smoke
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
| [Milestone B release report](docs/milestone-b-release-report.md) | Phase 5–9 evidence matrix, measured evaluations, provider-portability proof, and exit decision. |
| [Durable Adventure simulation report](docs/adventure-simulation-release-report.md) | Deterministic 100-turn recovery, replay, leakage, and duplicate-event release evidence. |
| [Actor-scoped retrieval evaluation](docs/retrieval-evaluation-report.md) | Labelled retrieval quality thresholds, results, and semantic-fallback decision. |
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
