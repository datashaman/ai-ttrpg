# Milestone B release report

Date: 2026-07-20

Scope: the AI-assisted vertical slice in PRD #69, delivered by issues #73–#83
and verified by issue #84 against the Phase 5–9 specification.

## Release decision

**Pass.** Milestone B is complete. The required deterministic gate has no
unresolved in-scope criterion. A Player can finish the bounded ten-Scene
Adventure with a scripted model or through Structured Play with no model; both
paths produce equivalent commands, accepted events, random results,
projections, Scene lifecycle transitions, exact rules traces, and ending.

Canonical Adventure history remains readable and mechanically unambiguous when
the model is disabled or replaced. Model Call Records and short-lived
conversation context remain outside Timelines and portable archives, while
replay, branching, reopen, and import rebuild Structured Play from accepted
events and the exact approved rules package.

## Required and optional commands

| Command | Requirement | Result |
| --- | --- | --- |
| `npm run verify:release` | Required | Pass: 424 deterministic tests passed, 1 opt-in real-provider test skipped, and TypeScript type checking passed |
| `npm run test:openai-smoke` | Optional | Not run; no hosted-provider evidence is claimed by this decision |
| `git diff --check` | Required before publication | Pass |

CI runs `npm run verify:release` on Node.js 24. It expands to `npm test && npm
run typecheck`, has no credential input, contains no hosted provider call, and
does not include the opt-in OpenAI smoke test. Scripted providers and injected
local transports exercise provider contracts without network access or paid
requests.

## Milestone demonstration

`test/ten-scene-adventure.test.ts` is the integrated release journey. It proves:

- Structured Play completes all ten authored Scenes with no model configured;
- equivalent confirmed model-assisted choices produce the same canonical
  journey, including deterministic random traces and cited package checksums;
- classified Model Tasks and ambiguous proposals cross explicit Game Master
  checkpoints before a command can commit;
- application validation rejects invalid rules or Narration claims and selects
  deterministic, grounded fallbacks;
- a Pending Choice and a completed Scene boundary reopen without rerolling;
- branches immediately before and after a reviewed discovery retain the exact
  event prefix, random position, and actor-scoped World Knowledge; and
- portable export/import restores the complete canonical Adventure while
  excluding Model Call Records, provider payloads, credentials, and
  conversation memory.

## Provider disablement and replacement

| Condition | Passing evidence |
| --- | --- |
| Disabled before play | `Structured Play completes the bounded ten-Scene Adventure without a model` reaches the authored ending through the same application authority. |
| Disabled after assisted play | `reviewed discovery branches and portable import preserve only canonical Adventure data` imports assisted history with no Model Call Records and rebuilds an equivalent Structured Play projection. |
| Replaced during evaluation | `expanded-model-tasks.test.ts` runs `scripted-contract` and the OpenAI adapter with a local fake transport through the same schemas and produces provider-contract parity. |
| Replaced after durable history | `durable-model-call-records.test.ts` reopens retained Narration with a replacement provider and proves the provider is not called to interpret historical truth. |
| Provider unavailable | `model-assisted-rules-query.test.ts` and `model-assisted-narration.test.ts` retain committed state and return deterministic rules or outcome presentation. |

Providers can change future interpretation or presentation wording only after
application validation. They cannot change already accepted events, exact
rules traces, random results, World Knowledge, or the Structured Play choices
recovered from those events.

## Measured evidence

| Evidence | Result |
| --- | --- |
| Rule extraction | `rule-extraction-v1`: precision 1.00 and recall 1.00 for triggers, prerequisites, procedures, outcomes, tables, and exceptions |
| Retrieval | `actor-scoped-retrieval-v1`: 19 labelled cases; zero forbidden-data leakage; deterministic baseline gaps measured by kind and a filtered semantic fallback approved in ADR-0012 |
| Unambiguous entity linking | 7/8 (87.5%); below the 95% target, explicitly measured and covered by the approved filtered semantic-fallback decision rather than hidden by the release report |
| Classification | `expanded-model-tasks-v1`: 100 examples; per-class precision, recall, and F1 are 1.00 for all six classes; both provider contracts have equal confusion matrices |
| Adversarial classification | 5/5 safe; no candidate command and zero event delta |
| Forbidden-data leakage | Zero across entity, relationship, rule, and event retrieval; character-scoped tests also inspect projection, Evidence Bundle, model boundary, diagnostics, replay, and archive surfaces |

The retrieval quality miss is not an unresolved release blocker: issue #80 was
the specification's measurement-and-policy decision. The approved HITL outcome
keeps deterministic retrieval as the offline path and permits a later semantic
index only inside the existing filter-before-ranking boundary. Its absence
cannot block Structured Play or make canonical history ambiguous.

## PRD #69 user-story evidence

