# Evaluation Release Report

Issue #87 adds one release decision across the fixed Model Task, retrieval,
rule, proposal, citation, Narration, and golden-campaign datasets. The required
CI command is:

```sh
npm run verify:release
```

That command runs every deterministic dataset test, typechecks the repository,
then runs `npm run evaluate:release`. The final command emits the combined JSON
quality report and exits non-zero when any configured tolerance is exceeded.

## Current deterministic result

**Pass.** `release-measurements-v1` reports seven quality layers with no failing
gate. Its operational sample reports:

| Measurement | Result | Approved tolerance |
| --- | ---: | ---: |
| p50 / p95 latency | generated per run | p95 at most 1,000 ms |
| Model Tasks per turn | 3 | at most 4 |
| Token usage | generated per run | reported, not gated in v1 |
| Cost per turn / session | $0 / $0 for recorded providers | at most $0.01 / $0.05 |
| Retries / repairs / failures | generated per run | at most 2 / 2 / 0 |
| p50 / p95 Evidence Bundle size | 6 / 6 items | p95 at most 12 items |

The report attributes every failure to classification, intent extraction, rule
selection, retrieval, citation, proposal validity, Narration, model execution,
or cost. Forbidden-data leakage, contradiction rate, citation accuracy,
quality, latency, cost, and context size cannot offset failures in another
layer.

## Policy and reproducibility

The reviewed tolerances live in `benchmarks/evaluation-policy-v1.json`, separate
from `benchmarks/release-measurements-v1.json`. The policy records its reviewer,
review date, and rationale. A tolerance change therefore requires a new,
attributably reviewed policy version rather than silently changing a result.
Retrieval tolerances preserve the measured deterministic baseline as a
no-regression floor; the higher aspirational targets in the retrieval report
remain visible and continue to motivate ADR-0012's filtered semantic fallback.

The evaluation-suite manifest records the evaluated models, prompt versions,
providers, retrieval policy, and ruleset. It also pins every fixed dataset by ID
and SHA-256. The aggregate command executes the fixed dataset evaluators and the
golden campaign, derives quality and operational observations from those runs,
then applies the reviewed policy. A dataset change invalidates the command until
the suite is reviewed. Retrieval retains its domain contract: precision@k,
recall@k, mean reciprocal rank, entity-link accuracy, and leakage are reported
by retrieval kind rather than flattened into generic scores.

## Acceptance evidence

| Requirement | Result | Evidence |
| --- | --- | --- |
| Issue-87-AC-01 | Pass | Seven separate quality layers report classification, intent extraction, rule selection, retrieval, proposal validity, contradiction, citation, and forbidden-data leakage measures. |
| Issue-87-AC-02 | Pass | The operational report includes p50/p95 latency, Model Tasks per turn, token usage, cost per turn/session, retries, repairs, failures, and Evidence Bundle size. |
| Issue-87-AC-03 | Pass | The separately versioned policy contains attributable review metadata. |
| Issue-87-AC-04 | Pass | The suite identifies and pins model, prompt, provider, retrieval, ruleset, and fixed-dataset inputs; the CLI runs their evaluators before applying policy. |
| Issue-87-AC-05 | Pass | Direct and CLI tests prove that quality and latency regressions return layer-specific failures and a non-zero exit. |
| Issue-87-AC-06 | Pass | Required CI is deterministic and network-free; paid-provider observations use a separate measurement mode. |

## Paid-provider measurements

Paid-provider measurements are optional and are never presented as the
deterministic CI result. A paid run must use a manifest whose mode is
`paid-provider`; the combined report then exposes those operations separately.
No API key or live provider call is required by `npm run verify:release`.

## Known limitations

- Deterministic and recorded-provider cost is zero; it is not a live invoice.
- Token usage is visible but does not have a release tolerance until the team
  approves a stable usage budget.
- Paid-provider latency and cost vary by provider conditions and must not replace
  deterministic correctness, leakage, or replay gates.
