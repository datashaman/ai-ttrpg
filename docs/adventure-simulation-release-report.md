# Durable Adventure Simulation Report

Issue #88 adds a deterministic, credential-free, network-free simulation of one
durable Adventure across 100 accepted Player turns.

Run the machine-readable gate with:

```sh
npm run evaluate:simulation
```

The fixed fixture cycles through Structured Play, fuzzed Natural Language Play,
rules queries, table chat, Pending Choices, Game Master checkpoint branches,
timeouts, malformed model output, provider failure, cancellation, stale writes,
and repository restarts. Failures recover through Structured Play, Timeline
branching, or a fresh durable repository handle.

The passing baseline records:

| Measurement | Result |
| --- | ---: |
| Accepted turns | 100 / 100 |
| Random values | 140 |
| Command observations | 100 |
| Event observations | 280 |
| Projection observations | 100 |
| Model Task outcomes | 70 |
| Recovery actions | 80 |
| Timelines | 80 |
| Replay divergence | 0 |
| Duplicate events within a Timeline | 0 |
| Unauthorized table-chat leakage | 0 |

Generated IDs and timestamps are normalized before projection digests are
recorded. The CLI report includes commands, canonical event types and sequences,
projection digests, the random stream, Model Task outcomes, and recovery actions.
An injected failure identifies its responsible layer and first reproducible turn.

`npm run verify:release` runs the complete test suite and typecheck, then the
layered evaluation gate includes this simulation in its single release report.
