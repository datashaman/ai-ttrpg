# AI-Powered Tabletop RPG Engine

## NLSpecs-Style Implementation Specification

**Status:** Draft implementation plan  
**Scope:** System- and setting-agnostic tabletop RPG engine  
**Implementation stance:** Language- and framework-agnostic  
**Primary architecture:** Event-sourced simulation with deterministic mechanics and LLM-assisted interpretation and narration

---

## 1. Purpose

Build an AI-assisted tabletop RPG engine that can interpret player input, retrieve relevant rules and world facts, resolve mechanics deterministically, update persistent campaign state, and present coherent narration without allowing a language model to become the authority for dice, rules, or stored facts.

The finished platform should support:

- Multiple tabletop RPG systems through replaceable rulesets.
- Text play first, then voice and virtual tabletop integrations.
- Solo, cooperative, and GM-assisted modes.
- Persistent worlds, campaigns, encounters, and conversations.
- Replayable, auditable, reversible state changes.
- Human-reviewed ingestion of published or custom rules.
- Replaceable storage, model, interface, and integration adapters.
- Safe extension by third-party systems and tools.

## 2. Guiding Principles

1. **Code owns truth.** Deterministic services own dice, calculations, constraints, event validation, and state mutation.
2. **The LLM proposes; the engine disposes.** Models classify, extract, interpret, summarize, and narrate through constrained interfaces.
3. **Events are canonical.** Current state is a projection of an append-only event history.
4. **Rules are data.** A game system is represented by versioned, executable definitions and explicitly coded primitives where necessary.
5. **Memory is layered.** World, campaign, encounter, and conversation memory have different owners and lifecycles.
6. **Retrieval is evidence.** Model outputs should be grounded in attributable rules, entities, and events.
7. **Human review is a feature.** Ambiguous extracted rules and consequential model proposals must support approval workflows.
8. **Every boundary is replaceable.** Models, databases, vaults, VTTs, speech providers, and user interfaces are adapters.
9. **The core works offline.** A deterministic game loop, event log, projections, and hand-authored rules must function without an LLM.
10. **Build a vertical slice before a platform.** Each phase must leave a testable end-to-end capability.

## 3. System Context

### 3.0 Visual companions

The specification includes three standalone interactive diagrams. Each supports dark/light themes and export to PNG, JPEG, WebP, or SVG.

1. [System architecture](system-architecture.html) — component boundaries, authority, and replaceable adapters.
2. [Player-turn sequence](player-turn.html) — interpretation, deterministic resolution, commit, projection, and narration.
3. [Event-sourced world state](event-sourcing.html) — commands, immutable events, rebuildable projections, and downstream consumers.

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

### 3.1 Logical components

- **Input adapters:** CLI, web, mobile, voice, VTT, automation.
- **Discourse classifier:** Distinguishes player action, in-character speech, rules query, table chat, out-of-character request, and system command.
- **Scene controller:** Coordinates a single turn without embedding system-specific rules.
- **Retrieval service:** Resolves entities, relationships, relevant events, and cited rules.
- **Rules registry:** Stores approved, versioned executable rules.
- **Deterministic runtime:** Evaluates commands, dice, modifiers, resources, timing, and outcomes.
- **Oracle service:** Implements Mythic-style or other solo-GM procedures as optional rules modules.
- **Event store:** Canonical append-only campaign history.
- **Projection engine:** Builds queryable current state from events.
- **Event bus:** Delivers committed events to independent subscribers.
- **LLM gateway:** Constrains model access, schemas, retries, tracing, budgets, and provider replacement.
- **Narrator:** Produces presentation text from facts and committed outcomes.
- **Integration adapters:** Obsidian or Markdown vaults, VTTs, speech providers, webhooks, and export formats.

## 4. Core Domain Vocabulary

| Term | Meaning |
|---|---|
| Entity | Stable identity for a character, object, place, faction, quest, scene, or abstract game object. |
| Component | Typed state attached to an entity, such as Health, Location, Inventory, or Attitude. |
| Relationship | Typed, directional link between entities with optional attributes and validity dates. |
| Command | A request to attempt a state transition. It may be rejected. |
| Event | An immutable fact that has occurred and was accepted by the runtime. |
| Rule | A versioned definition of triggers, prerequisites, resolution, costs, and outcomes. |
| Ruleset | A versioned collection of rules, schemas, terminology, and runtime extensions. |
| Projection | Derived query model rebuilt from the event stream. |
| Scene | A bounded narrative context with participants, location, goals, and lifecycle. |
| Encounter | A scene with stricter turn, timing, resource, or spatial constraints. |
| Thread | An unresolved narrative question, objective, threat, promise, or mystery. |
| Oracle | A deterministic or random procedure for answering uncertain narrative questions. |
| Evidence | Source material supplied to a model: rules, entities, relationships, and event excerpts. |

## 5. Reference Domain Model

The model begins with general primitives rather than fixed fantasy classes.

```text
Entity
  id, kind, name, tags, lifecycle

Component
  entity_id, component_type, schema_version, data

Relationship
  source_id, type, target_id, attributes, valid_from, valid_to

Command
  id, campaign_id, actor_id, type, parameters, causation_id

Event
  id, stream_id, sequence, type, payload, metadata,
  timestamp, actor_id, correlation_id, causation_id, schema_version

Rule
  id, ruleset_version, trigger, prerequisites, procedure,
  outcomes, citations, status
```

