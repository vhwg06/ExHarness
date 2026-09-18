# Oracle current semantics

- Application code owns **what** context is required and the validated shape.
- Oracle owns **where/how** declared source data is read and adapted.
- Backend repository context and QA application-artifact context are explicit and single-pass.
- Missing/failed source reads fail resolution; Oracle does not fabricate required content.
- Resolved context preserves `sourceRef`.
- For consumers that opt into D014, application-artifact identity/provenance is verified by the manifest adapter before ordinary Oracle resolution; digest identity is not semantic correctness.
- QA internal artifact context additionally preserves `APPLICATION_ARTIFACT`, producer work-order and acceptance-decision provenance.
- Oracle is not an agent, Advisor, Worker, correctness authority, semantic-memory system or runtime context lifecycle.
- There is no generic resolver abstraction in current source.