| Story | Status | Evidence |
| --- | --- | --- |
| PRD-69-US-01 | Pass | `layered-memory.test.ts` preserves committed campaign consequences after Confrontation teardown. |
| PRD-69-US-02 | Pass | The same suite removes encounter-only state before the next Scene and after reopen. |
| PRD-69-US-03 | Pass | Conversation records remain short-lived, non-canonical, and absent from later Evidence Bundles and archives. |
| PRD-69-US-04 | Pass | `character-scoped-world-knowledge.test.ts` excludes knowledge from every unintended Player Character scope. |
| PRD-69-US-05 | Pass | Markdown and archive journeys preserve entities, Relationships, events, Visibility, Knowledge Scope, and Provenance. |
| PRD-69-US-06 | Pass | The complete ten-Scene journey finishes through Structured Play with no model configuration. |
| PRD-69-US-07 | Pass | Published-rule execution and Player-facing answers cite the exact package rule and anchored source passage. |
| PRD-69-US-08 | Pass | Actor-scoped retrieval resolves IDs, aliases, names, pronouns, locations, participants, and recent referents. |
| PRD-69-US-09 | Pass | Event retrieval selects bounded recent or causally relevant accepted events, never the complete Timeline by default. |
| PRD-69-US-10 | Pass | World Knowledge filtering precedes relationship ranking, deduplication, budgeting, diagnostics, and model invocation. |
| PRD-69-US-11 | Pass | Rule Match Suggestions preserve distinct matched, no-rule, and needs-adjudication outcomes. |
| PRD-69-US-12 | Pass | Table chat and out-of-character classifications produce no candidate command or gameplay event. |
| PRD-69-US-13 | Pass | Expanded Model Task results expose related calls, Evidence Bundles, evidence-item IDs, and exact rule IDs on demand. |
| PRD-69-US-14 | Pass | Scene Orchestration commits accepted events before requesting final Narration. |
| PRD-69-US-15 | Pass | Provider failure returns the deterministic committed outcome without repeating or losing the turn. |
| PRD-69-US-16 | Pass | Any number of presentation regenerations leaves events and projections byte-equivalent. |
| PRD-69-US-17 | Pass | Authored exits can skip inactive Scenes and are selected only by committed transition conditions. |
| PRD-69-US-18 | Pass | Pending Choice and completed Scene checkpoints reopen without rerolling or regenerating history. |
| PRD-69-US-19 | Pass | Reviewed Adventure Markdown edits translate into commands and change World Knowledge only after commit. |
| PRD-69-US-20 | Pass | Stale, simultaneous, contradictory, malformed, and unauthorized edits return deterministic Review Conflicts without mutation. |
| PRD-69-US-21 | Pass | Rule Review correlates source, extracted fields, normalized content, findings, and generated conformance examples. |
| PRD-69-US-22 | Pass | Every published field has stable passages or a reviewer-attributed Authored Interpretation. |
| PRD-69-US-23 | Pass | Ingestion alone remains non-executable; rejected, superseded, unapproved, and invalid candidates cannot publish. |
| PRD-69-US-24 | Pass | Missing inputs, unresolved cross-references, cycles, and contradictions deterministically block publication. |
| PRD-69-US-25 | Pass | Ambiguity, invalid State Proposals, and rule conflicts create explicit Game Master checkpoints. |
| PRD-69-US-26 | Pass | Game Master edit, rejection, approval, and override flow through actor-authorized commands with audit records. |
| PRD-69-US-27 | Pass | `CONTEXT.md`, ADRs, and layered-memory contracts assign canonical, projection, encounter, conversation, and integration ownership. |
| PRD-69-US-28 | Pass | Semantically unchanged re-ingestion creates no new executable version or semantic package change. |
| PRD-69-US-29 | Pass | Published packages carry version, checksum, license metadata, exact citations, and reproducible execution traces. |
| PRD-69-US-30 | Pass | `actor-scoped-retrieval.ts` is the single scoped boundary for entities, rules, events, Relationships, and bounded fallback policy. |
| PRD-69-US-31 | Pass | The labelled retrieval corpus reports precision@k, recall@k, mean reciprocal rank, and forbidden-data leakage by kind. |
| PRD-69-US-32 | Pass | The 95% target is measured; its 87.5% baseline miss produced an explicit approved semantic-fallback policy in issue #80 and ADR-0012. |
| PRD-69-US-33 | Pass | Every selected Evidence Bundle item has a stable ID, source, Player-visible label, inclusion reason, and applicable citation. |
| PRD-69-US-34 | Pass | Model Gateway records prompt version, budgets, timing, usage, validation, repair, retries, fallback, and correlation outside Timelines. |
| PRD-69-US-35 | Pass | The versioned 100-example corpus reports per-class precision, recall, F1, and confusion matrices for both provider contracts. |
| PRD-69-US-36 | Pass | State Proposals pass authorization, exact shape, existence, ruleset, evidence, and invariant validation before command conversion. |
| PRD-69-US-37 | Pass | Replay and branching reproduce Scene lifecycle states and authored exits from canonical events. |
| PRD-69-US-38 | Pass | This release report maps every story and remaining Phase 5–9 criterion to executable, measured, or approved evidence. |

## Phase 5–9 acceptance-criterion evidence