Common optional components include Identity, Traits, Attributes, Resources, Health, Inventory, Equipment, Capabilities, Conditions, Location, Position, Membership, Reputation, Knowledge, Clock, Objective, and Ownership.

Example event families include EntityCreated, ComponentAttached, ResourceChanged, RollRequested, RollResolved, CheckResolved, DamageApplied, ConditionAdded, ItemTransferred, EntityMoved, RelationshipChanged, ThreadOpened, ThreadAdvanced, SceneStarted, SceneEnded, and RuleInvoked.

## 6. Cross-Cutting Quality Requirements

- Every committed event has a unique ID, ordered stream position, type, schema version, timestamp, correlation ID, causation ID, and origin.
- Replaying the same event stream with the same projection version produces identical state.
- Random operations can accept a recorded or injected seed and always record their result.
- No model-generated content mutates canonical state without schema and invariant validation.
- Every mechanically significant outcome links to the rule version and source passage used.
- Sensitive provider credentials never enter prompts, logs, exported campaigns, or client-side bundles.
- A campaign can be exported without dependence on a specific model or storage provider.
- Core observability records latency, token use, model calls, retrieval evidence, commands, events, rejections, and errors.

---

# Implementation Phases

## Phase 0 — Product Boundaries and Executable Scenarios

### Objective

Define what the first product does, what it deliberately excludes, and which scenarios will prove the architecture.

### Deliverables

- Product charter and glossary.
- Supported play-mode matrix.
- Ten canonical end-to-end scenarios.
- Initial non-functional requirements and risk register.
- Explicit v1 exclusions.

### Implementation steps

1. Use the initial slice: one solo player with no human GM, natural-language and structured text input, an original hand-authored 2d6 micro-ruleset, and a three-scene fantasy mystery set in a locked manor.
2. Resolve uncertain actions as `2d6 + trait`: 6 or less is a Setback, 7–9 is a Success with Cost, and 10 or more is a Clean Success.
3. Offer arrival and exploration, social discovery, and confrontation scenes as a non-linear graph, allowing event-driven scene skipping and favourable, adverse, or unresolved endings through combat and non-combat paths.
4. Treat unanswered questions about the world as unresolved propositions until play makes an answer relevant; the oracle then establishes a player-visible fact. Defer persistent facts hidden from the player.
5. Start with one pregenerated player character whose Health and Resolve are fixed; whose inventory contains a Lantern, Lockpick Set, Short Blade, and Field Kit; and whose name, pronouns, motivation, and one-time assignment of +0, +1, and +2 among Might, Wits, and Presence the player chooses during setup.
6. Prevent Trait reassignment after the adventure begins, and defer full character creation and advancement.
7. Treat the player character's motivation as fictional context only, with no modifier, resource, oracle, or outcome-stake effect.
8. Describe canonical scenarios as Given/When/Then examples, including free action, check, player-facing contested action, resource use, confrontation exchange, rules query, invalid command, save/reload, undo-by-branching, and scene transition.
9. Define authority boundaries among player, human GM, deterministic engine, ruleset, oracle, and LLM.
10. Define latency, cost, durability, privacy, portability, and accessibility targets.
11. Mark voice, automatic PDF execution, rich tactical maps, and multiplayer synchronization as later phases.

### Acceptance criteria

- At least 10 canonical scenarios have unambiguous expected commands, events, state, and user-visible outcomes.
- Every proposed feature maps to a phase or is explicitly out of scope.
- The authority matrix states who may propose, validate, commit, override, and narrate each outcome.
- Stakeholders can explain the v1 vertical slice using the same domain terms.
- A new player can complete the locked-manor adventure without documentation in moderated testing.
- Natural-language and Structured Play modes can each complete the adventure through at least one Confrontation ending and one non-Confrontation ending.
- Replaying every v1 fixture produces identical projected state, including after save/resume and branching.
- Save/resume restores every pending choice with its recorded random result unchanged.
- Branching preserves the source timeline and inherits its random-stream position.
- Language-model failure returns a playable mechanical summary, and no model output can directly commit or alter game state.

## Phase 1 — Architecture Contracts and Repository Skeleton

### Objective

Establish module boundaries and stable interfaces without choosing permanent infrastructure.

### Deliverables

- Architecture decision records.
- Logical component map.
- Interface contracts for storage, models, rules, retrieval, randomness, and integrations.
- Dependency rules and minimal runnable shell.

### Implementation steps

1. Separate domain, application orchestration, infrastructure adapters, and delivery interfaces.
2. Define ports for event storage, snapshots, projections, rules, documents, model calls, embeddings, clocks, random sources, speech, and VTT transport.
3. Define request, response, error, cancellation, idempotency, and versioning behavior for every port.
4. Create a minimal application that accepts a command and emits an in-memory event.
5. Add automated checks that prevent the domain layer from importing infrastructure or provider code.

### Acceptance criteria

- The application runs with in-memory adapters and no external services.
- A model provider, event store, or user interface can be replaced without modifying domain rules.
- Contract tests exist for every public port.
- A command can traverse input → application service → domain → event store in one automated test.

