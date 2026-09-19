# Integration C — cross-domain obligation + dependency invalidation readiness

Status: **CANDIDATE ARCHITECTURE — NOT IMPLEMENTATION AUTHORITY**

This artifact is the Researcher + SA look-ahead for the first post-Integration-B cross-domain slice.

It does not schedule Researcher/SA per PR, does not authorize Integration C source implementation, and does not create a global organization workflow.

## 1. Question

After Integration B proves:

    released claim
      -> domain-local ExecutionPolicy
      -> immutable ExecutionStrategy
      -> ExecutionAttemptBinding
      -> domain completion
      -> authoritative DomainPublicationReceipt

how can one domain's accepted output become another domain's required work without:

- letting the producer dispatch another domain directly;
- turning PM/ApplicationOrchestrator into a global workflow engine;
- treating every artifact revision as a whole-stage reset;
- letting strategy-proposed lineage become product truth;
- losing the ability to explain why one downstream claim became stale while another remained current?

Canonical Integration C case:

    accepted RequirementClaim(s)
        -> SA solution-design workload
        -> ArchitecturePackage / ArchitectureClaim(s)
        -> typed FE / BE / DevOps obligations

then:

    one requirement subject changes
        -> only claims/obligations that actually depend on that subject become stale
        -> unrelated work remains current

## 2. Current ExHarness pressure

Current source already provides useful but insufficient pieces:

- Blackboard supports lifecycle/dependency DAGs, but Board dependencies are operational work dependencies, not product semantic lineage.
- PM/SA coordination allows bounded PM proposals and evidence-bound SA assessments, but SA is not yet an executing domain writer.
- A.1 provides authorized organizational materialization/claim semantics before execution.
- Integration B now requires authoritative DomainPublicationReceipt plus accepted derivation edges; raw strategy lineage is not authoritative.
- The existing durable Backend -> QA workflow still contains cross-domain control and cannot become the organizational continuation model.

Therefore Integration C must connect authoritative domain products to typed downstream obligations, not connect worker callbacks to other workers.

## 3. Research findings

### 3.1 Cross-domain critical output should be artifact state, not conversation handoff

A2A distinguishes transient Messages from durable task Artifacts and says task outputs should be returned as Artifacts rather than relying on messages for critical information.

Implication for ExHarness:

    SA agent says "Backend should implement API X"
        != authoritative downstream obligation

The authoritative cross-domain surface must be an immutable artifact/ref with explicit producer/domain authority and derivation.

Reference:
- https://a2a-protocol.org/dev/specification/

### 3.2 Implicit all-input -> all-output lineage is too coarse

OpenLineage explicit/column-level lineage work exists because treating every input as affecting every output creates false dependencies. Fine-grained input-to-output edges make impact analysis materially more precise.

Implication:

    RequirementSet@r5 changed
        != stale every ArchitecturePackage / FE / BE / DevOps claim

Downstream artifacts should reference the smallest stable semantic subjects they actually consume.

References:
- https://openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet/
- https://openlineage.io/blog/explicit-lineage/

### 3.3 Invalidation should follow the reverse dependency closure, not stages

Bazel Skyframe records a data-flow graph and invalidates the reverse transitive closure of changed inputs. It also uses change pruning when recomputation proves the result is effectively unchanged.

Implication:

    changed requirement subject
      -> reverse authoritative dependency edges
      -> stale affected claims only

not:

    requirements changed
      -> reset SA + FE + BE + QA + DevOps stage

For Integration C v1, ExHarness should implement the conservative reverse-closure rule first. Generic resurrection/change pruning is deferred; a domain may later revalidate under the new input and publish a new current claim instead of mutating old history.

Reference:
- https://bazel.build/versions/8.6.0/reference/skyframe

### 3.4 Historical truth should be append-only; currentness is a projection/head

Event sourcing keeps immutable events/history and rebuilds current projections from them. It is useful here because "claim used to be valid, then upstream changed" is meaningful history and must not be erased.

Implication:

    ProductClaim assertion payload = immutable
    supersede/revoke/stale = new transition fact
    ClaimCurrentnessHead = current mutation pointer/projection

Old accepted claims remain historical facts even when non-current.

Reference:
- https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing

### 3.5 Authority policy versions must be pinned

OpenFGA authorization models are immutable and clients are encouraged to target a specific model id rather than silently use latest.

Implication:

Cross-domain obligation issuance must bind an exact immutable write/issuance policy revision. "SA domain" inside a payload is not authority.

