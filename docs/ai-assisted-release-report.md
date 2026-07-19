# AI-assisted locked-manor release report

Date: 2026-07-19

Scope: the AI-assisted locked-manor vertical slice described by parent PRD #39
and verified by issue #46.

## Release decision

**Pass.** The required release command is deterministic, network-free,
credential-free, and contains no paid model calls. It runs the complete test
suite and type checking. The versioned benchmark meets every configured quality,
authority-safety, citation, event-safety, and latency threshold.

## Commands and results

| Command | Status | Candidate result |
| --- | --- | --- |
| `npm run verify:release` | Required | Pass: 260 tests passed, 1 opt-in test skipped; type checking passed |
| `npm run test:openai-smoke` | Optional | Not run for this release report; no real-provider evidence recorded |
| `git diff --check` | Required before publication | Pass |

Required CI runs `npm run verify:release` on Node.js 24. The command expands to
`npm test && npm run typecheck`. The OpenAI smoke test is a separate command and
is neither invoked nor supplied credentials by required CI.

## Benchmark measurements

Fixture: `benchmarks/locked-manor-utterances-v1.json` (`schemaVersion: 1`).

| Measure | Threshold | Result |
| --- | ---: | ---: |
| Correct interpretation | 100% | 6/6 (100%) |
| Correct ambiguity handling | 100% | 1/1 (100%) |
| Unsupported-claim rejection | 100% | 4/4 (100%) |
| Citation validity handling | 100% | 2/2 (100%) |
| Event safety | 100% | 12/12 (100%) |
| Deterministic Model Task latency | at most 1,000 ms per call | Pass; every recorded call was within the bound |

The final local benchmark test completed in 112 ms. That observation covers the
deterministic scripted provider and application boundary only; it is not a claim
about internet or real-provider latency.

The benchmark covers authored actions, in-character speech, rules queries,
out-of-character requests, table chat, system commands, ambiguity, unknown
entities, unavailable capabilities, unsupported facts, and invented mechanics.
It includes both accepted and rejected citations. A versioned mixed-mode journey
starts in Natural Language Play, establishes the arrival evidence, switches to
Structured Play, reaches the authored unresolved ending, and then reopens with
byte-equivalent events, projected state, and Model Call Records.

## Issue #46 acceptance assessment

| Criterion | Status | Evidence |
| --- | --- | --- |
| Issue-46-AC-01 — versioned representative and adversarial benchmark | Pass | The v1 JSON fixture and its coverage contract enumerate all required categories. |
| Issue-46-AC-02 — explicit quality, safety, citation, and latency thresholds | Pass | Thresholds live in the fixture and are enforced by `ai-release-gate.test.ts`. |
| Issue-46-AC-03 — deterministic provider, attribution, validation, citation, failure, reopen, and no-event coverage | Pass | `npm test` runs the shared provider contract, model-assisted action/rules/Narration suites, durable restoration suites, and the release gate. |
| Issue-46-AC-04 — complete mixed-mode locked-manor Adventure | Pass | The versioned journey completes through Natural Language and Structured Play and verifies its authored ending. |
| Issue-46-AC-05 — generated prose cannot establish truth or apply Mechanical Effects | Pass | Adversarial benchmark cases and the grounded rules/Narration suites reject unsupported facts, mechanics, and citations without events. |
| Issue-46-AC-06 — required CI is network-free, credential-free, deterministic, and unpaid | Pass | CI invokes only `verify:release`; all provider traffic in required tests is scripted or uses injected local `fetch` doubles. |
| Issue-46-AC-07 — OpenAI smoke evidence is optional | Pass | `test:openai-smoke` remains separate and was not run for this report. |
| Issue-46-AC-08 — report records commands, results, measurements, latency, smoke status, and limitations | Pass | This report records each field explicitly. |
| Issue-46-AC-09 — every parent PRD criterion is assessed | Pass | PRD-39-US-01 through PRD-39-US-34 are assessed below. |
| Issue-46-AC-10 — type checking and complete suite pass | Pass | `npm run verify:release` passed. |

## Parent PRD #39 assessment

Issue #39 has no section literally named “Acceptance criteria.” Its 34 numbered
User Stories are therefore treated as the parent acceptance criteria here.

