# BB-049 — Integration G product completeness and closure-currentness research

Status: RESEARCH COMPLETE — SA SYNTHESIS INPUT

## Problem

Integration G must answer one correctness question before product closure is implementable:

What exact canonical subject proves that product readiness was evaluated from the complete current product state rather than from a caller-selected subset of claims, obligations or acceptance refs?

Without that boundary, a caller can construct an apparently green projection by omitting a blocking obligation, rejected quality claim, stale dependency or newer superseding subject.

The existing roadmap already rejects that shape: ProductStateProjection must be derived/rebuildable and caller-selected currentClaimRefs / currentObligationRefs are not completeness proof.

## Current-system / predecessor boundary

Current source has no ProductHistoryHead, ProductStateProjection or product closure implementation.

Promoted predecessor semantics establish:

- Integration C: immutable semantic claims/obligations, durable currentness heads/transitions and authoritative accepted derivation edges.
- Integration E/F: exact DeploymentRelease, deterministic AcceptanceSnapshot, runtime observation and immutable QualityAcceptance.
- Integration G must compose these without turning projection into a second source of truth.

Relevant repository inputs:

- docs/living/knowledge/integration-phase-research-to-implementation-readiness-v7.md
- docs/living/knowledge/cross-domain-obligation-lineage-implementation-readiness.md
- docs/living/knowledge/deployment-acceptance-snapshot-implementation-readiness.md
- docs/blackboard/artifacts/implementation-input/integration-c-cross-domain-obligation-lineage-v1.json
- docs/blackboard/artifacts/implementation-input/integration-ef-deployment-acceptance-snapshot-v1.json

## External evidence

### Append-only history as reconstructable source

Microsoft's Event Sourcing pattern treats an append-only event store as the system of record and derives current state by replay. It also uses optimistic concurrency to reject stale appends.

Implication for ExHarness:

- closure-relevant product transitions should be durable immutable history;
- current product state should be derived from that history rather than supplied as an arbitrary current-ref set;
- concurrent writers require one currentness/append boundary, not last-writer-wins mutation.

Source:
https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing

### Projection is disposable

Microsoft's Materialized View pattern treats the view as disposable and rebuildable from source data, not as directly mutated application truth.

Implication:

- ProductStateProjection may cache or summarize readiness;
- deleting the projection must not delete product truth;
- the same pinned history/policy subject must deterministically rebuild the same projection.

Source:
https://learn.microsoft.com/azure/architecture/patterns/materialized-view

### A head can commit to an entire append-only prefix

RFC 9162 Certificate Transparency uses a tree head containing a tree size and root hash, with consistency proofs to establish append-only extension.

ExHarness does not need Certificate Transparency or a Merkle tree in Integration G v1. The useful semantic is simply:

    head = commitment to one complete ordered history prefix

A simpler CAS-fenced generation plus chained digest is sufficient for the repository-controlled v1 threat model. Merkle inclusion/consistency proofs remain optional future hardening if storage or cross-party verification becomes adversarial.

Source:
https://www.rfc-editor.org/rfc/rfc9162.html

## Failure modes

### 1. Projection omission attack

Bad:

    buildProjection({
      currentClaimRefs: [good claims only],
      currentObligationRefs: []
    })
    => ELIGIBLE

Required:

    buildProjection(productHistoryHeadRef, policy subject)
      -> derive complete current set
      -> discovers blocking obligation / rejected claim
      -> NOT_READY

Caller-provided subsets may be query filters for UX but cannot be closure authority.

### 2. Scan race

Bad:

    T1 scan claims
    T2 new blocking obligation becomes current
    T3 scan obligations misses/partially sees it
    T4 projection says ELIGIBLE

A scan over independently mutable heads is not a completeness subject unless all relevant mutations participate in one product-level currentness boundary.

### 3. Projection/closure race

    T1 build projection at H17 => ELIGIBLE
    T2 publish BE supersession => H18
    T3 close using H17

Closure must revalidate the exact history/policy subject immediately before committing the closure assertion. H18 makes the H17 projection stale.

### 4. Permanent DONE bit

Bad:

    ProductOutcomeClaim C1 at H17
    BE changes at H18
    C1 still treated as current DONE

Required:

- C1 remains immutable historical evidence;
- current product readiness at H18 becomes NOT_READY or requires bounded revalidation;
- no mutation of C1 is needed.

### 5. Dual truth

Bad:

    SemanticClaimHead says A current
    ProductHistory replay says B current
    projection chooses whichever is convenient

Integration G must define a product-level completeness boundary, not add an independent competing current-state database.

## SA-ready architecture decision

### A. Introduce a narrow closure ledger

Use an append-only ProductHistory only for closure-relevant semantic transitions:

- root intent / objective / required outcome currentness;
- semantic claim publish/supersede/revoke/currentness transitions;
- obligation issue/resolve/invalidate/currentness transitions;
- accepted derivation/currentness transitions that affect product readiness;
- deployment/quality acceptance currentness;
- acceptance-policy / applicable waiver currentness where policy says they affect closure;
- product closure assertions.

Do not put execution telemetry, queue events, scheduling hints, model traces or general observability into this ledger.

