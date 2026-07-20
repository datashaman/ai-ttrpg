# Use Stateless Model Tasks

Every interpretation, rules-explanation, and narration request is a stateless Model Task whose permitted context is explicit task input plus an Evidence Bundle. We do not use provider conversation identifiers or hidden conversational memory: this repeats some context on each call, but preserves attributable behavior, provider portability, and reproducible inputs while making accepted events and projected game state the sole source of continuity.

Expanded interpretation is decomposed into narrow Discourse Classification,
intent extraction, Rule Match Suggestion, and State Proposal tasks. A Player
action reaches command conversion only after each referenced intent, entity,
capability, rule, and evidence item is found in the supplied actor-scoped
Evidence Bundle and the State Proposal passes authorization, exact-shape,
ruleset-version, and invariant validation. The proposal must cite the exact
validated-intent item plus typed authority-rule and projected-state evidence,
and it cannot substitute a different capability or entity after intent
validation. Rules ambiguity remains an explicit
`needs-adjudication` outcome, and absence remains `no-rule`; neither is silently
converted into a convenient match. Every task retains its own prompt version
and Model Call Record outside the Timeline. Expanded tasks accept only an
actor-scoped Evidence Bundle returned through ADR-0011's Retrieval Boundary,
and their result exposes Model Call, Evidence Bundle, evidence-item, and rule
IDs for on-demand traces without moving operational records into the Timeline.
