# Evidence

Evidence records observations. They do not contain the conclusion that should be drawn from those observations.

Use this shape for material entries:

```text
E-XXX
status: OBSERVED | PARTIAL | CONFIRMED | CONTRADICTED | STALE | SUPERSEDED
source/provenance: <artifact / run / source / decision ref>
observation: <what was actually observed>
supports: [judgment ids]
does-not-establish: [claims this observation cannot prove]
contradicts: [judgment/evidence ids]
```

Rules:

- provenance is required for material claims;
- a few examples do not establish a universal property;
- model prose or a prior judgment is not raw evidence;
- executable/runtime evidence can contradict promoted docs and trigger reconciliation;
- stale evidence remains traceable but must not be treated as current.

## E-001

status: CONFIRMED

source/provenance: `packages/agentic-system/test/wave-c.test.js` at PR #67 head `bdf2aa36f35496c02ca49f5871515c036758fb75`; GitHub Actions PR run `34823931230` passed `npm run verify` on Node 20, 22 and 24.

observation: The second concrete role (QA) executes through ExHarness while forbidding environment mutation and lineage advancement. The existing Backend role mutates a candidate and requires lineage promotion for `APPLIED`. QA completion uses `qa.behavior` and `qa.regression`; Backend completion uses mutation/typecheck/tests. Tests also verify that no generic `createWorker`, `createOrchestrator` or `WorkOrderSchema` export was introduced.

supports: [J-001]

does-not-establish: [that no future role can share a useful Worker/WorkOrder abstraction; that Backend and QA are sufficient to characterize all software-engineering roles]

contradicts: []

## E-002

status: CONFIRMED

source/provenance: `packages/agentic-system/test/wave-c.test.js`, `src/qa-application.js`, `src/oracle.js` at PR #67 head `bdf2aa36f35496c02ca49f5871515c036758fb75`; GitHub Actions PR run `34823931230` passed Node 20/22/24.

observation: An accepted Backend result can be projected into a `BackendQaHandoff` containing the producer work-order id, accepted revision, acceptance-decision reference and artifact refs only. QA selects required artifact paths, Oracle dereferences exactly those refs through `artifactReader.readArtifact(...)`, and resolved QA context preserves `APPLICATION_ARTIFACT` provenance plus source refs. QA is not dispatched when Backend completion is not `ACCEPT`, and dereference failures identify the application-artifact-store boundary.

supports: [J-002]

does-not-establish: [durable artifact-store recovery semantics; cross-process restart correctness; behavior with multiple internal artifact producer types; production-scale handoff reliability]

contradicts: []
