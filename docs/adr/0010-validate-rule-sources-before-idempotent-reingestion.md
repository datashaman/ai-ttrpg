# Validate Rule Sources Before Idempotent Re-ingestion

Rule Authoring validates every re-ingested Rule Source before deciding that its
executable meaning is unchanged. Missing deterministic inputs, unresolved
cross-references, cyclic section or passage references, unsupported mechanics,
and contradictory cited passages produce blocking Rule Review findings even
when the normalized executable fields match the last published candidate.

After validation succeeds, semantic comparison ignores source document version
and layout-only changes while preserving rule values, attribution, stable
anchors, and normalized cited passage text. A match reuses the existing
Executable Ruleset Package and creates no Rule Review, Rule Approval, package
version, or checksum. A meaningful difference produces a Rule Candidate Diff
containing the affected fields and their old and new supporting passages.

Rule Version History keeps reviews, decisions, and published packages in order.
Package versions are unique. Rejecting or failing a later candidate never
mutates an earlier package, so its checksum, deterministic execution, trace,
and citations remain reproducible. Diagnostics include only the candidate field
and passages that support the finding rather than attaching unrelated source
material.
