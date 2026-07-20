# Publish Rules Only Through Version-matched Approval

Rule Authoring uses one explicit authority transition. Ingestion produces a
non-executable Rule Candidate. A Rule Review then correlates one exact candidate
version with its source, extracted fields, normalized rule, validation findings,
and generated conformance examples. A reviewer records an approved, rejected,
or superseded decision against that same version.

Publication accepts only a valid Rule Review and an explicit approval whose
candidate version matches the candidate being packaged. The resulting
Executable Ruleset Package contains a stable rule identity, package version,
manifest, checksum, licensing metadata, approval record, and field-level source
citations or reviewer-attributed Authored Interpretations. The deterministic
runtime validates the complete package before using its rule reference.

Gameplay events remain the authority for play. A published package may govern a
Check, but publication does not itself append gameplay history. Resolution
traces retain the exact package checksum, rule version, and source passages so a
Player-facing rules answer can cite the same authority that governed the
committed outcome. Rejected, superseded, unapproved, invalid, mismatched, and
tampered inputs fail before execution and append no event.