## Phase 2 — Domain Kernel and Schema Governance

### Objective

Implement stable identities, components, relationships, commands, events, and schema evolution.

### Deliverables

- Domain schemas and invariants.
- Entity/component/relationship registry.
- Command and event envelope specifications.
- Schema migration and compatibility policy.
- Example campaign fixture.

### Implementation steps

1. Define opaque IDs, campaign and stream boundaries, event ordering, and optimistic concurrency semantics.
2. Define component schemas independently from specific game systems.
3. Define relationship direction, attributes, temporal validity, and deletion semantics.
4. Define command rejection as a result, not an event pretending something happened.
5. Add schema versions, upcasters, deprecation rules, and unknown-event handling.
6. Create fixtures for a character, locked door, location, faction, quest thread, and active scene.

### Acceptance criteria

- Invalid components, relationships, commands, and event envelopes fail with machine-readable errors.
- Old event fixtures can be read after a schema version increment through tested upcasters.
- Entity types can be extended without changing the base Entity schema.
- Two concurrent writes to the same stream cannot silently overwrite one another.
- The example campaign serializes and deserializes without loss.

## Phase 3 — Event Store, Projections, and Branching

### Objective

Make the event stream canonical and derive all mutable world views from it.

### Deliverables

- Append-only event store.
- Projection runner and checkpoints.
- Core world, campaign, scene, and audit projections.
- Snapshot support.
- Branch/fork mechanism for alternate timelines.

### Implementation steps

1. Implement atomic append with expected stream version and idempotency keys.
2. Implement ordered reads by stream, campaign, correlation, and time.
3. Build projections for entities/components, relationships, timeline, active scene, open threads, and resources.
4. Record projection versions and resumable checkpoints.
5. Add snapshots as disposable optimization, never canonical data.
6. Implement rewind exclusively by creating a new timeline from a selected event position; preserve the original timeline unchanged and available for inspection or continuation.
7. Copy the parent's random-stream position into a new timeline so repeating the same confirmed action from the same branch point reproduces the same roll.
8. Add event export and import with integrity checks.
9. Persist every accepted event immediately and project pending player choices so interruption after a revealed roll resumes with the identical roll and unresolved choice.

### Acceptance criteria

- Replaying a fixture of at least 10,000 events produces byte-equivalent normalized projections on repeated runs.
- A failed append writes no partial events.
- Retrying an idempotent command does not duplicate events.
- Deleting all projections and rebuilding them restores the same state.
- Rewinding never deletes or rewrites an accepted event, and continuing either timeline appends events only to that timeline.
- A branched timeline given the same confirmed commands as its parent produces the same random results from the branch point.
- Closing and resuming after any accepted event restores the active timeline and any pending choice without rerolling or silently advancing resolution.
- A branch can diverge from its parent while the parent remains unchanged.
- Corrupt or out-of-order imports are rejected with a diagnostic report.

## Phase 4 — Deterministic Rules Runtime

### Objective

Resolve mechanics reproducibly without delegating arithmetic, legality, dice, or outcome selection to an LLM.

### Deliverables

- Rule definition schema.
- Rule registry and version resolver.
- Dice/random service.
- Percentile oracle with Unlikely (25%), Even (50%), and Likely (75%) odds.
- Expression and modifier evaluator.
- Command handlers for the initial micro-ruleset.
- Rules trace format.

### Implementation steps

1. Model rules as trigger, prerequisites, inputs, procedure, costs, outcomes, and citations.
2. Support deterministic primitives: dice, comparisons, tables, clocks, resource changes, tags, conditions, and effect composition.
3. Inject the random source; record seed or entropy reference, individual rolls, modifiers, and final result.
4. Reject invalid expressions, excessive dice, missing inputs, illegal targets, and unmet prerequisites.
5. Produce a human-readable and machine-readable trace for each resolution.
6. Hand-author 10–20 rules spanning action checks, damage, conditions, inventory, player-facing contested actions, and confrontation clocks.
7. Allow the narrator to recommend an oracle likelihood with evidence from established facts, but require the player to confirm or change it before rolling.
8. Resolve oracle questions with a recorded percentile roll: at or below the confirmed likelihood is Yes and above it is No; results from 01–05 and 96–100 attach an exceptional consequence.
9. Treat routine actions as free actions; when uncertainty and meaningful consequences require a check, have the narrator propose the intended goal, trait, and explicit stakes for Setback, Success with Cost, and Clean Success, then require player confirmation before rolling.
10. Restrict mechanically significant stakes to ruleset-defined effects that pass deterministic validation; allow fictional consequences only as explicit established facts with no hidden mechanical modifier.
11. Let the player correct the interpreted goal or trait, revise the attempted action, or withdraw; do not allow direct editing of outcome stakes while retaining the same action, and validate a fresh proposal after any revision.
12. Resolve contested actions with one player-facing check; represent non-player character capability through validated stakes, conditions, and clocks rather than an opposed roll.
13. Resolve confrontations without initiative, rounds, movement grids, or non-player character turns: successes advance a Resistance Clock, while costs and Setbacks may advance a Danger Clock or apply another predeclared effect.
14. Exclude player character death from the initial ruleset; a filled Danger Clock or depleted Health causes a predeclared defeat such as capture, forced retreat, incapacitation, or a lasting condition and transitions to a consequence scene.
15. After revealing a check roll but before committing its outcome, allow the player to spend at most one Resolve to add +1 to the final total; record the original roll, spend, adjusted total, and selected predeclared stakes together.
16. Start Health and Resolve at 3, constrain both to the inclusive range 0–3, and treat ordinary harm as one Health loss; zero Health causes Defeat, while zero Resolve only prevents further Resolve spending.
17. Provide one Field Kit in the fixed inventory; outside a confrontation, consuming it restores either one Health or one Resolve, with no passive recovery during the adventure.
18. Treat inventory items as fictional permission rather than numeric bonuses and track only carried or removed state; any loss, breakage, surrender, or consumption must be a predeclared, validated stake and removes the item.
19. Limit the initial Condition catalogue to Shaken, which prevents Resolve spending, and Restrained, which prevents actions requiring free movement; neither changes a numeric modifier.
20. Clear Shaken when its Scene ends; persist Restrained across Scene transitions until an established fact or successful action explicitly removes it.