| Criterion | Status | Evidence |
| --- | --- | --- |
| Phase-5-AC-01 | Pass | `adventure-markdown.test.ts` and the ten-Scene archive journey preserve entities, Relationships, events, Visibility, Knowledge Scope, and Provenance. |
| Phase-5-AC-02 | Pass | Character-scoped and retrieval suites inspect every unauthorized surface and retain zero forbidden fixture leakage. |
| Phase-5-AC-03 | Pass | Valid Markdown edits become reviewed commands; invalid edits become deterministic Review Conflicts without mutation. |
| Phase-5-AC-04 | Pass | `layered-memory.test.ts` preserves campaign consequences while tearing down encounter and conversation state. |
| Phase-5-AC-05 | Pass | World Knowledge Provenance and reviewed command tests retain import, human-edit, rule-outcome, and model-proposal origins. |
| Phase-6-AC-01 | Pass | Candidate ingestion is immutable and non-executable until exact-version approval. |
| Phase-6-AC-02 | Pass | Publication rejects any executable field lacking passages or reviewer-attributed interpretation. |
| Phase-6-AC-03 | Pass | Rule Review exposes source, extraction, normalization, findings, and generated conformance examples together. |
| Phase-6-AC-04 | Pass | `rule-extraction-evaluation.test.ts` measures precision and recall separately for all six required field kinds against `rule-extraction-v1`. |
| Phase-6-AC-05 | Pass | Rule publication and re-ingestion tests block unresolved references, cycles, missing inputs, and contradictions. |
| Phase-6-AC-06 | Pass | Byte-identical and semantically unchanged sources retain the existing published version. |
| Phase-7-AC-01 | Pass | `retrieval-evaluation.test.ts` reports precision@5, recall@5, MRR, and forbidden leakage from a versioned corpus. |
| Phase-7-AC-02 | Approved HITL | The measured 87.5% deterministic entity-link result missed 95%; issue #80 approved the filtered semantic-fallback policy in ADR-0012 while preserving offline Structured Play. |
| Phase-7-AC-03 | Pass | Retrieval contract tests require stable ID, source, Visibility, reason, and applicable citations. |
| Phase-7-AC-04 | Pass | Tight-budget tests prove deterministic ordering and predictable degradation after filtering. |
| Phase-7-AC-05 | Pass | The benchmark and adversarial character fixtures report zero forbidden-data retrieval. |
| Phase-7-AC-06 | Pass | Rule retrieval and publication tests cite the exact approved rule version and source passage. |
| Phase-8-AC-01 | Pass | Model and State Proposal tests prove provider output cannot append directly to the event store. |
| Phase-8-AC-02 | Pass | Every structured task output passes strict closed-shape validation before use and one bounded repair at most. |
| Phase-8-AC-03 | Pass | `expanded-model-tasks-v1` contains 100 examples and reports per-class precision, recall, F1, and confusion matrices. |
| Phase-8-AC-04 | Pass | Five adversarial cases produce no command or event; actor-scoped suites prevent hidden knowledge from entering task input. |
| Phase-8-AC-05 | Pass | Scripted and locally transported OpenAI providers pass the same contract and produce equal evaluation reports. |
| Phase-8-AC-06 | Pass | Gateway tests cover budgets, timeouts, cancellation, retry caps, repair, and deterministic fallback behavior. |
| Phase-9-AC-01 | Pass | The v1 release gate maps all canonical Phase 0 text-interface scenarios to executable scenario tests. |
| Phase-9-AC-02 | Pass | Scene Orchestration regeneration compares canonical events and projections byte-equivalently. |
| Phase-9-AC-03 | Pass | Narration validation rejects uncommitted outcomes, wrong entities, locations, resources, and rules. |
| Phase-9-AC-04 | Pass | Rules queries return evidence-backed explanation or fallback without advancing the Scene. |
| Phase-9-AC-05 | Pass | Expanded discourse tests prove table chat and out-of-character input append no gameplay event. |
| Phase-9-AC-06 | Pass | Expanded results retain on-demand Evidence Bundle and exact rules traces. |
| Phase-9-AC-07 | Pass | Lifecycle replay over every event prefix reproduces the same status and exit. |
| Phase-9-AC-08 | Pass | Branch and transition tests prove only committed authored conditions select a path and inactive Scenes may be skipped. |
| Phase-9-AC-09 | Pass | Narration failure returns the committed deterministic outcome; regeneration cannot change events or projections. |

## Known limitations

- The rule-extraction benchmark is a bounded, hand-labelled Micro-ruleset Check
  fixture. It establishes the Phase 6 evaluation seam but does not claim broad
  document-extraction quality across arbitrary rulebooks.
- Deterministic lexical retrieval misses some non-lexical and confusable
  references. ADR-0012 constrains a future local semantic fallback; canonical
  history, exact rules traces, and Structured Play do not depend on it.
- Provider parity is a contract and schema baseline using deterministic
  fixtures and an injected local OpenAI transport. It is not a hosted-model
  quality or latency claim.
- No optional real-provider smoke evidence was recorded. That cannot weaken or
  overturn the credential-free deterministic release decision.
- Hosted authentication, multiplayer permissions, graphical interfaces,
  voice, VTT synchronization, and production deployment remain outside
  Milestone B.