Reference:
- https://openfga.dev/docs/getting-started/immutable-models

## 4. SA decision

Integration C should introduce two separate mechanisms:

    A. CROSS_DOMAIN_OBLIGATION
       who may require what from which domain, from which accepted product facts

    B. DEPENDENCY_INVALIDATION
       which accepted claims/obligations become non-current when an authoritative input changes

They share immutable refs/lineage, but they are not one scheduler.

Hard rule:

    Obligation != Dispatch
    Dependency edge != Work ordering
    Invalidation != Organization reset

## 5. Semantic dependency subject

Container artifacts are often too coarse for correctness-sensitive invalidation.

Example:

    RequirementSet@r4
      - REQ-CATALOG-LIST
      - REQ-CATALOG-DETAIL
      - AC-HEALTH
      - AC-CRITICAL-JOURNEY

Architecture/FE/BE claims should depend on exact semantic subjects where possible:

    BackendCatalogListClaim
      derivedFrom:
        REQ-CATALOG-LIST@r4
        AC-HEALTH@r2

    FrontendDetailClaim
      derivedFrom:
        REQ-CATALOG-DETAIL@r4

A change to REQ-CATALOG-DETAIL must not stale BackendCatalogListClaim merely because both lived in RequirementSet@r4.

Minimal subject shape:

    DependencySubject {
      subjectKey
      subjectKind
      revision
      assertionRef
    }

The stable key identifies what semantic fact is being revised. The immutable assertion ref identifies which exact historical revision was consumed.

Do not use free-form path strings as correctness authority when a stable domain semantic id can exist.

## 6. DOMAIN_WRITE_AUTHORITY

Before SA becomes an authoritative writer, use an immutable policy + current head:

    DomainWriteAuthorityPolicy {
      policyId
      revision
      domain

      canPublishArtifactKinds[]
      canPublishClaimKinds[]

      canIssueObligationKinds[]
      allowedTargetDomains[]
      allowedTargetWorkloadTypes[]

      requiredDerivationKinds[]
      forbiddenMutations[]
    }

    DomainWriteAuthorityHead(domain)
      -> { generation, policyRef, status }

Only a trusted policy publisher may advance the head.

This is distinct from:

    claim authority
      = may this principal execute this already-materialized domain work?

    execution policy
      = HOW does this released work execute?

    domain write authority
      = what authoritative product facts/obligations may this domain publish?

No one of these grants the others.

## 7. CrossDomainObligation

One accepted domain publication may create typed obligations for another domain, but only through the write/issuance authority gate.

Minimal immutable artifact:

    CROSS_DOMAIN_OBLIGATION {
      obligationId
      obligationKey
      revision

      issuerDomain
      issuerPrincipalRef
      issuancePolicyRef
      issuerPublicationReceiptRef

      targetDomain
      workloadType

      rootIntentRef
      parentObligationRefs[]

      requiredInputSubjects[] {
        subjectKey
        revision
        assertionRef
      }

      requiredOutputKinds[]
      acceptanceContractRef

      derivationRefs[]
    }

It MUST NOT contain:

    worker identity
    ExecutionPolicy
    ExecutionStrategy
    Restate workflow id
    priority chosen for target domain
    "run next"
    arbitrary target lifecycle mutation

The producer states what outcome is required and why. The target domain remains owner of HOW.

### Issuance currentness

Publication must:

    read current DomainWriteAuthorityHead
      -> validate obligation kind / target domain / workload type
      -> resolve exact accepted derivation subjects
      -> persist immutable obligation
      -> re-check write-authority head
      -> atomically/canonically publish obligation ref + issuance receipt

A policy race before publication fails/retries. Later policy promotion does not erase the historical fact that the obligation was validly issued.

### Receiving/materialization gate

The target domain does not trust the producer payload directly.

    obligation ref
      -> resolve immutable obligation
      -> verify issuance receipt + historical authority
      -> verify obligation is still current
      -> verify exact required input subjects are current enough for materialization
      -> ordinary scoped MATERIALIZATION_AUTHORIZATION
      -> deterministic OrganizationWorkMaterializer
      -> target-domain OrganizationWorkContract

Same obligation revision + same authorization must converge on the same logical work identity.

A source domain never calls target DomainExecutionController directly.

## 8. Obligation currentness

Obligation payload is immutable. Currentness is separate:

    ObligationHead(obligationKey)
      -> {
           generation,
           obligationRef,
           state: ACTIVE | STALE | REVOKED | SUPERSEDED,
           transitionRef
         }

