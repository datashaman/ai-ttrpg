# Centralize Actor-Scoped Retrieval

Campaign-scale entity linking, World Knowledge traversal, approved-rule
selection, event selection, deduplication, ranking, and Evidence Bundle
budgeting enter through one Retrieval Boundary. Every request identifies the Player actor, Player
Character, campaign, Model Task, and ruleset version, and the requested
campaign must match the supplied corpus.

Canonical World Knowledge projection and accepted-event filtering apply
Visibility and Knowledge Scope before any item becomes a retrieval candidate.
The boundary then uses deterministic explicit-reference, alias, active/recent
referent, typed-relationship, approved-rule, and causal/recency selection.
Only after forbidden candidates have been excluded may stable-ID
deduplication, ranked degradation, and the item budget run. Every returned
item carries its stable source, Player-visible Visibility, retrieval reason,
and exact rule passage or canonical source citation when applicable.

This keeps ADR-0005's security ordering inside one deep module and makes
retrieval reproducible without adding a second source of game truth. Semantic
fallback is deliberately absent here; the issue #80 evaluation measured lexical
threshold gaps and ADR-0012 defines the constraints for adding one. The existing
task-specific locked-manor assemblers remain compatibility paths until the
expanded Model Task migration in issue #81; they share deterministic selection
primitives but must not become a second campaign-scale retrieval boundary.
