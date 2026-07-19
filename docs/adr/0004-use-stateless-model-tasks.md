# Use Stateless Model Tasks

Every interpretation, rules-explanation, and narration request is a stateless Model Task whose permitted context is explicit task input plus an Evidence Bundle. We do not use provider conversation identifiers or hidden conversational memory: this repeats some context on each call, but preserves attributable behavior, provider portability, and reproducible inputs while making accepted events and projected game state the sole source of continuity.
