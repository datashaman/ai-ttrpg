# Actor-scoped retrieval evaluation

Date: 2026-07-20

Scope: Phase 7 campaign-scale Retrieval Boundary from issue #79, evaluated for
issue #80 against `benchmarks/actor-scoped-retrieval-v1.json`.

## Decision

**Accept a filtered semantic fallback for implementation.** Deterministic
retrieval remains the first path and leaks no forbidden data, but it misses
approved quality thresholds on meaning-preserving non-lexical queries and
confusable Relationship candidates. These measured gaps—not a preference for
semantic search—justify the bounded policy in ADR-0012.

The evaluation itself does not add an index or enable semantic retrieval.
Implementation remains inside the single Retrieval Boundary and cannot change
canonical authority, ADR-0005, or deterministic offline play.

## Approved thresholds and deterministic baseline

Precision@5 is the share of returned top-five items that are labelled relevant.
Recall@5 is the share of labelled relevant items present in those results. Mean
reciprocal rank measures the position of the first relevant result. Leakage is
the count of explicitly labelled forbidden stable IDs returned anywhere in a
case.

| Retrieval kind | Cases | Precision@5 | Recall@5 | MRR | Forbidden leakage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Entity | 10 | 100% | 92.9% | 0.90 | 0 |
| Relationship | 4 | 28.6% | 50.0% | 0.54 | 0 |
| Rule | 3 | 100% | 66.7% | 0.67 | 0 |
| Event | 2 | 80.0% | 100% | 1.00 | 0 |

| Cross-kind measure | Approved threshold | Result |
| --- | ---: | ---: |
| Precision@5 per kind | at least 90% | Relationship and event miss |
| Recall@5 per kind | at least 90% | Relationship and rule miss |
| Mean reciprocal rank per kind | at least 0.90 | Relationship and rule miss |
| Unambiguous entity-link accuracy | at least 95% | 7/8 (87.5%); miss |
| Forbidden-data leakage | exactly 0 | 0; pass |

The security threshold is absolute: forbidden-data leakage cannot be offset by
better ranking metrics. An unambiguous mention has one required labelled entity
target, so contextual expansions cannot conceal a linking miss.

## Corpus and measured gaps

The versioned, network-free corpus contains 19 labelled cases over 46 campaign
entities, 13 visible and one forbidden typed World Knowledge Relationship, ten
approved rule-package versions, 30 unrelated accepted-event distractors, and a
fixed accepted-event causal chain. It covers explicit and ambiguous references,
rules, Relationships, causal events, one-item budget pressure, forbidden
knowledge, non-lexical paraphrases, and confusable numbered candidates.

The baseline found three material gap shapes:

- “whoever maintains the estate” did not resolve the labelled groundskeeper;
- non-lexical Relationship and Check-rule paraphrases returned no relevant item;
- shared “opens display case” terminology ranked case 07 seventh among twelve
  confusable Relationships.

Sentence-final punctuation also initially prevented an exact alias match. That
deterministic defect was corrected in the Retrieval Boundary and now passes.
Recent-event fallback found the labelled paraphrased event chain but added one
irrelevant recent event, producing 80% event precision.

The evaluator in `src/retrieval-evaluation.ts` computes every measurement from
labelled expected, retrieved, and forbidden stable IDs. The suite asserts the
exact deterministic baseline failures so an unexplained metric change is
visible during review.

## Accepted semantic-fallback policy

Semantic fallback is accepted for a later implementation only under all of the
following constraints:

- **Filtering:** Before semantic scoring, restrict candidates by campaign,
  source, Visibility, actor and Player Character scope, and exact ruleset/index
  version. Forbidden candidates never enter ranking or budgeting.
- **Attribution:** Each selected item retains its canonical stable source,
  Player-visible label, exact citation where applicable, and a reason explicitly
  identifying semantic fallback.
- **Determinism:** Pin the embedding model and configuration, fixed top-k, and
  stable-ID tie-breaking. Equal inputs and index versions produce equal order.
- **Versioning:** Use a checksummed index manifest tied to source and ruleset
  versions. Never silently substitute a different or stale index.
- **Degradation:** An unavailable, stale, unversioned, or corrupt index returns
  to deterministic retrieval and Structured Play. It never broadens scope.
- **Offline behavior:** A matching local index may provide the fallback; without
  it, canonical history, deterministic retrieval, rules, and play remain usable.

Semantic similarity selects evidence only. It cannot establish an Established
Fact, change an accepted event or projection, authorize a command, or become a
second source of truth.

## Verification

`npm run verify:release` is the required command. It runs this versioned corpus
without network access or credentials alongside the complete suite and
TypeScript checking.
