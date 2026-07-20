# Adopt a Filtered Semantic Retrieval Fallback for Measured Lexical Gaps

The v1 actor-scoped retrieval corpus measures exact, ambiguous, non-lexical,
and confusable entity, relationship, rule, and event retrieval. Deterministic
retrieval retains zero forbidden-data leakage, but it resolves only seven of
eight unambiguous entity mentions and misses approved relationship and rule
quality thresholds. Confusable relationship terminology also ranks the labelled
item seventh. These measured gaps justify a semantic fallback; volume or
preference alone does not.

The accepted fallback is a future addition to the single Retrieval Boundary,
not a second authority or a replacement for deterministic linking. Before any
semantic scoring, candidates must be filtered by campaign, source, Visibility,
actor and Player Character scope, and exact ruleset or index version. Returned
items retain their canonical stable source, exact citations where applicable,
Player-visible label, and an inclusion reason that identifies semantic fallback.

Reproducibility requires a checksummed index manifest, fixed embedding model and
configuration, stable top-k, and stable-ID tie-breaking. An unavailable,
unversioned, stale, or corrupt index degrades to deterministic retrieval and
Structured Play; it must never broaden filters, silently use another version,
or block offline play. Offline operation may use a matching local index, but its
absence leaves canonical history and deterministic mechanics fully usable.

This preserves ADR-0005. Semantic similarity may select attributable evidence;
it cannot establish game truth, change canonical events or projections, weaken
Visibility, or authorize a state change.
