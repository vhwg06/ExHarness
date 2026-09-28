# Oracle current semantics

- Application code owns **what** context is required and the validated shape.
- Oracle owns **where/how** declared source data is read and adapted.
- Backend repository context and QA application-artifact context are explicit and single-pass.
- Missing/failed source reads fail resolution; Oracle does not fabricate required content.
- Resolved context preserves `sourceRef`.
- For consumers that opt into manifest validation, application-artifact identity/provenance is verified before ordinary Oracle resolution; digest identity is not semantic correctness.
- QA internal artifact context additionally preserves `APPLICATION_ARTIFACT`, producer work-order and acceptance-decision provenance.
- Oracle is not an agent, Advisor, Worker, correctness authority, semantic-memory system or runtime context lifecycle.
- The ContextRequirement/ContextResolution contract is provider-neutral; it does not select a provider or grant product authority. Core consumes it through an injected resolver hook.

`@exharness/oracle` owns the two concrete source read loops. The Agentic Application adapter still owns WorkOrder parsing and context schema validation. These providers are compatibility building blocks. The new schema binds requirement, item, materialization and resolution identity; REQUIRED CURRENT evidence needs an exact snapshot and strong validator. Provider selection is deterministic through an explicit SourceCatalog and bounded RetrievalPlanner; durable storage and invalidation remain future work.

A required unresolved evidence need is UNSATISFIED and cannot be consumed. Optional unresolved evidence is explicitly PARTIAL. Budgets and immutable step parent/index constrain progression; the runtime resolves only once per call and does not automatically advance steps.

Provider diagnostics do not establish semantic source identity. For CURRENT evidence, SourceCatalog checks the candidate snapshot against an independent authoritative observation and a matching strong validator. Graph paths need authoritative source provenance; external transport responses need exact source/validator/provenance. Zoekt, LSP, Graphiti and Cognee runtimes are not bundled; the graph seam has no database. Structural projection consumes existing typed edges and is not independent source discovery. Model-assisted planning is not implemented.