### Acceptance criteria

- Given identical state, command, ruleset version, and random input, resolution emits identical events and trace.
- The LLM is not called by any deterministic rule test.
- Each accepted mechanical event cites the invoked rule and version.
- Property tests cover dice bounds, modifier ordering, resource floors/ceilings, and invariant preservation.
- At least 95% of the canonical mechanical scenarios execute solely through registered rules; remaining cases are explicitly deferred or require GM adjudication.
- Oracle traces expose the proposition, recommended and player-confirmed likelihoods, percentile roll, Yes or No answer, and any exceptional consequence to the player.
- No check rolls before the player confirms its goal, trait, and all three outcome stakes; the committed result applies only the matching predeclared stakes, and free actions produce no roll.
- A narrator-proposed stake containing an undefined or invalid mechanical effect is rejected before it reaches the player.
- Reject execution of any proposal whose action or trait changed after validation; revised actions receive a new complete proposal.
- A confrontation ends in the matching predeclared outcome when its Resistance Clock or Danger Clock fills, and replaying its exchanges reproduces the same clock state.
- Defeat never silently ends the adventure or kills the player character; it commits the declared consequence and starts the corresponding consequence scene.
- A Resolve spend cannot occur after a check outcome is committed, cannot reduce Resolve below zero, and deterministically selects the outcome band from the adjusted total.
- Resource changes reject values outside 0–3; ordinary harm removes exactly one Health unless a cited rule explicitly says otherwise.
- The Field Kit cannot be used during a confrontation, cannot restore a resource above 3, and is removed after one valid use.
- Removed inventory items grant no fictional permission; no rule creates a damaged or repairable item state in v1.
- While Shaken, Resolve spending is rejected; while Restrained, an action requiring free movement is rejected before a Check Proposal is produced.
- Scene transition removes Shaken but not Restrained, and replay reproduces the same Condition lifecycle.

## Phase 5 — World State and Memory Layers

### Objective

Represent persistent world knowledge while separating long-lived facts from encounter and conversation state.

### Deliverables

- World, campaign, encounter, and conversation memory specifications.
- Entity and relationship projections.
- Markdown/vault adapter.
- Conflict and provenance model.
- Import/export format.

### Implementation steps

1. Assign ownership: event store for canonical facts, projections for current state, VTT adapter for synchronized encounter views, and conversation store for short-lived dialogue.
2. Represent lore statements with provenance, confidence, visibility, and in-world knowledge scope.
3. Support public, GM-only, character-known, and unknown information.
4. Implement a Markdown adapter using frontmatter for structured fields and prose for descriptive content.
5. Detect external edits and translate valid changes into commands rather than editing projections directly.
6. Define deterministic conflict handling for simultaneous or contradictory updates.

### Acceptance criteria

- A campaign round-trips through the portable export format without losing entities, relationships, events, visibility, or provenance.
- Unauthorized character context never includes GM-only fixture data in automated tests.
- External Markdown edits either produce validated events or a clear review conflict.
- Encounter teardown preserves campaign consequences but removes ephemeral encounter-only state.
- A fact’s origin can be traced to an import, human edit, rule outcome, or model proposal.

## Phase 6 — Rule Authoring and Ingestion Pipeline

### Objective

Convert rulebooks and custom material into reviewed, cited, executable rule packages.

### Deliverables

- Document ingestion pipeline.
- Source passage and citation store.
- Candidate-rule schema.
- Review workspace and approval lifecycle.
- Ruleset package manifest and validation suite.

### Implementation steps

1. Ingest text and layout metadata from supported document formats while retaining page/section anchors.
2. Segment by headings, tables, examples, exceptions, definitions, and cross-references.
3. Extract candidate terminology, entities, procedures, tables, prerequisites, outcomes, and exceptions.
4. Link every candidate field to one or more source passages.
5. Validate candidates structurally and identify missing inputs, cycles, unresolved references, and contradictions.
6. Require human approval before candidates enter an executable ruleset.
7. Generate conformance examples and tests from approved rules.
8. Version signed or checksummed ruleset packages with licensing metadata.

### Acceptance criteria

