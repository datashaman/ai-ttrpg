# Keep Ingested Rule Candidates Non-executable

Rule Authoring treats source ingestion and runtime rule authority as separate
boundaries. The supported Rule Source format preserves document identity,
version, stable section and passage anchors, exact passage text, segmentation,
and required layout metadata. An extracted draft passes through an
application-owned schema before it becomes an immutable Rule Candidate.

Every normalized candidate field resolves to one or more exact source passages
or an Authored Interpretation carrying reviewer identity. The candidate has a
deterministic content revision but is explicitly non-executable. Ingestion
exposes no approval, registration, publication, or execution operation.

This separation requires an additional review and publication step before a
rule can govern play, but prevents document parsing or model-assisted
extraction from silently changing mechanical authority. Approval and
versioned executable packaging therefore remain later application operations.