Transitions are immutable facts.

If an upstream accepted subject becomes non-current, obligations that derive from it become invalidation candidates.

An already-materialized or claimed target work item is not silently deleted. Reconciliation goes through canonical application lifecycle authority; a CLAIMED item uses the existing organization-claim invalidation/fencing path rather than allowing stale execution capability to survive.

Integration C does not define generic autonomous activation; Integration D still owns DOMAIN_ACTIVATION.

## 9. Authoritative derivation graph

Integration B DomainPublicationReceipt is the entry point.

Only acceptedDerivationEdges from an authoritative publication may enter the product dependency graph.

    strategy proposedDerivationEdges
       -> candidate evidence only

    DomainCompletionDecision ACCEPT
       + current DomainWriteAuthority
       -> DomainPublicationReceipt
            acceptedDerivationEdges
       -> authoritative dependency graph

Minimal edge:

    ProductDerivationEdge {
      edgeId
      producerDomain
      outputSubject
      inputSubjects[]
      publicationReceiptRef
    }

Graph constraints:

- every input/output ref must resolve to immutable authoritative subjects;
- output cannot derive from itself;
- a new edge may reference only already-established causal inputs;
- immutable historical graph must remain acyclic by creation order;
- remediation creates new claims/revisions rather than drawing a backward edge into old history.

This avoids turning iterative product work into a literal cycle even when BA -> SA -> BE -> QA -> remediation repeats over time.

## 10. Dependency invalidation

Trigger:

    authoritative subject currentness transition
      CURRENT old revision
        -> SUPERSEDED / REVOKED / STALE
        -> new current revision or no current revision

Algorithm v1:

    changed authoritative subject(s)
      -> resolve reverse acceptedDerivationEdges
      -> compute affected reverse transitive closure
      -> emit deterministic DependencyImpactAnalysis
      -> revalidate graph/currentness snapshot
      -> commit bounded currentness transitions for affected claims/obligations
      -> reconcile affected materialized Board work

DependencyImpactAnalysis is proposal/derived state, not mutation authority.

Mutation authority emits immutable transition receipts/events and advances exact CAS currentness heads.

### Conservative v1 rule

If a dependent claim consumed exact subject revision R and R becomes non-current, that dependent is stale unless a separately trusted revalidation proves compatibility with the replacement.

Do not let an LLM simply declare "this change is probably unrelated" and prune invalidation.

Precision comes first from granular dependency subjects and exact accepted edges, not from optimistic semantic guessing.

### Deferred change pruning

Bazel-style change pruning is valuable but should not be generalized in C v1.

Later, a domain-specific verifier may prove:

    old input R1 -> new input R2
    dependent output remains valid without full re-execution

That should create a new revalidation/currentness fact bound to R2. It must not rewrite the historical derivation that used R1.

## 11. Board consequences

Product semantic lineage and Blackboard work lifecycle remain different.

    Product dependency currentness
      = is this accepted product claim/obligation still valid relative to current inputs?

    Blackboard lifecycle
      = what operational work currently exists / is claimable / claimed / blocked / reviewable?

Invalidation controller may request lifecycle reconciliation, but it does not mutate arbitrary Board fields directly.

Examples:

    affected obligation not yet materialized
      -> mark obligation non-current
      -> no work needed

    READY target work derived only from stale obligation
      -> canonical reconciliation supersedes/replaces bounded work

    CLAIMED target work becomes stale
      -> canonical organization-claim invalidation
      -> fence released execution capability
      -> materialize/reopen bounded replacement/remediation as policy requires

    accepted historical claim becomes stale
      -> historical claim stays immutable
      -> claim currentness becomes STALE
      -> downstream reverse closure follows authoritative edges

No "reset Integration C/D stage" primitive is introduced.

## 12. First concrete Integration C slice

Use BA -> SA first.

Preconditions:

- Integration B BA execution + publication path exists;
- DOMAIN_WRITE_AUTHORITY is implemented for BA and SA;
- RequirementSet exposes stable RequirementClaim / RequirementAcceptanceCriterion subjects rather than only one monolithic bundle ref;
- B DomainPublicationReceipt can carry accepted derivation edges.