- No extracted candidate becomes executable without an explicit approval record.
- Every executable field has a source citation or is marked as an authored interpretation with reviewer identity.
- Reviewers can compare source, extraction, normalized rule, and generated tests in one workflow.
- A benchmark set measures extraction precision and recall separately for triggers, prerequisites, procedures, outcomes, tables, and exceptions.
- Unresolved cross-references and contradictory candidates block publication.
- Re-ingesting an unchanged source creates no semantic changes.

## Phase 7 — Retrieval and Context Assembly

### Objective

Provide the smallest relevant, attributable context for interpretation, adjudication, rules answers, and narration.

### Deliverables

- Entity-link retrieval.
- Rule retrieval.
- Event/time retrieval.
- Optional semantic index.
- Context assembly policy and evidence bundle.
- Retrieval evaluation corpus.

### Implementation steps

1. Resolve explicit IDs, aliases, names, pronouns, locations, participants, and recent referents.
2. Traverse typed relationships within bounded depth and visibility rules.
3. Retrieve rules by capability, trigger, terminology, active conditions, and ruleset version.
4. Retrieve recent and causally relevant events rather than entire session logs.
5. Add semantic search as a fallback, with filters for campaign, source, visibility, and version.
6. Deduplicate, rank, budget, and label every context item.
7. Return an evidence bundle distinct from prompt prose.

### Acceptance criteria

- A labelled benchmark reports precision@k, recall@k, mean reciprocal rank, and forbidden-data leakage.
- Entity-link retrieval correctly resolves at least 95% of unambiguous benchmark mentions.
- Every supplied context item has an ID, source, visibility label, and retrieval reason.
- Context assembly respects a configured token/size budget and degrades predictably.
- No hidden fixture is retrieved for an unauthorized actor.
- Rules answers can cite the exact approved rule and source passage.

## Phase 8 — LLM Gateway and Structured Intelligence

### Objective

Introduce models behind narrow, observable, replaceable, schema-constrained tasks.

### Deliverables

- Provider-neutral LLM interface.
- Structured schemas for classification, intent, rule candidates, and state proposals.
- Prompt/version registry.
- Validation, retry, fallback, and budget policies.
- Safety and adversarial test suite.

### Implementation steps

1. Implement task-specific calls rather than a single general agent prompt.
2. Begin with discourse classification: player action, in-character speech, rules query, out-of-character request, table chat, and system command.
3. Add intent extraction that references known entities and registered capabilities.
4. Add constrained rule-match suggestions and explicit `no_rule`/`needs_adjudication` outcomes.
5. Add state-change proposals that must pass authorization, schema, existence, and invariant checks before conversion into commands.
6. Record model, prompt version, evidence IDs, latency, cost, output, validation result, and retry path.
7. Implement deterministic fallbacks and human escalation when confidence or validation fails.

### Acceptance criteria

- Model output cannot append directly to the event store.
- All structured outputs pass strict schema validation before use.
- A 100+ example classification set reports per-class precision, recall, F1, and confusion matrix.
- Adversarial player text cannot override system boundaries or expose hidden benchmark facts.
- Provider replacement passes the same contract and evaluation suite.
- Budget limits, timeouts, cancellation, retry caps, and fallback behavior are tested.

## Phase 9 — Scene Orchestration and Narration

### Objective

Complete the text-first game loop from utterance through committed events to grounded presentation.

### Deliverables

- Scene lifecycle state machine.
- Turn orchestration service.
- Narration contract.
- Rules-query and adjudication flows.
- Human approval checkpoints.

### Implementation steps

1. Define scene states such as proposed, active, paused, resolving, and ended.
2. Convert classified player input into zero or more candidate commands.
3. Retrieve evidence, select applicable rules, request missing choices, and resolve commands.
4. Commit events before generating final narration.
5. Generate narration solely from the player input, visible evidence, resolution trace, and committed events.
6. Separate fictional color from mechanically binding claims.
7. Validate narration for contradictions such as wrong names, impossible locations, incorrect resources, or uncommitted outcomes.
8. Support GM approval, edit, override-as-command, and regenerate-presentation-only actions.
9. Define pre-authored exit conditions for each scene and end it automatically only when a committed event satisfies one; narration presents but never decides the transition.
10. Let an exit condition target another authored scene or an adventure ending, including paths that skip scenes or resolve the adventure without a confrontation.
11. If narration fails after events commit, return a deterministic mechanical summary and offer presentation-only regeneration from the same visible evidence, trace, and committed events; never repeat or roll back the action.

### Acceptance criteria

- All 10 canonical Phase 0 scenarios run end to end through the text interface.
- Re-generating narration never changes events or projected state.
- Narration states no mechanically binding outcome absent from committed events in the evaluation set.
- Rules queries do not advance the scene unless the user separately issues a command.
- Table chat and out-of-character input do not trigger game events.
- Every response can display its rule trace and evidence on demand.
- Replaying the same committed events satisfies the same scene exit condition and produces the same lifecycle transitions.
- No scenario requires an inactive scene merely because it appears earlier in an authored sequence; only satisfied transition conditions determine the path.
- Narration failure still returns the committed outcome, and any number of regeneration attempts leave the event stream and projections byte-equivalent.

## Phase 10 — Testing, Simulation, and Evaluation Harness

### Objective

Measure correctness, consistency, experience quality, safety, latency, and cost continuously.