### B. ProductHistoryHead is the completeness subject

Minimal semantic shape:

    ProductHistoryHead {
      productId
      generation
      commitRef
      historyDigest
    }

Each immutable ProductHistoryCommit binds:

    previousHeadRef
    previousGeneration
    previousHistoryDigest
    transitionRefs[]
    commitDigest

Transitions reference already immutable authoritative publication/currentness artifacts.

A closure-relevant transition is not eligible for product closure semantics until it is represented in the canonical committed history prefix.

Implementation may use one atomic transaction or a recoverable prepare/commit protocol. The semantic requirement is stronger than the mechanism:

There must be no observable stable state in which a newer closure-relevant transition is authoritative but the completeness head still proves an older product state.

### C. Do not remove domain currentness heads

Integration C per-subject heads remain useful operational indexes for materialization, invalidation, work/execution admission and targeted currentness lookup.

But they are not by themselves completeness proof for product closure.

Integration G requires every closure-relevant head transition to be anchored into the product-history commit boundary. Product closure consumes the history head, not a caller-selected scan of those indexes.

This avoids making ProductStateProjection or a second arbitrary snapshot store authoritative.

### D. Projection builder derives the complete subject

Caller input should be minimal:

    product identity
    + exact ProductHistoryHead
    + exact current acceptance-policy authority

The trusted builder derives and pins:

    ProductProjectionSubject {
      productHistoryHeadRef
      productHistoryGeneration
      productHistoryDigest
      rootIntentRef
      rootOutcomeSetRef
      productObjectiveRef
      acceptancePolicyRef
      acceptancePolicyRevision
      applicableWaiverRefs[]   // derived, not caller-selected
      projectionAlgorithmVersion
    }

Then it derives the complete current set of claims, obligations, accepted lineage, deployment/quality acceptance and blockers/currentness.

The resulting ProductStateProjection is rebuildable/disposable.

### E. Closure is an append against an exact eligible basis

    ProductHistoryHead H17
      -> ProductProjectionSubject S17
      -> ProductStateProjection = ELIGIBLE_FOR_CLOSURE
      -> authorized closure action
      -> revalidate H17 + policy authority
      -> append immutable ProductOutcomeClaim / closure transition
      -> ProductHistoryHead H18

If the history or policy subject changed before closure append, fail closed and rebuild.

ProductOutcomeClaim binds the exact eligibility basis and remains historical.

### F. Post-closure supersession

Any later closure-relevant transition creates H19+.

The previous ProductOutcomeClaim remains immutable, but it is not automatically current for H19.

    historical closure C1
      + newer product history
      -> current projection re-evaluated
      -> NOT_READY or ELIGIBLE
      -> bounded remediation/revalidation if needed

Integration G v1 does not require mutating or reopening a terminal historical Board record.

## Required invariants

1. caller-selected current refs are not completeness proof;
2. ProductHistoryHead commits to one complete ordered closure-relevant prefix;
3. every closure-relevant product transition participates in the product-history commit boundary;
4. projection is pure/rebuildable from one pinned subject;
5. projection cache/view is disposable;
6. closure revalidates exact history + policy currentness immediately before commit;
7. historical closure assertion is immutable;
8. later relevant history makes prior closure non-current unless revalidated under the new subject;
9. policy/waiver applicability is derived from canonical authority, not supplied as a convenient subset;
10. execution-strategy changes alone do not change product readiness unless product semantic lineage changes.

## Acceptance counterexamples

- omit a current QUALITY_REJECTED claim from caller input -> projection still sees it and returns NOT_READY;
- omit a blocking obligation -> projection still sees it and returns NOT_READY;
- build at H17, advance to H18 before closure -> H17 closure commit rejected as stale;
- delete projection cache -> rebuilding from same subject yields identical result;
- replay history after restart -> same current subject set and readiness;
- change acceptance policy revision with same product history -> old projection subject non-current;
- append a new BackendDelivery after closure -> historical closure retained but current readiness re-evaluates;
- mutate a historical claim/obligation/closure assertion in place -> rejected;
- add an execution-strategy-only revision with unchanged accepted product outputs -> product readiness remains unchanged.

## Rejected alternatives

### Caller supplies current refs

Rejected: omission attack by construction.

### Scan all current heads at closure time

Rejected as the primary correctness model: without one product-level mutation/currentness boundary, concurrent scans cannot prove one complete snapshot.

### Make ProductStateProjection the source of truth

Rejected: cache loss or projection bugs would become product-truth mutation.

### Global database / generic provenance framework

Rejected: Integration G needs a narrow product-closure history boundary, not a universal event platform.

### Merkle tree required in v1

Rejected as unnecessary complexity for the current trusted repository/store threat model. Preserve an exact generation/digest commitment and leave cryptographic inclusion/consistency proofs as future hardening.

## Research conclusion

Integration G is implementation-ready at the semantic level if the implementation input freezes one central guarantee:

Product closure is evaluated only from a canonical, current, complete product-history subject and a canonical policy subject; callers cannot establish completeness by choosing which product facts the projection sees.

This is the missing correctness boundary between E/F Product QA and G product closure.
