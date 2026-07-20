# Attributable World Knowledge release report

Date: 2026-07-20

Scope: the attributable World Knowledge vertical slice described by parent PRD
#54 and verified by issue #61.

## Release decision

**Pass.** The required release gate is deterministic, network-free,
credential-free, and contains no paid model calls. The versioned journey covers
Game Master-only Established Fact and relationship knowledge, Natural Language
Play through Structured Play authority, canonical Reveals, attributable evidence, Timeline isolation,
durable reopen, portable round-trip behavior, and a valid Adventure ending.

## Commands and automated results

| Command | Status | Result |
| --- | --- | --- |
| `npm run verify:release` | Required | Pass: 316 tests passed, 1 opt-in test skipped; type checking passed |
| `npm run test:openai-smoke` | Optional | Not run; no real-provider evidence recorded |
| `git diff --check` | Required before publication | Pass |

Required CI runs `npm run verify:release` on Node.js 24. The command expands to
`npm test && npm run typecheck`; the workflow uses no credentials or networked
provider and cannot make a paid model call. The real-provider smoke command is
separate and cannot change the required release decision.

## Locked-manor journey

`test/world-knowledge-release-gate.test.ts` supplies the complete deterministic
journey. It begins with a Game Master-only fact and relationship, enters the
manor through Structured Play, branches immediately before Reveal, selects the
fact Reveal through Natural Language Play, commits the relationship Reveal
through Structured Play, verifies both records as attributable Evidence Bundle
items, branches immediately after Reveal, and reaches a favourable Adventure
ending. Both branches are compared after local durable reopen and after a
portable local-to-in-memory archive round trip.

The Natural Language interpreter selects only an advertised capability. The
same `StructuredPlayApplication.submit` authority validates and commits its
command; neither the interpreter nor generated prose appends canonical events.

## Deterministic leakage audit

The marker fact is `cellar-guardian-identity`; the relationship is
`housekeeper-guards-cellar`. Tests reject both exact identifiers and semantic
text such as the housekeeper being the disguised cellar guardian.

| Observable surface | Passing evidence |
| --- | --- |
| Player state | `world-knowledge.test.ts`: Player application surfaces exclude authored hidden knowledge; release-gate pre-Reveal snapshot |
| Structured Play choices | `world-knowledge.test.ts`: hidden Reveal prerequisites and application surfaces; release-gate choice snapshot |
| Application errors | `world-knowledge.test.ts`: safe failures and hidden-ID collisions do not disclose; release-gate rejected action snapshot |
| Evidence Bundles | `world-knowledge.test.ts`: filtering precedes direct reference and budgeting; rules and Narration evidence exclude hidden history |
| Model Tasks | `model-assisted-action.test.ts`: hidden references rejected; release gate inspects every task Evidence Bundle |
| Natural Language interpretation | `model-assisted-action.test.ts`: provider-authored hidden content cannot become clarification or truth; release-gate adversarial interpretation |
| Rules answers | `model-assisted-rules-query.test.ts`: hidden World Knowledge cannot become an answer or citation |
| Narration | `model-assisted-narration.test.ts`: exact hidden content and relationship paraphrases select deterministic fallback |
| Diagnostics | `model-assisted-action.test.ts`: provider failure details cannot expose hidden World Knowledge; release gate checks diagnostics receive only filtered task evidence |
| Model Call Records | Release gate requires rejected validation, `validatedOutput: null`, filtered evidence references, and no canonical event changes |
| Player-facing export presentation | Release gate checks CLI export output; `world-knowledge-archive.test.ts` separately verifies the portable archive's authorized canonical content |

The adversarial provider proposes a hidden Established Fact and an invented
`gain-health` Mechanical Effect. Structural validation rejects the response and
its repair, records no interpreted command, appends no event, changes no state,
and exposes neither proposal through Player-facing output nor normalized Model
Call Records. Narration and rules suites independently prove generated prose
cannot Reveal knowledge, establish truth, select Likelihood, or apply a
Mechanical Effect.

Explicit raw provider diagnostic capture remains a local, opt-in operator tool.
It receives the same Player-filtered request, may retain provider-authored output
for debugging, and is neither a Player surface, canonical Adventure history,
nor portable archive content.

## Archive and Timeline evidence

- A Timeline branched immediately before Reveal contains only the already
  Player-visible `side-door-open` entry.
- A Timeline branched immediately after both Reveals inherits the fact, its two
  endpoint facts, the relationship, and the earlier visible entry.
- Continuing the after-Reveal Timeline to an ending does not mutate either the
  source or before-Reveal Timeline.
- Local reopen restores byte-equivalent Player and Game Master projections for
  every Timeline.
- Portable export/import restores those same byte-equivalent projections and
  excludes Model Call Records and raw provider payloads.