### Deliverables

- Layered automated test suite.
- Replay and simulation harness.
- Golden campaign fixtures.
- LLM and retrieval evaluation datasets.
- Quality dashboard and release gates.

### Implementation steps

1. Add unit tests for schemas, invariants, rules, projections, and permissions.
2. Add contract tests for every adapter and provider.
3. Add property-based tests for event replay, resources, random bounds, and serialization.
4. Add scenario tests that compare expected commands, events, projections, and visible output claims.
5. Build simulated players with fixed scripts and fuzzed paraphrases.
6. Measure classification, intent extraction, rule selection, retrieval, state proposal validity, contradiction rate, and citation accuracy.
7. Track p50/p95 latency, model calls per turn, cost per turn/session, retries, and context size.
8. Include human evaluation for coherence, agency, pacing, tone, rules trust, and recovery from misunderstanding.

### Acceptance criteria

- Release gates include zero replay divergence, zero unauthorized-state leakage, and zero uncited mechanical rule execution.
- Golden campaigns produce expected normalized state across supported storage adapters.
- Model and prompt changes run against fixed datasets before release.
- Test failures identify the responsible layer rather than only reporting an end-to-end mismatch.
- A 100-turn unattended simulation completes without corrupt state, duplicate events, or unrecoverable controller failure.
- Quality, latency, and cost regressions beyond configured tolerances block release.

## Phase 11 — User Interface and GM Control Surface

### Objective

Expose play, evidence, state, and intervention controls without overwhelming players.

### Deliverables

- Responsive text-play interface.
- Structured Play interface requiring no language model.
- GM dashboard.
- Character, scene, timeline, thread, and rules views.
- Event inspection and branch controls.
- Accessibility baseline.

### Implementation steps

1. Build the player loop around input, narration, choices, rolls, and clear system status.
2. Show compact mechanic summaries with expandable evidence and resolution traces.
3. Build GM queues for ambiguous intent, invalid proposals, rule conflicts, and ingestion review.
4. Add entity sheets, relationships, inventory, conditions, clocks, open threads, and scene participants.
5. Add timeline inspection, event correlation, branch creation, and comparison.
6. Support streaming presentation without treating partial text as committed state.
7. Add keyboard navigation, screen-reader semantics, reduced motion, contrast, captions hooks, and responsive layouts.
8. Provide deterministic prompts for authored actions, oracle questions, targets, and available choices so the full adventure remains playable without a language model.

### Acceptance criteria

- A new user completes a canonical scene without documentation in moderated testing.
- A GM can identify why an outcome occurred within three interactions from the narration view.
- Creating a branch never mutates or deletes the source timeline.
- Partial or interrupted streamed narration leaves committed state intact and recoverable.
- Core flows meet the selected accessibility conformance target.
- Usability testing records success rate, time on task, error rate, and trust rating for key workflows.
- Given equivalent confirmed choices, natural-language and Structured Play modes emit equivalent commands and committed events.

## Phase 12 — Voice and Real-Time Conversation

### Objective

Add speech while preserving discourse boundaries, turn control, privacy, and correction workflows.

### Deliverables

- Speech-to-text and text-to-speech adapters.
- Voice activity and turn-taking controller.
- Speaker identity and correction flow.
- Incremental transcript model.
- Voice performance evaluation.

### Implementation steps

1. Capture audio with explicit consent, retention settings, and visible listening state.
2. Perform streaming transcription with provisional and final segments.
3. Associate speakers using authenticated seats or explicit selection; treat diarization as uncertain evidence.
4. Classify finalized utterances before invoking game logic.
5. Require confirmation for low-confidence, high-impact commands.
6. Support interruption, cancellation, push-to-talk, transcript correction, and text fallback.
7. Generate speech only after response facts are committed; allow low-latency non-binding acknowledgements.

### Acceptance criteria

- Provisional transcripts never commit game events.
- Correcting a transcript before confirmation prevents the incorrect command from executing.
- Table chatter in the benchmark does not advance state above the agreed false-positive threshold.
- High-impact low-confidence commands require confirmation.
- End-of-utterance to first response audio meets the defined p95 target on supported environments.
- Users can inspect and delete retained audio/transcripts according to policy.

## Phase 13 — VTT and External Tool Integration

### Objective

Synchronize encounters and campaign consequences with virtual tabletops and knowledge tools through adapters.

### Deliverables

- Integration protocol and capability negotiation.
- Reference VTT adapter.
- Markdown/Obsidian synchronization adapter.
- Webhook or message adapter.
- Reconciliation and offline recovery tooling.

### Implementation steps

1. Define which system is authoritative for each datum during an encounter.
2. Map external IDs to stable engine entity IDs.
3. Translate external actions into engine commands and committed events into external updates.
4. Add idempotency, ordering, acknowledgement, retry, and dead-letter behavior.
5. Detect drift and present reconciliation choices rather than silently overwriting either side.
6. Negotiate optional capabilities such as tokens, maps, initiative, conditions, chat, handouts, and dice.
7. Provide a generic integration test kit and fake external endpoint.

### Acceptance criteria

