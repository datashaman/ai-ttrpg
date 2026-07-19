# Durable Adventure Release Report

Date: 2026-07-19

Scope: durable Solo Play Adventure milestone from issue #24, verified by issue
#31.

## Release decision

**Pass.** The automated gate confirms deterministic recovery, portable archive
round-tripping, corruption rejection, and failure-safe writes through the
public Adventure repository and Structured Play boundaries. No language model
is required to create, resume, or complete a durable Adventure.

The repository test command is the release gate:

```sh
npm test
```

Typechecking is the accompanying static verification:

```sh
npm run typecheck
```

## Automated gate evidence

| Required durability evidence | Automated scenario |
| --- | --- |
| Shared in-memory and local durable repository contract | `in-memory repository satisfies create, list, open, append, replay, and close` and the corresponding `local durable` scenario are generated from one adapter contract suite in `test/adventure-repository.test.ts`; `every repository adapter pair round-trips the complete portable Adventure` adds all four archive source/destination combinations |
| Player Character configuration, Adventure start, and Free Action restarts | `Structured Play completes a durable Adventure across process-facing restarts without a model` |
| Check Proposal, revealed Pending Choice, and Check resolution restarts | matching subtests under `every canonical durability checkpoint reopens byte-equivalently` |
| Oracle recommendation and Oracle answer restarts | matching subtests under `every canonical durability checkpoint reopens byte-equivalently` |
| Inventory Item use, Scene transition, Confrontation exchange, and Adventure ending restarts | matching subtests under `every canonical durability checkpoint reopens byte-equivalently` |
| Timeline branch and Timeline selection restarts | matching subtests under `every canonical durability checkpoint reopens byte-equivalently` |
| Complete normalized recovery | every checkpoint compares accepted events, Player-visible projection, complete Timeline view, active selection, and random-stream position before and after a new repository instance opens the Adventure |
| Canonical v1 history recovery | `every canonical v1 fixture survives durable close and reopen` persists and reopens the same shared fixture histories used by the prior v1 replay gate |
| Large deterministic replay | `a 10,000-event durable fixture replays repeatedly without projection divergence` |
| Portable export and import | `every repository adapter pair round-trips the complete portable Adventure` covers in-memory→in-memory, in-memory→local durable, local durable→in-memory, and local durable→local durable portability |
| Corruption and incompatibility rejection | `import reports document compatibility and integrity failures without mutation`, `import distinguishes every invalid canonical event rejection class`, and `import diagnoses inconsistent Timeline graphs and random positions` |
| Stale write conflict and idempotent retry | both repository adapters run `repository rejects stale writes and safely identifies retries` |
| Atomic multi-event failure | both adapters run `repository accepts a complete batch or none of it`; the local failure scenarios also reopen to the last valid projection |

The checkpoint gate normalizes the complete Adventure at the public repository
boundary. Equality therefore covers every Timeline history rather than only the
active event stream. Reopening also reconstructs the Player-visible projection
without consuming random input or invoking interpretation or narration.

The canonical v1 replay and durable recovery gates share one fixture builder.
Free Action, Check, Pending Choice, Resolve spend, Inventory Item, Oracle, Scene
transition, Confrontation, invalid-command, and rules-query histories therefore
cannot drift into parallel definitions between the two release gates.

The 10,000-event fixture is accepted through the durable Event Store, closed,
opened through three new repository instances, and projected repeatedly. Every
replay retains exactly 10,000 accepted events and produces the same normalized
Player-visible projection.

## Deferred criteria

None. Hosted storage, cloud synchronization, multiplayer concurrency, and
automatic archive repair remain outside issue #24 by design rather than being
deferred release criteria.

## Parent PRD readiness

Issue #24 is ready to close. Its repository abstraction, durable recovery,
Pending Choice restoration, Timeline and random-stream preservation, safe
writes, portable archives, corruption diagnostics, large replay fixture, and
Structured Play restart path are all covered by the automated gate with no
remaining in-scope criteria.
