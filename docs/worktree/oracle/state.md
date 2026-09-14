# Oracle convergence state

Durable convergence material for the Oracle boundary. This subtree preserves previously agreed direction plus unresolved implementation choices; its path does not automatically make every target detail desired-state authority.

Read `../README.md` and `../../living/contracts.md` before promotion.

## ACCEPTED PURPOSE

Oracle is an infrastructure bridge for explicit context feeding into the Agentic Application Layer.

The application owns the semantic context requirement. Oracle satisfies that requirement by pulling from external/infrastructure sources or application-produced sources, adapting the result and returning an application-shaped context object.

## ACCEPTED SEMANTIC DIRECTION

- application decides what context is needed, why it is needed and what shape it must have;
- Oracle decides where that data lives and how to retrieve/adapt it;
- context resolution is single-pass and explicit: resolve before Worker execution;
- Oracle does not own a run loop, session lifecycle, provider state or before/after hooks;
- Oracle must satisfy the application requirement, not invent broader relevance semantics or silently expand scope.

## OBSERVED IMPLEMENTATION — WAVES A + C

Two real source classes now cross the Oracle boundary through distinct concrete adapters:

```text
EXTERNAL SOURCE
BackendWorkOrder.requiredFiles
 -> repositoryReader.readFile(...)
 -> BackendContext files + sourceRef

INTERNAL APPLICATION-PRODUCED SOURCE
BackendQaHandoff artifact refs
 -> QaWorkOrder.requiredArtifacts
 -> artifactReader.readArtifact(...)
 -> QaContext artifacts + sourceRef + APPLICATION_ARTIFACT provenance
```

Observed invariants:

- Backend external context is still resolved only for declared repository files;
- QA internal context is resolved only for artifact refs selected by its declared required artifact paths;
- Backend -> QA application handoff carries refs and Backend acceptance-decision provenance, not copied artifact contents;
- internal artifact provenance records the producer work-order id and acceptance decision;
- resolution failures name the concrete source boundary (`repository` vs `application artifact store`);
- there is still no generic source registry, retrieval framework, MCP-first adapter layer or serializer IO.

The fact that both adapters perform pull/adapt/validate does not yet justify erasing their lifecycle/provenance differences behind a generic source abstraction.

## CANDIDATE / IMPLEMENTATION-SENSITIVE DETAILS

Concrete artifact-store persistence, caching, source retries, multiple internal artifact producers, future Figma/OpenAPI/CI adapters and retrieval/MCP boundaries must be validated by real source requirements. Historical worktree wording that names a preferred implementation is not enough to promote it.

Current concrete pattern is:

```text
application-owned requirement
        -> select declared source refs/fields
        -> pull from concrete adapter
        -> adapt/normalize with source provenance
        -> validate application-owned context schema
        -> explicit context feed
        -> Worker.execute(...)
```

## CHILDREN

- `semantics.md` — prior semantic invariants and candidate details.
- `architecture.md` — layer placement and dependency direction.
- `workflow.md` — current resolution-flow candidate.
- `decisions.md` — previously accepted/working constraints; reconcile against promoted living decisions when conflicts appear.
- `gaps.md` — unresolved implementation choices and exit conditions.

## NOT ORACLE

Oracle is not an agent, advisor, orchestrator, worker, semantic-memory system, runtime context lifecycle, generic RAG platform or correctness authority.

It does not choose the Worker context contract. It does not participate in Worker reasoning after resolved context has been handed off.