- Repeated delivery of the same integration message causes no duplicate state change.
- Disconnecting and reconnecting restores synchronization without losing committed events.
- Conflicting edits produce a visible reconciliation record.
- Unsupported capabilities degrade gracefully without blocking unrelated play.
- The reference adapter passes mapping, ordering, retry, drift, and recovery tests.
- Core domain and deterministic rules contain no VTT-specific types.

## Phase 14 — Multiplayer, Permissions, and Collaboration

### Objective

Support multiple participants with authoritative ordering, scoped knowledge, and GM controls.

### Deliverables

- Campaign roles and permissions.
- Participant/session model.
- Real-time update protocol.
- Secret and per-character information controls.
- Concurrent command policy.

### Implementation steps

1. Define roles such as owner, GM, assistant GM, player, observer, and integration service.
2. Scope commands and projection fields by role, seat, character, and campaign.
3. Establish authoritative command ordering and conflict behavior.
4. Support private messages, secret checks, hidden entities, and selective reveals.
5. Add presence, reconnect, catch-up, and participant audit logs.
6. Make AI-generated content obey the requesting participant’s visibility scope.

### Acceptance criteria

- Permission tests cover every command and sensitive projection field.
- A player cannot infer hidden fixture data through retrieval, narration, errors, timing-sensitive detail, or exports.
- Concurrent conflicting commands resolve according to the documented policy and retain audit evidence.
- A disconnected participant catches up from an event cursor without a full reset.
- Removing a participant revokes access without corrupting campaign history.

## Phase 15 — Deployment, Operations, Security, and Recovery

### Objective

Operate the engine reliably in local and hosted configurations.

### Deliverables

- Deployment profiles.
- Configuration and secret management.
- Observability and alerting.
- Backup, restore, migration, and disaster-recovery procedures.
- Threat model and security review.
- Data retention and deletion controls.

### Implementation steps

1. Support a local single-user profile and a hosted multi-user profile using the same domain contracts.
2. Separate configuration from secrets and rotate provider credentials.
3. Add structured logs, metrics, traces, correlation IDs, health checks, and dependency status.
4. Redact secrets and sensitive campaign data from operational telemetry.
5. Back up event streams, ruleset packages, and required blobs; treat projections as rebuildable.
6. Test restore, point-in-time recovery, schema migration, and rollback or forward-fix procedures.
7. Threat-model prompt injection, malicious documents, unauthorized retrieval, extension abuse, event tampering, denial of service, and supply-chain risk.
8. Define retention, export, deletion, and consent behavior for campaigns, transcripts, audio, and model telemetry.

### Acceptance criteria

- A fresh environment can be deployed using documented configuration and automated checks.
- A disaster-recovery exercise restores a campaign and verifies event integrity within the target recovery time.
- Projection loss is repaired entirely from canonical events and approved rule packages.
- Logs and traces contain no known test secrets or hidden campaign fixtures.
- Dependency failure produces bounded degradation and actionable health status.
- Security review has no unresolved critical findings before hosted release.

## Phase 16 — Extension Platform and Ruleset SDK

### Objective

Allow third parties to add rulesets, projections, interfaces, or integrations without compromising the core.

### Deliverables

- Versioned extension manifest.
- Ruleset SDK and conformance kit.
- Capability and permission model.
- Extension lifecycle hooks.
- Compatibility policy and reference extensions.

### Implementation steps

1. Define extension types: declarative ruleset, deterministic runtime primitive, projection, retrieval source, UI view, input/output adapter, and event subscriber.
2. Require manifests to declare versions, capabilities, permissions, schemas, dependencies, and migrations.
3. Isolate executable extensions according to the deployment threat model.
4. Validate emitted commands and events through the same core pathways used by first-party code.
5. Provide fixtures, fake services, contract tests, packaging tools, documentation, and examples.
6. Define semantic versioning, compatibility windows, deprecation, signing, and revocation.
7. Publish one additional game-system ruleset and one external integration as proof of portability.

### Acceptance criteria

- A second materially different RPG system runs without modifying the core domain or event-store implementation.
- An extension cannot read hidden data or emit privileged commands without declared and granted capability.
- All reference extensions pass the conformance kit in an isolated test environment.
- Incompatible versions fail during installation with a clear explanation.
- Disabling a nonessential extension does not make canonical campaign history unreadable.
- Extension events remain portable through registered schemas and upcasters.

## Phase 17 — Production Readiness and General Availability

### Objective

Validate the complete product against real campaigns and establish sustainable release governance.

### Deliverables

- Alpha, beta, and general-availability release criteria.
- Pilot campaign program.
- Operational runbooks and support taxonomy.
- Data-driven backlog.
- Public compatibility and limitation statement.

### Implementation steps

1. Run internal alpha campaigns across the full canonical scenario set.
2. Run closed beta campaigns covering different rulesets, play styles, accessibility needs, and session lengths.
3. Capture structured defects by layer: classification, retrieval, rules, state, narration, UI, voice, integration, or operations.
4. Review model failures and add anonymized, consented cases to evaluation suites.
5. Measure retention, completion, intervention frequency, correction rate, trust, cost, and operational burden.
6. Freeze supported schema and extension compatibility guarantees for the first stable release.
7. Publish known limitations, data-handling behavior, backup expectations, and recovery paths.

### Acceptance criteria

