# Translate Adventure Markdown Edits into Commands

Adventure Markdown is an actor-scoped projection and review surface, not a
second write model. Its structured frontmatter carries the rendered World
Knowledge entries, attributable canonical events, Adventure and Timeline
identity, actor scope, and a deterministic revision; its descriptive prose is
derived presentation. An unchanged reread is idempotent.

An external edit is reviewed against both the exported revision and current
canonical state. The review either produces one validated application command
or a deterministic Review Conflict. Stale, simultaneous, contradictory,
malformed, and unauthorized edits append no events and change no projections.
The initial supported edit is a Game Master-reviewed Reveal of one existing
World Knowledge Established Fact to the Player Character scope.

Only the application may commit the resulting Reveal as a canonical event.
Adapters must never rewrite canonical history or directly mutate World
Knowledge. This preserves ADR-0005's single source of truth, deterministic
replay, durable reopening, Timeline semantics, and archive portability while
still allowing external tools to propose human-reviewable edits.