| Criterion | Status | Evidence |
| --- | --- | --- |
| PRD-39-US-01 — explicitly select Natural Language Play | Pass | CLI `--mode natural-language` and mode selection are covered. |
| PRD-39-US-02 — Structured Play remains default | Pass | Default CLI journeys require no model runtime. |
| PRD-39-US-03 — switch modes without state change | Pass | The mixed-mode journey asserts no mode event and stable state. |
| PRD-39-US-04 — declare an action in ordinary language | Pass | The authored-action benchmark case uses an ordinary Player utterance. |
| PRD-39-US-05 — unambiguous utterance selects an authored capability | Pass | `survey-manor` is accepted through Structured Play authority. |
| PRD-39-US-06 — ambiguity requests clarification | Pass | The ambiguous-door case names two current capabilities and appends no event. |
| PRD-39-US-07 — failed interpretation appends no event | Pass | Every adversarial case has an expected event delta of zero. |
| PRD-39-US-08 — failure presents Structured Play choices | Pass | Safe-rejection cases require the choices transcript. |
| PRD-39-US-09 — Player may revise or withdraw failed input | Pass | The CLI returns control to explicit mode selection after rejection or clarification. |
| PRD-39-US-10 — rules answers use situation-specific evidence | Pass | The Lockpick Set query uses its exact authored rule, entity, and capability. |
| PRD-39-US-11 — rules explanations cite evidence | Pass | Valid and invalid citation cases are measured. |
| PRD-39-US-12 — accepted outcomes receive original Narration | Pass | The model-assisted Narration suite covers committed Check and Oracle outcomes. |
| PRD-39-US-13 — Narration is grounded in visible evidence | Pass | Every accepted segment must cite applicable Evidence Bundle items. |
| PRD-39-US-14 — invalid or unavailable Narration falls back | Pass | Unsupported claims, invalid citations, timeouts, and provider errors use deterministic presentation. |
| PRD-39-US-15 — reopened Adventures retain historical Narration | Pass | Durable Narration restoration tests verify retained text without regeneration. |
| PRD-39-US-16 — missing provider configuration is explained | Pass | CLI coverage verifies the explanation and immediate Structured Play choices. |
| PRD-39-US-17 — timeouts and rate limits fail quickly | Pass | Gateway and CLI deadline tests verify bounded, non-retried outcomes. |
| PRD-39-US-18 — only accepted facts and outcomes define truth | Pass | Rejected facts/mechanics leave event history and projection unchanged. |
| PRD-39-US-19 — no hidden provider conversation memory | Pass | Provider contracts require stateless Model Tasks and prohibit `previous_response_id`. |
| PRD-39-US-20 — credentials stay out of evidence and records | Pass | Redaction, archive, diagnostic, and runtime-configuration tests cover the boundary. |
| PRD-39-US-21 — one application-owned provider contract | Pass | Scripted and OpenAI adapters satisfy the same `ModelProvider` contract. |
| PRD-39-US-22 — deterministic provider behavior in CI | Pass | Required tests use the scripted provider and injected OpenAI transport doubles. |
| PRD-39-US-23 — stable attributable Evidence Bundle items | Pass | Evidence tests verify stable IDs, source kinds, references, and inclusion reasons. |
| PRD-39-US-24 — deterministic active-situation evidence | Pass | Repeated assembly produces equal ordered bundles. |
| PRD-39-US-25 — evidence budget preserves direct authority | Pass | Budget tests retain exact rules, capabilities, entities, and current resolution before old events. |
| PRD-39-US-26 — Model Tasks correlate with commands and events | Pass | Model Call Record tests verify command, event ID, and correlation ID links. |
| PRD-39-US-27 — validated output and failure metadata are retained | Pass | Durable Model Call Record tests cover success, validation, retry, usage, and fallback fields. |
| PRD-39-US-28 — raw payload capture is explicit | Pass | Diagnostics are opt-in, redacted, local, and excluded from archives. |
| PRD-39-US-29 — malformed output repairs at most once | Pass | Gateway tests verify exactly one repair and accumulated usage. |
| PRD-39-US-30 — ambiguity and provider failures do not retry | Pass | Ambiguity, timeout, authentication, rate-limit, and budget cases verify one invocation. |
| PRD-39-US-31 — versioned locked-manor utterance benchmark | Pass | `locked-manor-utterances-v1.json` is release-gated. |
| PRD-39-US-32 — real-provider smoke tests are opt-in | Pass | The smoke test skips under normal `npm test`. |
| PRD-39-US-33 — release evidence reports quality, latency, and limitations | Pass | This document is the versioned evidence. |
| PRD-39-US-34 — portable archives exclude model operational data | Pass | Archive and durable record tests prove Model Call Records and raw payloads do not enter exports. |

The implementation decisions are also represented in the required suite: deep
Evidence Bundle assembly and budgeting; provider-neutral stateless Model Tasks;
one-repair gateway deadlines; operational Model Call Records outside Timelines;
application-owned command validation; grounded rules and Narration; explicit CLI
mode selection; stable reopen behavior; and provider-independent archives. No
out-of-scope world store, semantic retrieval, second paid provider, autonomous
tool loop, hidden information, or campaign memory was introduced.

## Known limitations

- The deterministic benchmark measures application interpretation safety and
  authority enforcement against labelled scripted provider outputs. It does not
  measure the semantic accuracy of a changing real OpenAI model.
- No opt-in OpenAI smoke result is recorded for this candidate. Running it needs
  credentials, network access, time, and paid model calls, so it cannot change
  the required CI result.
- The measured mixed-mode journey takes the authored unresolved withdrawal route.
  Other favourable and adverse routes, Checks, Oracle answers, Confrontations,
  Pending Choices, and branches remain covered by the complete deterministic
  suite rather than duplicated in this benchmark journey.
- The 1,000 ms latency threshold applies to deterministic in-process Model Tasks.
  Real-provider latency is deployment evidence and must be observed separately.