- At least three full campaigns or agreed equivalent play hours complete without unrecoverable state corruption.
- Critical user journeys meet agreed success, latency, accessibility, and reliability targets.
- GM intervention and player correction rates are measured and within defined launch thresholds.
- Backup restoration and provider failover have been exercised in a production-like environment.
- No release-blocking security, privacy, data-loss, or rules-integrity defects remain.
- The team can identify and diagnose a failed turn using correlation data without reproducing it manually.

---

# Milestones and Exit Gates

## Milestone A — Offline deterministic prototype

**Includes:** Phases 0–4.  
**Demonstration:** A text command executes against a hand-authored ruleset, records deterministic events, and rebuilds the same state by replay.

**Exit gate:** No LLM is required to demonstrate a legal mechanical action, random roll, state change, audit trace, and replay.

## Milestone B — AI-assisted vertical slice

**Includes:** Phases 5–9.  
**Demonstration:** A player completes a ten-scene text adventure with classification, retrieval, deterministic resolution, grounded narration, persistent state, and rules citations.

**Exit gate:** The LLM can be disabled or swapped without making campaign history unreadable or mechanically ambiguous.

## Milestone C — Trustworthy product alpha

**Includes:** Phases 10–11.  
**Demonstration:** Players and GMs use a complete interface with evaluation, evidence inspection, intervention, replay, and branching.

**Exit gate:** Automated release gates protect rules correctness, replay determinism, visibility, latency, and cost.

## Milestone D — Connected play beta

**Includes:** Phases 12–14.  
**Demonstration:** Voice, a reference VTT, Markdown synchronization, and multiple participants operate through the same command/event core.

**Exit gate:** Disconnections, duplicates, corrections, concurrency, and hidden information are handled without silent corruption or leakage.

## Milestone E — Extensible production platform

**Includes:** Phases 15–17.  
**Demonstration:** Local and hosted deployments run multiple rulesets and integrations with tested recovery and extension governance.

**Exit gate:** Production readiness criteria and stable compatibility promises are satisfied.

# Recommended Delivery Order

Within every phase, prefer a thin end-to-end slice over completing one horizontal subsystem in isolation. The shortest sensible path is:

1. Hand-author one room, three entities, and ten rules.
2. Execute commands deterministically and record events.
3. Rebuild state from those events.
4. Add text classification and intent extraction.
5. Retrieve entities and rules with citations.
6. Narrate only committed outcomes.
7. Expand the evaluation set before expanding features.
8. Add rule ingestion as reviewed authoring assistance.
9. Add UI, then voice and VTT adapters.
10. Prove a second ruleset before declaring the core system-agnostic.

# Definition of Done for Any Feature

A feature is complete only when:

- Its authority and data ownership are documented.
- Inputs, outputs, errors, permissions, and idempotency are specified.
- Mechanically significant behavior is deterministic or records all randomness.
- State changes occur through validated commands and committed events.
- Event and schema evolution are addressed.
- Unit, contract, scenario, permission, and failure-path tests exist as applicable.
- Observability exposes latency, failures, correlation, and relevant cost.
- Export, replay, backup, and recovery implications are understood.
- User-facing evidence and corrective controls exist where trust is required.
- Documentation and acceptance criteria are updated.

# Principal Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Model invents rules or state | Constrained outputs, retrieved citations, deterministic runtime, post-generation contradiction checks. |
| Rule extraction appears more complete than it is | Candidate-only pipeline, field-level citations, benchmarks, mandatory human approval. |
| Event schemas become impossible to evolve | Versioned envelopes, upcasters, compatibility tests, immutable fixtures. |
| Retrieval leaks secrets | Visibility-aware indexing and filtering, adversarial tests, actor-scoped evidence assembly. |
| Narration and mechanics diverge | Commit first, narrate second, validate claims against events and projections. |
| VTT and engine fight over authority | Field-level ownership, idempotent messages, drift detection, explicit reconciliation. |
| Voice chatter advances play | Final-transcript gating, discourse classification, confidence thresholds, confirmation for consequential actions. |
| “System agnostic” becomes lowest-common-denominator design | General core plus ruleset-defined components and deterministic extension primitives; prove with a second contrasting system. |
| Costs and latency grow with campaign history | Layered memory, bounded retrieval, summaries as projections, caching, task-specific small models. |
| Extensions compromise integrity | Capabilities, isolation, signatures, conformance tests, core validation of all commands and events. |

# Final Success Criteria

The project is successful when all of the following are demonstrably true:

1. A campaign can be played, saved, replayed, exported, imported, branched, and recovered.
2. The same accepted commands, ruleset versions, and random inputs reproduce the same mechanical history.
3. Players can ask why an outcome occurred and receive the relevant rule, source, roll, modifiers, and event chain.
4. Language models improve interpretation and presentation without owning canonical truth.
5. Hidden information remains scoped to authorized participants across retrieval, model calls, UI, exports, and integrations.
6. A second contrasting RPG ruleset operates without changes to the core event and entity abstractions.
7. Voice and VTT integrations fail safely and recover without silent data loss.
8. Operators can diagnose, restore, migrate, and monitor the system using documented procedures.
9. Third-party extensions can add value through declared capabilities without bypassing validation.
10. Real campaigns complete with measured levels of trust, correctness, responsiveness, accessibility, and sustainable cost.
