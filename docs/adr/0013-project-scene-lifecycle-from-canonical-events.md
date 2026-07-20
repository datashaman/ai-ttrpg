# Project Scene Lifecycle from Canonical Events

Scene Orchestration exposes proposed, active, resolving, paused, and ended
states, but does not persist a second mutable workflow state. The lifecycle is
projected from the same canonical Adventure events that restore Structured
Play: Scene entry makes a Scene active, a Check Proposal makes it resolving, a
required Player choice pauses it, and only a committed Scene
transition or Adventure ending ends it.

The orchestration boundary accepts actor-scoped commands and attributable
classified input. Game Master approval, edit, rejection, and override are
validated decisions recorded with the candidate command, submitted command,
outcome, and correlated accepted-event IDs; they never mutate a projection.
Idempotency keys make retries return the original decision or fail explicitly
when reused for different input.

Final Narration starts only after an outcome event commits. Its immutable
presentation snapshot contains the evidence and exact rule trace, committed
events, and projected resources. Unknown entities, locations, resources,
rules, or event claims select the deterministic committed summary. Regeneration
reuses that snapshot and cannot submit a command, append an event, reroll, or
change a projection.

This preserves ADR-0001 through ADR-0005 and ADR-0011: Timelines remain the
replay authority, model operations remain outside Adventure history, and
Evidence Bundles can attribute a proposal without authorizing it.
