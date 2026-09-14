# Judgment

Judgments are conclusions derived from evidence. They may remain unresolved across many sessions.

Use this shape:

```text
J-XXX
status: DRAFT | PROPOSED | SUPPORTED | AUDITED | ACCEPTED | REJECTED | CONTRADICTED | SUPERSEDED
claim: <conclusion>
derived-from: [evidence ids]
assumptions: []
alternatives: []
contradictions/risks: []
confidence: <bounded statement, not fake precision>
missing-evidence: []
what-would-change-it: []
```

A judgment must not promote itself. `ACCEPTED` requires an explicit decision boundary. `PROMOTED` is represented by the resulting decision plus mutation of the appropriate durable authority view.

## J-001

status: SUPPORTED

claim: After the second real role, a generic application Worker/WorkOrder/Orchestrator abstraction is still not justified. Backend and QA have materially different execution authority/lifecycle; the common semantics currently proven are narrower: application artifact references plus evidence-integrity/claim-state plumbing.

derived-from: [E-001]

assumptions: [the current Backend and QA slices are representative enough to pressure-test immediate extraction decisions]

alternatives: [introduce one generic Worker with mutating/non-mutating modes; define a role registry plus generic WorkOrder envelope now; keep all structures duplicated with no shared artifact/evidence plumbing]

contradictions/risks: [a third role such as Frontend may reveal a stable common lifecycle that Backend and QA alone do not show; some duplication may later prove unnecessarily concrete]

confidence: Strong for the current two-role implementation; deliberately not universal.

missing-evidence: [a third real role; production multi-work traces; recovery/state behavior across role boundaries]

what-would-change-it: [another concrete role demonstrating the same dispatch/result/lifecycle semantics across roles; production evidence showing repeated orchestration machinery with low semantic variance]

## J-002

status: SUPPORTED

claim: Ref-only application handoff plus Oracle dereference is a viable context-chaining pattern for the current Backend -> QA dependency, while external repository sources and internal application-produced artifacts should remain distinguishable in provenance/adapters.

derived-from: [E-002]

assumptions: [artifact references remain resolvable for the duration of the current workflow]

alternatives: [copy artifact payloads through application workflow state; collapse repository and application artifacts behind one generic source registry now]

contradictions/risks: [artifact lifecycle/persistence is not yet hardened; restart/retry may require additional durable metadata; future source types may reveal a useful narrower common adapter contract]

confidence: Strong for the current in-process two-stage slice; not yet production-hardening evidence.

missing-evidence: [S9 persistence/recovery behavior; artifact-store outage/retry tests; multiple internal producer types; production-scale context-cost measurements]

what-would-change-it: [recovery evidence showing ref-only state is insufficient; provenance requirements forcing richer handoff state; multiple source implementations proving a stable generic adapter boundary]
