# Golden Campaign Evaluation

Issue #86 introduces the first Phase 10 golden campaign and adapter-matrix
evaluation. The input, matrix, fixed random seed, approved ruleset version, and
normalized expected outputs live in
[`benchmarks/golden-campaign-v1.json`](../benchmarks/golden-campaign-v1.json).

Run the credential-free evaluation with:

```sh
npm run --silent evaluate:golden
```

The command writes one JSON report to standard output and exits unsuccessfully
when any run fails. Results contain no wall-clock time or generated identity,
so reports can be compared directly across revisions.

## Current matrix

| Boundary | Supported adapters in the golden matrix |
| --- | --- |
| Adventure Repository | `in-memory`, `local-durable` |
| Model provider | `scripted`, `openai-recorded` |
| Executable Ruleset Package | `micro-ruleset@1.0.0` |
| Presentation | `deterministic`, `grounded` |

The recorded OpenAI adapter exercises the production stateless Responses API
mapping through a local fixed response; the command never requires credentials
or a paid call. Both provider variants receive the same actor-scoped Evidence
Bundle from the Retrieval Boundary, then traverse Discourse Classification,
intent extraction, cited State Proposal validation, application invariants, and
ordinary command submission. Their three Model Call Records remain operational
data outside the Timeline and portable archive and survive repository reopen.
The deterministic and grounded presentation variants both pass through the
production committed-outcome presentation contract.

All eight combinations execute the same confirmed campaign steps. Generated
event and decision identities are normalized before commands, event payloads,
projections, evidence, rules traces, and visible claims are compared with the
golden outputs.

## Layer ownership

The configured adapters must exactly match the matrix embedded in the fixture;
an omitted or substituted adapter produces an adapter-layer diagnostic without
running a partial matrix. Each run reports diagnostics at the narrowest responsible layer: fixture
schema, model translation, command acceptance, rule trace and random bounds,
canonical events, projection and replay, actor-scoped retrieval, presentation,
or repository serialization. A presentation mismatch therefore does not imply
that canonical state diverged, and repository parity can be inspected without
conflating it with provider output.

The run also checks resource bounds, declared random bounds, actor-visible
evidence, portable archive round trips, close/reopen replay, and byte-stable
normalized truth. The fixture is deeply immutable after parsing, and provider
or presentation replacement has no authority to append canonical events
outside the application command boundary.