- Format-v1 archives from before World Knowledge remain readable without
  inferred metadata. Ambiguous visibility, provenance, relationship, or Reveal
  data is rejected before publication, per ADR-0006.

## Parent PRD user-story evidence

| Story | Status | Evidence |
| ---: | --- | --- |
| 1 | Pass | Actor-scoped projections distinguish canonical truth from Player Character Knowledge Scope. |
| 2 | Pass | Player-visible Established Fact Evidence Bundle items retain stable World Knowledge source references and inclusion reasons. |
| 3 | Pass | The journey reveals `housekeeper-guards-cellar` with its authored provenance. |
| 4 | Pass | Player projection and complete leakage audit exclude the hidden marker before Reveal. |
| 5 | Pass | Interpretation Model Tasks and results contain only Player-filtered knowledge. |
| 6 | Pass | Hidden rules citations are rejected in `model-assisted-rules-query.test.ts`. |
| 7 | Pass | Hidden fact text and relationship paraphrases are rejected in `model-assisted-narration.test.ts`. |
| 8 | Pass | The mixed-mode Reveal becomes visible only after the canonical `WorldKnowledgeRevealed` event commits. |
| 9 | Pass | The release journey and World Knowledge contract both reopen revealed state byte-equivalently. |
| 10 | Pass | The immediately-before-Reveal Timeline remains unaware after other Timelines continue. |
| 11 | Pass | The immediately-after-Reveal Timeline inherits all revealed entries. |
| 12 | Pass | Portable round trip preserves byte-equivalent Player visibility. |
| 13 | Pass | Structured Play performs setup, entry, relationship Reveal, branching, continuation, and ending without a model. |
| 14 | Pass | Unavailable and unmatched Reveal references fail explicitly without substitution. |
| 15 | Pass | Failed Reveal and adversarial model attempts append no event. |
| 16 | Pass | Game Master projection retains the authored private fact, endpoints, and relationship. |
| 17 | Pass | World Knowledge validation requires closed provenance kinds and stable source references. |
| 18 | Pass | Visibility and Knowledge Scope are explicit and cross-field validated. |
| 19 | Pass | Reveal history records the revealing event while preserving original provenance. |
| 20 | Pass | Duplicate and contradictory IDs are rejected deterministically. |
| 21 | Pass | Relationship Reveal canonically reveals its endpoints and maintains equal visibility. |
| 22 | Pass | `src/world-knowledge.ts` owns validation, projection, and actor-scoped querying. |
| 23 | Pass | Replay derives World Knowledge exclusively from canonical Adventure events. |
| 24 | Pass | Contract tests prove projections and Evidence Bundles are deeply immutable. |
| 25 | Pass | Journey, event, evidence, Timeline, and archive assertions use stable fact and relationship IDs. |
| 26 | Pass | Provenance origin kinds and source references are structurally validated. |
| 27 | Pass | Direct-reference and tight-budget tests prove visibility filtering occurs first. |
| 28 | Pass | Evidence items retain World Knowledge source references and explicit inclusion reasons. |
| 29 | Pass | Missing or unknown actor scope is rejected; no privileged default exists. |
| 30 | Pass | Rules and Narration evidence use the same Player-filtered World Knowledge projection. |
| 31 | Pass | Archive adapter tests preserve canonical knowledge while excluding operational model data. |
| 32 | Pass | Pre-World Knowledge format-v1 archives remain readable without inferred entries. |
| 33 | Pass | Malformed imported security metadata is rejected before the Adventure namespace changes. |
| 34 | Pass | Replay, reopen, and round trip compare byte-equivalent projections. |
| 35 | Pass | Release journey and archive suite branch immediately before and after Reveal. |
| 36 | Pass | The leakage table covers state, choices, errors, evidence, tasks, prose, diagnostics, records, and export presentation. |
| 37 | Pass | Player and Game Master fixtures use local deterministic providers and repositories without credentials. |
| 38 | Pass | This report records every inspected surface and the raw-diagnostic limitation. |
| 39 | Pass | `CONTEXT.md` defines World Knowledge Entry, Relationship, Provenance, Visibility, Knowledge Scope, and Reveal. |
| 40 | Pass | ADR-0005 records canonical ownership and filter-before-retrieval; ADR-0006 records fail-closed archive compatibility. |

## Known limitations

- The slice has Player and Game Master actor scopes, not authentication,
  multiplayer permissions, or character-specific visibility.
- Retrieval is deterministic and direct; semantic ranking, embeddings, document
  ingestion, and campaign-scale memory remain out of scope.
- Raw provider diagnostics are local and opt-in. They can contain content
  invented by a provider and must not be treated as a Player-facing view or
  canonical record.
- No real-provider smoke evidence was recorded for this release. That does not
  weaken the required deterministic release decision.