Flow:

    RootIntent
      -> BA requirement-analysis work
      -> RequirementSet
      -> RequirementClaim refs / criterion refs
      -> BA publication receipt

      -> typed SOLUTION_DESIGN_REQUIRED obligation
      -> deterministic SA work materialization
      -> trusted SA principal claim
      -> SA domain-local execution
      -> ArchitecturePackage
      -> ArchitectureClaim / interface-contract refs
      -> SA DomainPublicationReceipt

      -> typed FE_FEATURE_REQUIRED
      -> typed BE_FEATURE_REQUIRED
      -> typed DEPLOYMENT_REQUIRED obligations

C may materialize/test those obligations explicitly. Autonomous wake-up remains D.

## 13. Canonical invalidation acceptance scenario

Initial current graph:

    REQ-LIST@r1 ───────► ARCH-LIST@a1 ─────► BE-LIST@b1
                     └──────────────────────► FE-LIST@f1

    REQ-DETAIL@r1 ─────► ARCH-DETAIL@a1 ───► FE-DETAIL@f1

Change only:

    REQ-DETAIL@r1 -> REQ-DETAIL@r2

Expected:

    ARCH-DETAIL@a1    -> STALE
    FE-DETAIL@f1      -> STALE

    REQ-LIST@r1       -> CURRENT
    ARCH-LIST@a1      -> CURRENT
    BE-LIST@b1        -> CURRENT
    FE-LIST@f1        -> CURRENT

If the system instead invalidates all architecture/FE/BE work because RequirementSet changed, Integration C fails its architecture goal.

## 14. Crash/race requirements

Required before C implementation can be accepted:

1. obligation replay converges; duplicate issuance cannot create two logical obligation revisions for the same publication/key;
2. write-authority head race before obligation publication fails/retries without publishing unauthorized obligation;
3. policy promotion after valid publication does not retroactively erase historical issuance;
4. stale/revoked obligation cannot materialize new work;
5. source domain cannot choose target strategy/worker/runtime through the obligation payload;
6. unsupported obligation kind/target domain/workload fails closed;
7. raw strategy-proposed lineage cannot enter invalidation graph;
8. dependency impact analysis bound to graph/head H1 cannot commit against H2 without recomputation;
9. invalidation replay after partial crash is idempotent;
10. CLAIMED stale target work loses executable capability through canonical A.1 invalidation/fencing;
11. unrelated product claims outside reverse transitive closure remain current;
12. historical stale/revoked claims remain reconstructable and are not mutated in place;
13. causal lineage graph rejects self/future/backward edges that would create historical cycles;
14. deleting any disposable impact/projection cache can be rebuilt from authoritative refs/transitions.

## 15. Researcher / SA / Observer placement

Normal product execution does not invoke Researcher or SA as generic reviewers.

SA in Integration C is a real solution-design domain because the ProductObjective/RequirementSet has an architecture obligation.

Researcher is activated only when that SA workload or runtime evidence exposes an unresolved question, for example:

    "Can this consistency requirement be met with current storage semantics?"
    "Do we need a saga or can one atomic boundary satisfy this?"
    "Which deployment/runtime mechanism can prove exact identity?"

Observer later aggregates invalidation/rework evidence. Repeated broad invalidation or cross-domain deadlock can raise an architecture tripwire and create a new SA/research obligation.

## 16. Non-goals

Do not add in C:

- global organization scheduler;
- stage/workflow reset;
- automatic next-domain selection;
- generic event bus as source of truth;
- universal graph database;
- semantic-equivalence LLM judge;
- global ProductStateProjection completeness model (Integration G);
- autonomous DOMAIN_ACTIVATION (Integration D);
- self-improvement/policy promotion loop (Integration J);
- A2A protocol dependency solely to represent obligations.

## 17. Implementation-ready boundary

Integration C is implementation-ready only when the source slice can name exact seams for:

    DomainWriteAuthorityPolicy + Head
    CrossDomainObligation immutable store/ref
    obligation issuance receipt/currentness head
    deterministic target materialization bridge
    accepted ProductDerivationEdge persistence
    DependencyImpactAnalysis
    currentness transition + replay/reconciliation
    Board/claim invalidation adapter
    BA -> SA fixture
    partial invalidation counterexample

The desired invariant is:

    accepted output from domain A
      -> typed authorized obligation for domain B
      -> B owns HOW
      -> exact accepted lineage records WHY
      -> upstream change invalidates only the reverse dependent closure
      -> historical claims remain explainable
      -> no global workflow appears

This artifact is a Researcher + SA candidate. It requires a later explicit implementation-authority decision before source delivery; its existence does not itself schedule review work.
