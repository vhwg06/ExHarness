# BB-046 — Organizational Integration Implementation Artifact

Status: **PROPOSED — AWAITING INDEPENDENT REVIEW**

Artifact kind: `ORGANIZATIONAL_INTEGRATION_IMPLEMENTATION v1`

Producer assessment: **candidate implementation contract for the first research-to-work bridge slice only**.

Full integration-phase readiness: **NOT CLAIMED**.

Research revision: **v7 trust-transition lifecycle closure**.

Source baseline inspected: `vhwg06/ExHarness@ad36638dd7041a60c224dfe3c9beb252069ecdae` (one living-doc/capability-semantics commit ahead of the earlier v3 baseline; package implementation unchanged by that commit).

### Independent-review summary

```text
Candidate status:
  PROPOSED / AWAITING INDEPENDENT REVIEW

A successful review may authorize:
  SOURCE DELIVERY of implementation slice `implement-integration-a1` only
  through the existing ExHarness delivery/Blackboard lifecycle

It does NOT authorize:
  runtime organizational work by itself
  every future obligation in this artifact
  Integration B→J as implementation-ready

After A.1 code exists, runtime bridge verification separately uses:
  fixture RootIntent + fixture obligation
  + scoped MATERIALIZATION_AUTHORIZATION
  -> deterministic OrganizationWorkMaterializer
  -> domain-owned work contract
  -> trusted-principal claim gate
```

### Terminology

```text
Blackboard item == Board item
  durable lifecycle/dependency/provenance record.

claim work (verb)
  acquire lifecycle ownership of one eligible Board item.

Claim (noun)
  immutable authoritative assertion payload bound to exact subject/ref/revision/evidence.
  Change occurs by supersede/revoke/new Claim, not in-place assertion rewrite.

Obligation
  typed required work/outcome with issuer, target domain and derivation refs.
  It is not a scheduler command.

Activation
  surfaces persisted actionable work to its exact owning domain.
  It does not select next domain/order/execution strategy.

ExecutionPrincipal
  trusted application/infrastructure-derived executor identity. Domain claim authority is derived
  from principal + pinned authority policy; caller-provided domain strings are not authority.

MaterializationAuthorization
  immutable grant/revocation generation lineage bound to exact accepted decision, candidate,
  slice/obligation scope and authority-policy revision.

ProductHistoryHead
  canonical history generation/digest from which the complete current Claim/Obligation/lineage
  set is derived for ProductStateProjection.
```

---

## 0. Authority boundary — this artifact does not authorize itself

The research producer may create this artifact and submit it as a proposal. It may not declare its own proposal accepted or implementation-authorized.

Current ExHarness research semantics already require:

```text
research result
  -> decisionStatus = PROPOSED
  -> Blackboard = PENDING_REVIEW
  -> independent research-workflow review
  -> trusted assessment / project decision boundary
```

Therefore this document intentionally contains **no `IMPLEMENTATION_READY` claim**.

The transition into **source implementation** is permitted only when an independent accepted decision is bound to the exact artifact ref/digest/revision and explicitly scopes `implement-integration-a1`. That source work is created/executed through the **existing** ExHarness project delivery path. The bridge cannot self-host its own implementation.

`MATERIALIZATION_AUTHORIZATION` is a separate **runtime authority** used only after the A.1 component exists, for one bridge acceptance fixture obligation. Accepting the research artifact does not authorize runtime organizational work.

```text
Research producer
  -> candidate implementation artifact
  -> PROPOSED submission
  -> independent readiness review
  -> accepted decision / promotion ref
       + exact implementation-slice scope (`implement-integration-a1`)
  -> existing delivery path implements A.1
  -> post-build verification issues exact runtime fixture materialization grant
  -> only that fixture obligation may be materialized
```

PM may require/transport the review obligation, but PM requirement is not by itself the review verdict. `ApplicationOrchestrator` remains lifecycle mutation authority, and trusted review/evaluator identity remains subject to the existing review contract.

---

## 1. Scope of this candidate

This artifact is intentionally narrower than the full website integration phase.

It attempts to make **one bridge slice** implementable:

```text
accepted BB-046 research decision scoped to source slice `implement-integration-a1`
  -> existing ExHarness delivery path implements A.1
  -> post-build bridge fixture + exact runtime authorization for one fixture obligation
  -> deterministic OrganizationWorkMaterializer materializes only that runtime fixture obligation
  -> immutable role-owned work contract
  -> Board item references that contract
  -> owning domain discovers the work
  -> organizational claim gate validates ownership
  -> ordinary ApplicationOrchestrator.claim(...) mutates lifecycle
  -> fresh session reconstructs the same state
```

It does **not** claim that the following are already specified enough to implement the full organization:

```text
multi-domain wake-up/trigger transport
full ProductStateProjection truth table
remediation timeout/escalation policy
QA exact-revision snapshot/freeze
risk waiver governance
cross-domain self-improvement compatibility
generic cross-domain write-scope authority
root-intent/scope authority for real PM product framing
dependency/claim lineage + transitive invalidation
obligation issuance authority across domains
policy-complete ProductStateProjection inputs
domain-local execution-control migration from current Orchestrator ownership
post-closure currentness / historical closure invalidation
```

Those are explicit downstream research obligations in Section 10.

---

## 2. Evidence trail

### 2.1 Current ExHarness source evidence

| Ref | Source | Source-backed fact used by this artifact |
| --- | --- | --- |
| `E-SRC-01` | `docs/worktree/agentic-application/research-continuation.md` | A final research result is `PROPOSED`, Blackboard becomes `PENDING_REVIEW`, and the research controller cannot mark itself `DONE` or promote an architecture decision. |
| `E-SRC-02` | `packages/agentic-system/src/research-continuation.js` | `submitProposal(...)` atomically submits a result and a PM-sourced independent `research-workflow` review requirement. |
| `E-SRC-03` | `packages/agentic-system/src/application-orchestrator-base.js` | `extendWorkGraph(...)` is fenced, transactional, validates dependencies, and attaches artifact/evidence refs without requiring role fields in the generic Board item. |
| `E-SRC-04` | `packages/agentic-system/src/session-handoff.js` | Eligibility is currently derived from lifecycle/dependencies; work-product refs are exposed separately and project/root provenance is validated. |
| `E-SRC-05` | `docs/worktree/agentic-application/work-selection.md` | Selection/proposal is intentionally separate from canonical claim; ordinary `ApplicationOrchestrator.claim(...)` rechecks current Board eligibility. |
| `E-SRC-06` | `packages/agentic-system/src/pm-sa-coordination.js` | PM coordination can persist an external proposal and then delegate bounded new-work mutation to `extendWorkGraph(...)`; new-work authority fields are not caller-controlled. |
| `E-SRC-07` | `docs/worktree/agentic-application/project-acceptance.md` | Review dispatch, trusted evaluator identity, evidence, decision and attestation are separate from reviewer prose; Orchestrator remains completion/lifecycle authority. |
| `E-SRC-08` | `docs/living/blackboard.md` | Blackboard is operational lifecycle state, not an actor/correctness authority; role-local completion is not enclosing problem completion. |
| `E-SRC-09` | `packages/agentic-system/src/session-handoff.js` | One durable `USER_INTENT_ROOT` is required for handoff-safe work; project/root provenance is validated across sessions. |
| `E-SRC-10` | `packages/agentic-system/src/pm-sa-coordination.js` | PM proposal parsing forbids `intentPatch`; current PM coordination cannot directly rewrite durable user intent, but this does not yet define PM ProductObjective/ScopeDecision weakening rules. |
| `E-SRC-11` | `docs/worktree/agentic-application/project-acceptance.md` | Current trust artifacts use write-before-ref publication: durable immutable payload precedes canonical Blackboard ref; orphan payload is not completion authority. This is the model reused for work-contract publication. |
| `E-SRC-12` | source search at pinned baseline | No general source-backed primitive was found that provides typed product-claim lineage plus transitive downstream staleness from artifact supersession; therefore dependency invalidation remains an explicit blocking contract, not an assumed capability. |
| `E-SRC-13` | `docs/worktree/agentic-application/boundaries.md` at current baseline | Current source explicitly assigns `Which Worker executes` to Orchestrator; therefore role-local execution-policy/strategy/worker resolution is a migration gap, not an already-delivered capability. |
| `E-SRC-14` | `packages/agentic-system/src/blackboard-orchestrator.js` | Current `supersede(...)` rejects `DONE`; no general source-backed terminal-DONE invalidation primitive was found. Post-closure currentness must not assume terminal mutation exists. |
| `E-SRC-15` | source search at current baseline | No implemented organizational principal→domain authorization, materialization-authorization lifecycle, or deterministic organization-work materialization identity was found; these are first-bridge implementation obligations. |
| `E-SRC-16` | `packages/agentic-system/src/durable-backend-qa.js` + `docs/living/knowledge/bb032-composition-boundary.md` | Current durable Backend→QA consumer selects Backend, QA and remediation stages across domain semantics. It may remain a compatibility vertical, but lifting it unchanged as one domain `ExecutionStrategy` would preserve hidden cross-domain dispatch. |

### 2.2 External evidence used as architecture constraints

| Ref | Source | Relevance |
| --- | --- | --- |
| `E-EXT-01` | Thoughtworks / Fowler, *An Accidental Blackboard* | Shared blackboard coordination without sequential handoff controller. |
| `E-EXT-02` | A2A Protocol | Messages are communication; durable critical outputs belong in Artifacts. |
| `E-EXT-03` | BSP / Multi-BSP | Explicit barriers are useful bounded synchronization primitives but imply non-local/global coordination when used globally. |
| `E-EXT-04` | Kubernetes authentication/authorization docs | Authorization is evaluated from authenticated principal/request attributes + policy; a caller-provided role label is not identity proof. |
| `E-EXT-05` | OpenFGA immutable models + consistency docs | Authorization policy versions should be pinned; revoke-sensitive checks may require higher consistency rather than stale cache. |
| `E-EXT-06` | Restate services docs | Durable execution spans Basic Services, Virtual Objects and Workflows; Workflow `run` executes once per workflow ID. This supports Restate as a replaceable strategy runtime rather than an organizational primitive. |
| `E-EXT-07` | Restate deployment/versioning docs | Deployments are immutable; in-flight invocations remain on their original deployment while new requests normally route to the latest version. Exact strategy evaluation therefore needs a pre-invocation runtime binding, not only a post-hoc strategy label. |
| `E-EXT-08` | Restate service communication / invocation docs | Idempotency keys and invocation identities can support adapter-level attempt correlation/deduplication, but they do not replace ExHarness organizational authority or semantic work identity. |
| `E-EXT-09` | Restate Lambda/Vercel/Deno/Kubernetes deployment docs | Stable/version-specific deployment addresses are concrete ways to make runtime code identity explicit; an adapter must fail closed if the intended code version cannot be addressed or verified. |
| `E-EXT-10` | Temporal retry/idempotency guidance | Retried external side effects need stable idempotency semantics; content identity alone is not an exactly-once logical work guarantee. |
| `E-EXT-11` | Azure Event Sourcing pattern | Append-only immutable history is source of truth; projections are rebuildable views and historical correction is represented by new facts rather than rewriting history. |

External references:

- https://www.martinfowler.com/articles/exploring-gen-ai/an-accidental-blackboard.html
- https://a2a-protocol.org/dev/specification/
- https://people.seas.harvard.edu/~valiant/bridging-2010.pdf
- https://kubernetes.io/docs/concepts/security/controlling-access/
- https://openfga.dev/docs/getting-started/immutable-models
- https://openfga.dev/docs/interacting/consistency
- https://docs.restate.dev/concepts/services/
- https://docs.restate.dev/develop/java/service-communication
- https://docs.restate.dev/services/deploy/lambda
- https://docs.restate.dev/services/deploy/kubernetes
- https://docs.restate.dev/services/deploy/vercel
- https://docs.restate.dev/services/deploy/deno-deploy
- https://learn.temporal.io/assets/files/crafting-an-error-handling-strategy-dotnet-replay2025-e633cef41481baac8b25a636533c4d37.pdf
- https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing

### 2.3 What the evidence does **not** establish

The evidence above does not prove:

```text
production organization effectiveness
security isolation between mutually hostile role processes
that external work-contract indirection will remain cheap at full product scale
that event-driven activation is superior for every domain
that the twelve downstream mechanisms in Section 10 are solved
```

---

## 3. Hard invariants for independent review and downstream implementation

These are not open design preferences. They are hard constraints for this candidate and for any first-bridge implementation derived from it:

```text
Role != Pipeline
Organization != Workflow
Workload != Workflow
WorkContract != ExecutionPlan
ExecutionPolicy != Work Scheduler
ExecutionStrategy != Product / Write Authority
ExecutionStrategy != Cross-Domain Dispatcher
Execution strategy may evolve; work semantics may not silently evolve with it
ExecutionStrategy descriptor != runtime deployment identity
Blackboard != Scheduler
Oracle != Coordinator
Core != Product Authority
Message != Authoritative Output
Research producer != acceptance authority
PM != Organization Scheduler
Artifact acceptance != blanket obligation authorization
Caller asserted domain != execution authority
Authority-ref string != authority proof
ExecutionAuthorityPolicy currentness is durable/fenced, not ambient configuration
Board CLAIMED != released executable capability
ClaimReleaseHead.FENCED != Blackboard lifecycle transition
Authority invalidation must have one canonical durable Board consequence
Authorization grant != permanent claimability
Materialization replay != duplicate organizational work
OrganizationWorkMaterializer != Execution Resolver
Activation != Scheduling
ApplicationOrchestrator != Domain Execution Controller
Process restart/takeover != new semantic execution attempt
Claim assertion payload is immutable
Policy waiver != RootIntent amendment
Historical ProductOutcomeClaim != current DONE
ProductStateProjection != Product Authority
```

A reviewer should reject/reopen this candidate if its contracts or derived implementation obligations violate any invariant above. Downstream implementation must not silently reinterpret them into a global role registry, a whole-organization workflow graph, Oracle dispatch, Core product authority, or producer self-acceptance, PM-as-dispatcher, or mutable projection authority.

These invariants are intentionally separate from `unresolved`: `unresolved` says what remains open; `invariants` says what is already constrained and must remain true while those gaps are researched.

---

## 4. Resolved decisions and rejected alternatives

### D1 — Research output is a candidate artifact, not a self-issued readiness claim

**Selected:** research publishes a candidate implementation artifact, then existing independent review/decision authority accepts or rejects the exact artifact.

**Rejected:** research producer writes `status: IMPLEMENTATION_READY` into its own output and implementation treats that field as authority.

Reason:

```text
producer assertion != independent acceptance
```

This is already the current ExHarness research-continuation contract (`PROPOSED -> PENDING_REVIEW`).

---

### D2 — First bridge slice keeps generic Blackboard lifecycle-only; domain/workload semantics are referenced externally

**Selected for this slice only:**

```text
Blackboard item
  = lifecycle + dependency + continuation + review + provenance + refs

ORGANIZATION_WORK_CONTRACT
  = owningDomain + workloadType + exact work/input/output/acceptance semantics
```

The Board item references the exact immutable work contract.

**Rejected for the first slice:** add generic native fields such as:

```text
role
domain
workloadType
pipelineId
capabilityRegistry
```

to every Blackboard item.

#### Why select external contract for the first slice

Advantages:

```text
+ preserves the delivered generic Blackboard contract
+ avoids turning one organizational experiment into a universal Board schema
+ gives role/workload semantics independent versioning and content identity
+ fits current ref-only artifact and session-handoff patterns
+ rollback is application-local
```

Costs:

```text
- role/domain query requires dereference or an application index
- generic Blackboard alone cannot enforce domain authorization
- ProductStateProjection cannot rely on native Board domain columns
- invalidation/product-state traversal will need explicit artifact/claim lineage
```

Therefore this is **not** a permanent decision that Blackboard must never become role-aware. It is a bounded first-slice decision. Integration G must measure/query the real lineage model before deciding whether an index/projection or a native schema change is justified.

#### Authority consequence

`owningDomain` inside an external contract is **not sufficient authority by itself**. A domain cannot merely self-report a matching string and then call the Board.

The first slice therefore requires a separate application gate:

```text
OrganizationWorkClaimController
  -> obtain trusted ExecutionPrincipal
  -> resolve CURRENT durable ExecutionAuthorityPolicyHead(policyId) with revoke-sensitive consistency
  -> derive principal authorizedDomains
  -> resolve exact work contract
  -> validate project/root/item binding
  -> require owningDomain in authorizedDomains(principal)
  -> revalidate active materialization authorization generation
  -> validate current Board eligibility
  -> derive Board owner/execution identity from trusted principal
  -> delegate canonical mutation to ApplicationOrchestrator.claim(...)

`requestedDomain` from caller is not authority. A principal outside BA cannot become BA by sending `requestedDomain=BA`.
```

This is application-level authority enforcement, not cryptographic isolation between hostile processes. Strong cross-process credentials remain a future concern if role runtimes become separately trusted principals.

---

### D3 — Work-contract governance is inside the artifact/provenance model, not static config outside it

`ORGANIZATION_WORK_CONTRACT v1` is an immutable, content-addressed application artifact.

Runtime authoring authority **after A.1 code exists**:

```text
bridge acceptance fixture
  + explicit MATERIALIZATION_AUTHORIZATION including exact fixture obligationKey
  -> deterministic OrganizationWorkMaterializer
  -> verify obligationKey is inside accepted scope
  -> copy/validate exact domain/workload/dependency/output/acceptance semantics from obligation
  -> persist immutable content-addressed work contract
  -> create + attach exact ref through one narrow fenced ApplicationOrchestrator.materializeAcceptedWork(...) transaction
```

A role domain may consume the contract but may not rewrite it.

`OrganizationWorkMaterializer` is deliberately **not PM, not a scheduler, and not an execution-policy/strategy resolver**. It has no policy to choose the next domain, no model call, and no authority to change `owningDomain`, `workloadType`, dependencies, output kind or acceptance refs relative to the authorized obligation. It has no `ExecutionPolicyRef`, `ExecutionStrategyRef` or runtime-binding path. HOW resolution happens only later, after a released valid claim, inside the owning-domain execution controller and is persisted as `ExecutionAttemptBinding`. Insufficient obligation data or an obligation key outside the accepted authorization scope fails closed and reopens decision/research instead of inventing dispatch.

Publication atomicity follows write-before-ref:

```text
put(content-addressed ORGANIZATION_WORK_CONTRACT)
  -> fenced ApplicationOrchestrator.materializeAcceptedWork creates Board item + exact contract ref atomically

crash after put but before Board transaction:
  -> orphan contract may remain
  -> no eligible Board work exists
  -> orphan has no lifecycle/dispatch authority
  -> retry reuses the same content identity

Board transaction failure:
  -> no partially attached Board item/ref

successful Board transaction:
  -> Board-linked ref is canonical visibility/commit receipt
```

Rollback of the orphan artifact is not required for correctness because artifact existence is not authority.

Updates are not in-place mutation:

```text
contract v1 cannot be edited
change required
  -> supersede unfinished work through existing lifecycle authority
  -> materialize replacement work + new contract ref
  -> preserve provenance to the superseded item/contract
```

The first slice supports exactly one active organization work contract per organizational Board item; multiple conflicting contract refs fail closed.

---

### D4 — Deterministic obligation materialization is distinct from PM+BA product delivery

These are two different slices.

**Bridge source implementation:**

```text
accepted research decision scoped to `implement-integration-a1`
  -> EXISTING ExHarness project-delivery path
  -> implement A.1 components/tests
```

**Bridge runtime acceptance fixture after code exists:**

```text
fixture RootIntent + exact BA fixture obligation + runtime materialization grant
  -> OrganizationWorkMaterializer
  -> BA domain can discover + trusted-principal claim it
```

It ends **before BA executes requirement analysis**. The materializer never creates the task that implements itself.

**Later PM+BA vertical:**

```text
RootIntent + ROOT_OUTCOME_SET
  -> PM ProductObjective / ScopeDecision
  -> authorized BA requirement-analysis work
  -> BA trusted-principal claim
  -> BA DomainExecutionController
  -> pinned ExecutionPolicy -> ExecutionStrategy -> ExecutionAttemptBinding
  -> RequirementSet
  -> PM observes product progress
```

The bridge proves deterministic obligation-to-work materialization plus organizational work ownership/claim semantics; it must not create a PM dispatch path. The PM+BA vertical proves actual product work.

---

### D5 — Reject a global BSP/phase barrier as the organization control model; permit bounded local barriers where consistency requires one

BSP uses explicit barrier synchronization between global supersteps. That is useful when a computation intentionally wants all participants to complete a phase before progressing.

For this integration objective, a **global** barrier such as:

```text
all analysis complete
  -> barrier
all implementation complete
  -> barrier
all testing complete
```

would reintroduce the global stage semantics the phase is trying to avoid. It would also block unaffected domains behind the slowest participant.

So the candidate architecture remains:

```text
shared-state / obligation-driven autonomy
+ explicit dependencies
+ local synchronization only at bounded integration boundaries
```

A future QA exact-revision acceptance snapshot is a good example of a **local barrier**: QA can pin one coherent FE/BE/deployment input set without freezing the whole organization. The exact mechanism is still unresolved and is blocking before Product QA, not before this first bridge slice.

---

### D6 — Research does not pre-create the implementation backlog

The candidate artifact may define stable implementation obligations, but concrete Board item ids are created only after acceptance against fresh current project state.

**Rejected:** researcher creates ten future Board items during research.

Reason: that would couple speculative research state to current lifecycle and let the research producer dispatch its own downstream work.

---

### D7 — RootIntent is outside ordinary PM scope authority

Current source already has a durable `USER_INTENT_ROOT`, and PM coordination rejects direct `intentPatch`; the integration phase must preserve that boundary when real `ProductObjective`/`ScopeDecision` artifacts appear.

```text
RootIntent
  = user/product-owner authorized objective + constraints
  + accepted ROOT_OUTCOME_SET with stable mandatory outcome / acceptance-obligation ids

PM ProductObjective / ScopeDecision
  = refinement bound to exact RootIntent + ROOT_OUTCOME_SET revision
  + explicit preservedOutcomeIds / preservedAcceptanceObligationIds
```

PM may refine/decompose and prioritize, but ordinary PM scope authority may not weaken root outcomes, remove acceptance obligations, silently supersede RootIntent, or close against a different revision. Enforcement is not PM self-report: `ROOT_INTENT_SCOPE_AUTHORITY` must deterministically require every mandatory outcome/acceptance id from the accepted `ROOT_OUTCOME_SET` to remain covered by the `ScopeDecision`. **Integration B v1 has no policy-exception bypass for mandatory root outcomes.** Removing/changing a mandatory id requires a new RootIntent/ROOT_OUTCOME_SET revision accepted by root/product-owner authority. Later policy waivers may alter policy treatment but `Policy waiver != RootIntent amendment`. This contract blocks Integration B.

---

### D8 — ProductStateProjection is a disposable derived view over a complete canonical history subject

**Selected:** canonical append-only product history/head (or equivalent completeness-proved ledger) is the source from which current Claims, Obligations and lineage are derived. `ProductStateProjection` receives a pinned history head + root/policy/waiver refs and computes readiness.

**Rejected:** caller supplies arbitrary `currentClaimRefs[]` / `currentObligationRefs[]` and asks projection to trust that subset as complete.

Required semantics:

```text
ProductHistoryHead { generation, digest }
  -> derive complete active Claim/Obligation/lineage set
  -> ProductStateProjectionInput pins head + RootIntent + RootOutcomeSet + ProductObjective
     + acceptance policy revision + waiver refs
  -> deterministic projection
```

Deleting projection cannot delete truth. Rebuild from the same canonical head/input yields the same readiness.

---

### D9 — Claim assertion payloads are immutable

`Claim` the product-state noun is distinct from the verb *claim work*.

```text
claim work
  = acquire lifecycle ownership of one Board item

Claim artifact
  = immutable assertion payload bound to exact subject/ref/revision/evidence
```

An authoritative Claim assertion may be superseded, revoked, or replaced by a new Claim; its assertion payload/digest may not be rewritten in place after downstream consumers bind to it. Mutable lifecycle metadata may exist outside the assertion payload. This is required for deterministic history reconstruction and transitive invalidation.

---


### D10 — Domain claim authorization derives from trusted principal, not a domain string

Selected: injected/authenticated `ExecutionPrincipal` + pinned authority policy maps principal -> authorized domains. Claim controller authorizes against that mapping and derives Board owner identity from the principal.

Rejected: `requestedDomain == owningDomain` as the authorization proof.

This is application authorization, not a claim of cryptographic hostile-process isolation.

---

### D10.1 — Execution-authority policy currentness is a durable application subject

A.1 does not treat an ambient/current config object as proof of domain membership. The execution-authority model is immutable/versioned, while **currentness** is represented by a narrow durable CAS head:

```yaml
EXECUTION_AUTHORITY_POLICY v1:
  policyId: organization-execution-authority
  generation: 7
  projectId: <project>
  status: ACTIVE
  bindings:
    - principalRef: principal://ba-worker-01
      authorizedDomains: [BA]
  issuedByAuthorityRef: <application/root authority>

EXECUTION_AUTHORITY_POLICY_HEAD:
  policyId: organization-execution-authority
  generation: 7
  policyRef: <exact immutable policy ref>
  status: ACTIVE
```

Publishing generation `N+1` requires CAS against observed generation `N`. Removing a principal/domain binding or disabling the policy therefore advances the head; an older policy ref may remain historical but cannot be replayed as current authority. Fresh processes resolve the same durable head. Claim/release provenance pins exact `policyId + policyRef + generation`.

This is intentionally narrow application authority, not a generic IAM/RoleRegistry subsystem. `issuedByAuthorityRef` is provenance, not proof: policy publication must use a trusted application authority adapter/context that derives/verifies the publisher identity before payload persistence/head CAS. Worker principals cannot publish or advance their own execution-authority policy head merely by supplying an authority ref.

### D10.2 — Board `CLAIMED` is provisional; executable capability requires a durable claim-release receipt

A successful Blackboard claim proves lifecycle ownership only. It does **not** by itself cross the trust → execution boundary. A.1 introduces an immutable `CLAIM_RELEASE_RECEIPT` plus a durable claim-release head keyed by exact Board claim generation:

```yaml
CLAIM_RELEASE_RECEIPT v1:
  projectId: <project>
  rootIntentId: <root>
  itemId: <board item>
  workContractRef: <exact>
  principalRef: <trusted execution principal>
  boardOwner: <derived owner identity>
  claimGeneration: 4
  materializationAuthorizationId: <id>
  materializationAuthorizationRef: <exact grant ref>
  materializationAuthorizationGeneration: 2
  executionAuthorityPolicyId: organization-execution-authority
  executionAuthorityPolicyRef: <exact policy ref>
  executionAuthorityPolicyGeneration: 7
```

Canonical release state is:

```text
Board item == CLAIMED at exact {owner, claimGeneration}
+ durable ClaimReleaseHead(itemId, claimGeneration) -> exact receiptRef
+ receipt still matches CURRENT materialization-auth head
+ receipt still matches CURRENT execution-authority-policy head
= eligible for execution-entry revalidation
```

Receipt artifact existence alone is not capability. The release head is the durable commit point; an orphan receipt is inert. Duplicate release for the same claim generation must converge on the same receipt; a conflicting receipt for the same release subject fails closed.

`ClaimReleaseHead.FENCED` is **not** a Blackboard lifecycle transition. It only removes execution capability for one exact claim subject. A.1 therefore adds one canonical lifecycle invalidation transition for organization-managed claims:

```text
invalidateOrganizationClaim({
  itemId,
  expectedOwner,
  expectedClaimGeneration,
  invalidationRef,
  invalidationKind
})
```

The transition is fenced by the exact current Board claim tuple and is atomic in the Blackboard transaction:

```text
EXECUTION_AUTHORITY_INVALIDATED
or ABANDONED_PROVISIONAL_CLAIM

  CLAIMED { owner=X, claimGeneration=N }
    -> attach exact CLAIM_AUTHORITY_INVALIDATION ref
    -> clear owner
    -> REOPENED
    -> claimGeneration remains N
       (the next ordinary claim advances it to N+1)


WORK_AUTHORIZATION_INVALIDATED
(materialization authorization revoked/superseded)

  CLAIMED { owner=X, claimGeneration=N }
    -> attach exact CLAIM_AUTHORITY_INVALIDATION ref
    -> clear owner
    -> BLOCKED with exact authorization-invalidation blocker/ref
    -> claimGeneration remains N
```

`REOPENED` is used when the work is still valid but the current executor is no longer authorized. `BLOCKED` is used when the work itself no longer has current materialization authorization. A.1 does not auto-supersede or silently re-authorize blocked work.

The immutable invalidation artifact is derived control provenance, not a new policy authority:

```yaml
CLAIM_AUTHORITY_INVALIDATION v1:
  projectId: <project>
  rootIntentId: <root>
  itemId: <item>
  expectedOwner: <derived trusted owner>
  expectedClaimGeneration: N
  kind: EXECUTION_AUTHORITY_INVALIDATED | ABANDONED_PROVISIONAL_CLAIM | WORK_AUTHORIZATION_INVALIDATED
  observedMaterializationAuthorization:
    ref: <exact head/artifact ref>
    generation: <n>
    status: <status>
  observedExecutionAuthorityPolicy:
    ref: <exact policy ref>
    generation: <n>
    status: <status>
  releasedClaimReceiptRef: <optional exact ref>
  reasonRefs: [<grounded refs>]
```

The payload alone cannot mutate Board state. The organization controller validates/derives it from trusted currentness surfaces and then calls the exact-tuple Blackboard mutation.

Invalidation is a **monotonic safety action**. If a later policy revision re-authorizes the principal after invalidation was triggered, the old claim is not resurrected. The work must be claimed/released again against the newer current heads. This may cost an extra re-claim under races, but it never preserves execution capability from stale authority.

The **ordering is intentional**:

```text
1. commit canonical Board lifecycle invalidation first
2. then idempotently fence ClaimReleaseHead(itemId,N)
```

Do not fence the release head first and then hope to repair the Board. Once the Board transaction leaves `CLAIMED`, execution entry already fails the exact Board tuple check, so a crash before release-head cleanup is safe. The stale release head is historical cleanup state, not usable capability.

Crash/recovery semantics are explicit:

```text
crash before Board invalidation commits
  -> Board may still be CLAIMED
  -> execution entry revalidates authority and refuses execution
  -> fresh process runs organization-claim reconciliation and retries the exact invalidation

crash after Board invalidation but before release-head fence
  -> Board is already REOPENED/BLOCKED and non-executable
  -> fresh process idempotently fences the old release head
  -> for REOPENED work, another authorized principal may claim normally

crash after release-head cleanup
  -> both durable surfaces agree

provisional CLAIMED with no release head
  -> invalidation still works; no release receipt is required
```

A.1 organization-managed claim recovery must not use generic `recoverClaim(...)` as a synonym for revocation. `recoverClaim(...)` means claimed-work takeover and keeps the item `CLAIMED`; authorization invalidation instead releases/blocks ownership through `invalidateOrganizationClaim(...)`. Later execution recovery may still use a separately authorized organizational recovery path, but it cannot bypass the exact authority checks above.

### D11 — Materialization authorization is revocable/fresh and logical work identity is deterministic

Authorization grant/revocation are immutable generation-bound artifacts. Materialize/claim/execution entry revalidate current authorization head. Revocation fences linked non-terminal work.

Logical work uses deterministic `obligationSubjectKey` + grant-bound `materializationKey`; identical concurrent retries converge on one Board item/commit receipt. Content-addressed work-contract identity alone is insufficient.

---

### D12 — Domain-local execution control is a migration, not current behavior

Current source still assigns `Which Worker executes` to Orchestrator. A.1 intentionally stops after claim. Before Integration B actually runs BA, accepted `DOMAIN_EXECUTION_CONTROL` must split:

```text
ApplicationOrchestrator
  = canonical Board lifecycle / generation fencing

OwningDomainController
  = one released claim only
  -> exact workloadType
  -> pinned immutable ExecutionPolicy
  -> ExecutionStrategyRef
  -> immutable ExecutionAttemptBinding
  -> execute/recover
  -> ExecutionAttemptOutcome + provenance
```

`ExecutionPolicy` is HOW-policy for already-claimed work; it is not a scheduler. `ExecutionStrategy` is replaceable execution mechanics and is not product/write authority. A strategy output still passes domain completion/verification/write gates.

The execution attempt binding must pin exact strategy/config/runtime identity **before execution**. Binding publication is fenced against the observed domain execution-policy head: if that head changes before the binding commits, resolution restarts/fails closed. After a binding commits, later policy promotion does not rewrite that attempt. Recovery of the same semantic attempt reuses the same binding; a new remediation attempt gets a new `executionAttemptId` and may resolve the current accepted policy again.

No organization-level next-domain scheduler is introduced.

### D12.1 — Minimal policy/strategy descriptor semantics

`DOMAIN_EXECUTION_CONTROL` must not simply move central scheduling into a new object called `ExecutionPolicy`. Policy resolution is scoped to exactly one released claim.

```yaml
EXECUTION_POLICY v1:
  policyId: backend.feature-delivery
  revision: p17
  domain: BACKEND
  workloadType: feature-delivery
  compatibleWorkContractVersions: [v1]
  strategyRef: strategy://backend-feature/v4

EXECUTION_STRATEGY_DESCRIPTOR v1:
  strategyId: backend-feature
  strategyVersion: v4
  strategyKind: restate-handler | restate-workflow | application-core-loop | human-assisted
  compatibleWorkloadTypes: [feature-delivery]
  compatibleWorkContractVersions: [v1]
  adapterRef: <exact adapter/config ref>
  runtimeBindingMode: VERSION_ADDRESSABLE | IMMUTABLE_LOCAL | HUMAN_SESSION
```

Policy input is bounded to:

```text
released claim receipt
+ exact ORGANIZATION_WORK_CONTRACT
+ exact domain execution-policy head
```

Policy may choose HOW for that exact claimed work. It may not choose another work item/domain, change priority, rewrite work inputs/outputs/acceptance, waive authority, or issue downstream obligations. Strategy compatibility failure blocks/escalates instead of mutating WHAT to fit HOW.

`strategyVersion` describes the accepted strategy descriptor; it is not automatically proof of the code/deployment that actually ran. `ExecutionAttemptBinding` must separately pin `runtimeBindingRef` + `runtimeCodeIdentity` before invocation.

### D12.1.1 — Semantic execution-attempt ownership is durable and independent from process restart

`ExecutionAttemptBinding` needs an owner subject above individual strategy adapters. A process restart, controller takeover, or `claimGeneration` fencing event must not silently create a new semantic attempt and thereby resolve a newer policy or repeat side effects.

Minimum `DOMAIN_EXECUTION_CONTROL` contract before Integration B:

```text
ExecutionAttemptHead(workId)
  -> current attempt subject / ordinal / status / bindingRef

no current attempt
  + released claim
  -> CAS create attempt-1

ACTIVE / RECOVERY_REQUIRED attempt
  -> recovery/takeover reloads SAME executionAttemptId + SAME binding

new remediation attempt
  -> requires exact domain completion/remediation decision
  -> CAS advance attempt head
  -> new executionAttemptId
  -> resolve current ExecutionPolicy again
```

`claimGeneration` still fences Board writers, but it is not itself the semantic attempt identity because `recoverClaim(...)` can increment generation while the external/Core attempt still requires reconciliation/recovery. Strategy adapters may use `executionAttemptId` as runtime/idempotency identity, but they do not decide when a new semantic attempt exists.

Hard rule:

```text
restart/takeover != new attempt
new attempt requires an explicit durable lifecycle/remediation transition
```

### D12.2 — `Pipeline` is not the architectural primitive

Selected model:

```text
Role Domain
  -> Workload Type
  -> ExecutionPolicy
  -> ExecutionStrategy
```

A pipeline/workflow may exist inside one strategy implementation, but `Workload != Workflow`.

This lets strategy evolve without silently changing:

```text
work contract
obligation meaning
authoritative output kind
acceptance semantics
RootIntent
```

### D12.3 — Restate is a candidate strategy runtime, not organization architecture

External research supports Restate as a strategy option:

- durable execution applies to Basic Services, Virtual Objects and Workflows;
- Workflow `run` executes once per workflow ID;
- immutable deployments keep an in-flight invocation on the same service-code deployment;
- new invocations normally route to the latest registered deployment.

Consequences for an eventual Restate adapter:

```text
executionAttemptId != stable workId
Workflow adapter: executionAttemptId is the candidate workflow ID
Basic-Service/independent-call adapter: executionAttemptId is the stable idempotency subject where applicable
exact strategy runtime version must be addressable/verified before start
same-attempt recovery stays on the pinned binding/deployment
new strategy revision affects new attempts only
Restate multi-agent/router logic, if used, stays inside one bounded domain strategy
```

A Restate service name that simply routes "latest" is not sufficient proof of `strategyVersion=vN` for baseline/candidate replay. The adapter needs a version-addressable runtime binding or an equivalent fail-closed preflight. The binding must distinguish:

```text
strategy descriptor identity  = backend-feature@v4
runtime code identity         = exact Restate deployment / immutable endpoint / image digest
runtime invocation identity   = the concrete invocation created for executionAttemptId
```

A preflight against a mutable alias followed by invocation is not enough if the target can change between check and start; controlled evaluation requires an addressable/atomic binding or post-start proof that the created invocation is pinned to the intended exact deployment before its outcome can count.

Restate may orchestrate Core Harness calls; the two are not mutually exclusive. `ExecutionStrategy` describes application-level HOW, Restate can supply durable control, and Core remains execution/cognition/evidence substrate.

### D12.4 — Current Backend→QA durable workflow is not one domain strategy

Current `createDurableBackendQaWorkflow(...)` selects Backend, QA and remediation stages. That is valid compatibility behavior for the delivered vertical, but it crosses organizational domain boundaries.

For the new organization model:

```text
Backend domain strategy
  -> Backend execution/output/evidence
  -> Backend completion/write gate
  -> Backend Claim / authorized downstream Obligation

QA domain strategy
  starts only after separate QA work is authorized/materialized/claimed
```

Selected migration: reuse Backend/QA worker, preparation, Core recovery and completion primitives; do **not** register the combined cross-domain stage dispatcher as `BACKEND.feature-delivery` strategy. Wrapping the current combined workflow in Restate would not solve the architectural bottleneck; it would only hide it below a durable runtime.

A domain strategy may orchestrate internal sub-agents/tools/verifiers, including a Restate multi-agent router, but those internal actors cannot acquire another organizational domain's write/Claim/Obligation authority. Cross-domain continuation must re-enter the organization boundary.

Strategy adoption is append-only: accepted candidate -> new immutable strategy descriptor -> new `ExecutionPolicy` revision/head. It does not mutate an existing descriptor/policy in place and affects new attempts only; existing `ExecutionAttemptBinding`s remain pinned.

---

### D13 — Product closure is immutable historical evidence, current DONE is derived

`ProductOutcomeClaim` binds exact projection subject/input digest and ProductHistoryHead. Later upstream supersession creates a new history head; old closure remains historical but becomes non-current. Current projection may become NOT_READY and materialize revalidation/remediation work.

This avoids assuming current Blackboard can mutate/supersede terminal `DONE` items. A terminal-reopen primitive, if desired instead, requires separate research/review.

---

### D14 — A.1 is not self-hosted

Research acceptance authorizes a **source implementation slice** consumed by the existing/human-authorized ExHarness delivery process. Current source does not prove a generic accepted-research→implementation auto-materialization primitive, and this candidate does not claim one. The new organizational materializer is not available yet and therefore cannot create the task that implements itself.

Only after A.1 code exists does the runtime acceptance fixture issue a `MATERIALIZATION_AUTHORIZATION_GRANT` for one BA-owned fixture obligation and exercise the new bridge.

```text
implementation authorization != runtime materialization authorization
```

---
## 5. Candidate artifact contracts

### 5.1 `ORGANIZATIONAL_INTEGRATION_IMPLEMENTATION v1`

```yaml
kind: ORGANIZATIONAL_INTEGRATION_IMPLEMENTATION
version: 1
projectId: <stable project id>
rootIntentId: <durable user-intent id>
researchItemId: <BB research item>
sourceRevision: <repo revision inspected>
policyRevision: <research/acceptance policy revision>

evidenceRefs:
  - <source/external evidence refs>

decisions:
  - key: <decision key>
    selected: <selected alternative>
    rejected: [<rejected alternatives>]
    rationaleRef: <evidence/tradeoff ref>

invariants:
  - Role != Pipeline
  - Organization != Workflow
  - Blackboard != Scheduler
  - Oracle != Coordinator
  - Core != Product Authority
  - Message != Authoritative Output
  - Research producer != acceptance authority
  - PM != Organization Scheduler
  - Artifact acceptance != blanket obligation authorization
  - OrganizationWorkMaterializer != Execution Resolver
  - Activation != Scheduling
  - Claim assertion payload is immutable
  - ProductStateProjection != Product Authority
  - Workload != Workflow
  - WorkContract != ExecutionPlan
  - ExecutionPolicy != Work Scheduler
  - ExecutionStrategy != Product / Write Authority
  - ExecutionStrategy != Cross-Domain Dispatcher
  - Execution strategy may evolve; work semantics may not silently evolve with it
  - ExecutionStrategy descriptor != runtime deployment identity
acceptance_model:
  - exact revision lineage is explicit and verifiable
  - dependency supersession deterministically marks affected downstream claims stale
  - crash/restart reconstructs the same project/work state from durable state + refs
  - no shared conversation is required for continuation or correctness
  - rejected work produces local bounded remediation rather than whole-organization restart
  - objective readiness is derived deterministically from authoritative current claims
  - ProductStateProjection can be deleted/rebuilt from complete pinned durable inputs with identical readiness output
  - phase benchmark declares bounded execution/time/cost budgets; no remediation or verification loop is unbounded

implementationSlices:
  - key: implement-integration-a1
    sourceChanges: [<exact source seams>]
    verification: [<executable contracts>]
    dependsOn: []

runtimeFixtureObligations:
  - key: fixture-ba-requirement-analysis
    fixtureId: integration-a1-runtime-fixture
    owningDomain: BA
    workloadType: requirement-analysis
    issuerDomain: <fixture root/application authority>
    obligationKind: REQUIREMENT_ANALYSIS_REQUIRED
    targetDomain: BA
    derivationRefs: [<fixture root/evidence/policy refs>]
    summary: <post-build runtime bridge verification work>
    dependsOn: []
    expectedArtifactKind: RequirementSet
    acceptanceRefs: [<fixture acceptance refs>]

unresolved:
  - key: <question key>
    blocksBefore: <integration slice>
    nonBlockingForFirstBridgeBecause: <explicit reason or null>

nonGoals:
  - generic RoleRegistry
  - global WorkflowGraph
  - central LLM manager
  - shared group-chat memory
  - Oracle dispatch authority
```

Validation requirements:

```text
project/root identity required
source/policy revision required
evidence refs non-empty
decision selected + rejected alternatives explicit
hard invariants present and unchanged
acceptance_model present with all required proof obligations
implementationSlices have unique keys + explicit sourceChanges/verification
runtime fixture obligation keys unique
owningDomain/workloadType/issuer/target/derivation explicit
fixture dependency keys exist and are acyclic
unresolved questions have an explicit blocking boundary
no lifecycle/completion authority fields
```

### 5.2 `MATERIALIZATION_AUTHORIZATION_GRANT / REVOCATION v1`

Artifact acceptance and obligation execution authorization are separate, and authorization is not permanently live.

```yaml
kind: MATERIALIZATION_AUTHORIZATION_GRANT
version: 1
authorizationId: <stable subject>
generation: <monotonic positive integer>
projectId: <project>
rootIntentId: <intent>
acceptedDecisionRef: <trusted accepted/promotion decision>
implementationArtifactRef: <exact candidate ref/digest/revision>
authorizedSliceIds: [integration-a1-runtime-fixture]
authorizedObligationKeys: [<exact obligation key>]
issuedByAuthorityRef: <authority>
authorityPolicyRevision: <pinned model/policy revision>
```

```yaml
kind: MATERIALIZATION_AUTHORIZATION_REVOCATION
version: 1
authorizationId: <same subject>
generation: <next generation>
revokesGrantRef: <exact prior active grant>
issuedByAuthorityRef: <authority>
authorityPolicyRevision: <pinned revision>
reasonRef: <durable reason>
```

Rules:

```text
issuedByAuthorityRef is derived from verified issuer context, never caller authority self-assertion
no implicit wildcard / authorize-all
immutable grant/revocation payloads
current status derived from exact authorization head/generation
candidate/decision/policy change invalidates stale grant use
materialize + claim + execution-entry revalidate active generation
revocation fences linked non-terminal work so it cannot start under stale authority
```

### 5.2.1 `EXECUTION_AUTHORITY_POLICY / HEAD v1`

```yaml
kind: EXECUTION_AUTHORITY_POLICY
version: 1
policyId: organization-execution-authority
generation: <monotonic positive integer>
projectId: <project>
status: ACTIVE | DISABLED
bindings:
  - principalRef: <trusted principal ref>
    authorizedDomains: [<domain>]
issuedByAuthorityRef: <trusted application/root authority>
```

Durable currentness:

```text
policyId -> { generation, status, policyRef }
CAS update requires expected generation
fresh process resolves same head
old immutable policy refs remain historical only
```

A claim controller must authorize against the current head, not merely a caller-supplied or previously cached policy ref.

### 5.2.2 `CLAIM_RELEASE_RECEIPT / HEAD v1`

```yaml
kind: CLAIM_RELEASE_RECEIPT
version: 1
projectId: <project>
rootIntentId: <root>
itemId: <board item>
claimGeneration: <exact current generation>
principalRef: <trusted principal>
boardOwner: <derived owner>
workContractRef: <exact>
materializationAuthorizationRef: <exact active grant>
materializationAuthorizationGeneration: <generation>
executionAuthorityPolicyRef: <exact current policy>
executionAuthorityPolicyGeneration: <generation>
```

The durable release head is keyed by the exact claim subject:

```text
claimReleaseSubjectKey = H(projectId, itemId, claimGeneration)
claimReleaseSubjectKey -> { status: RELEASED | FENCED, receiptRef }
```

`CLAIMED` without a current release-head receipt is non-executable. The receipt becomes usable only after fresh authority revalidation at execution entry.

### 5.3 `ORGANIZATION_WORK_CONTRACT v1`

```yaml
kind: ORGANIZATION_WORK_CONTRACT
version: 1
id: <content-addressed id>
projectId: <project>
rootIntentId: <intent>
researchDecisionRef: <accepted/promotion ref>
materializationAuthorizationId: <stable auth subject>
materializationAuthorizationRef: <exact active grant ref>
materializationAuthorizationGeneration: <generation>
implementationArtifactRef: <exact accepted candidate artifact ref>
obligationKey: <authorized key>
obligationSubjectKey: <deterministic logical obligation identity>
materializationKey: <deterministic exact grant-bound materialization identity>
boardItemId: <canonical derived/materialized item id>
owningDomain: <domain>
workloadType: <type>
summary: <bounded work>
requiredArtifactRefs: []
expectedArtifactKind: <kind>
acceptanceRefs: []
```

Authority restrictions:

```text
may bind exact project/item/domain/input/output/acceptance refs
may be consumed by discovery/context/claim authorization
may NOT mutate lifecycle, certify correctness, waive review, close objective, or resolve ExecutionPolicy/ExecutionStrategy
```

Exactly-once logical work rules:

```text
obligationSubjectKey = H(projectId, rootIntentId, implementationArtifactRef, obligationKey)
materializationKey   = H(obligationSubjectKey, acceptedDecisionRef, materializationAuthorizationRef)
same materializationKey -> same Board item + commit receipt
at most one live item per obligationSubjectKey
caller cannot choose a second arbitrary id for the same subject
```

## 6. Acceptance authority for this candidate

This artifact can be submitted through the existing research continuation boundary as:

```text
decisionStatus = PROPOSED
resultRef = exact candidate artifact ref
reviewRequirement = research-workflow / organizational-integration-readiness
Board = PENDING_REVIEW
```

An independent reviewer/evaluator must assess the exact candidate against Section 12.

This reuse of the existing review lifecycle does **not** assume that any configured `research-workflow` reviewer is automatically sufficient for a phase-shaping architecture artifact. The inspected source proves the review lifecycle, not that the configured reviewer scope is sufficient at organization-authority/contract scale, so review adequacy must be checked explicitly.

The reviewer/evaluator authority used for BB-046 must cover at least:

```text
organizational authority model
Blackboard/application boundary
artifact/provenance contract
first-bridge source seams
hard invariants
known unresolved blocking matrix
```

If the configured reviewer is scoped only to a narrow research finding, its PASS cannot authorize this candidate. The review requirement must be widened or supplemented by an appropriate architecture/application authority review. Reuse the lifecycle; do not rubber-stamp the scope.

A successful adequate review may authorize **delivery of `implementationSlices[implement-integration-a1]` through the existing project-delivery lifecycle**. It does not require or invoke the new materializer.

After A.1 exists, the bridge acceptance fixture separately obtains an explicit runtime materialization scope:

```yaml
kind: MATERIALIZATION_AUTHORIZATION_GRANT
authorizationId: <stable subject>
generation: 1
acceptedDecisionRef: <exact accepted decision>
implementationArtifactRef: <exact artifact ref/digest/revision>
authorizedSliceIds: [integration-a1-runtime-fixture]
authorizedObligationKeys: [<exact keys>]
issuedByAuthorityRef: <authority ref>
authorityPolicyRevision: <pinned policy/model revision>
```

There is no implicit wildcard/all-obligations meaning in v1. `OrganizationWorkMaterializer` may execute only when the requested obligation key is present in this exact scope and the scope is fresh for the accepted candidate.

Adequacy is **not reviewer self-attestation**. Before review dispatch, the BB-046 review requirement must declare the required scope keys and bind the exact candidate ref/digest/revision plus expected reviewer/evaluator identity. The application can machine-check those fields and freshness. Whether the configured reviewer/evaluator is organizationally authorized for the declared scope keys remains project-authority configuration; if current configuration cannot carry that scope metadata, add a separate architecture/application review requirement. A reviewer cannot satisfy adequacy by merely asserting "I am qualified" inside the verdict.

The candidate artifact itself is never the acceptance authority.

---

## 7. First implementation slice after acceptance

Name: **Research-to-role-work bridge**.

Bootstrap is explicit:

```text
BB-046 accepted for source slice `implement-integration-a1`
  -> explicit existing/human-authorized implementation handoff implements A.1
  -> A.1 code exists
  -> post-build runtime fixture creates exact fixture obligation + ACTIVE runtime grant
  -> materializer -> Board work -> trusted-principal claim
```

The component under construction never creates its own implementation task.

### Required source changes

#### New — `packages/agentic-system/src/organizational-integration-artifact.js`

```text
defineOrganizationalIntegrationImplementation(...)
defineMaterializationAuthorization(...)
defineExecutionAuthorityPolicy(...)
defineClaimReleaseReceipt(...)
defineClaimAuthorityInvalidation(...)
defineOrganizationWorkContract(...)
validate obligation dependency graph
validate unresolved blocking metadata
validate exact hard-invariant set
validate CLAIM_AUTHORITY_INVALIDATION exact claim/head bindings
```

#### New — `packages/agentic-system/src/organizational-integration-store.js`

Content-addressed/ref-only store for immutable organizational artifacts used by A.1: candidate implementation artifact, materialization grant/revocation, execution-authority policy, claim-release receipt, claim-authority invalidation and organization work contract. Storage gains no lifecycle/currentness/acceptance authority; currentness lives only in the explicit head stores.

#### New — `packages/agentic-system/src/organization-authorization-store.js`

Durable CAS-fenced application-local currentness indexes for immutable authority artifacts:

```text
materialization authorization:
  resolveAuthorizationHead(authorizationId)
  compareAndSetAuthorizationHead(authorizationId, expectedGeneration, nextHead)
  authorizationId -> { generation, status, grantOrRevocationRef }

execution authority policy:
  resolveExecutionAuthorityPolicyHead(policyId)
  compareAndSetExecutionAuthorityPolicyHead(policyId, expectedGeneration, nextHead)
  policyId -> { generation, status, policyRef }

expected generation required for every head update
fresh instance reconstructs the same heads
```

The head indexes are authority-currentness state; immutable grant/revocation/policy payloads remain content-addressed artifacts. This is a narrow application store, not a generic IAM database.

#### New — `packages/agentic-system/src/organization-authorization.js`

Concrete first-bridge authority adapter. It reuses the same architectural pattern as current `reviewTrust.verify*Authority`: authority is checked by an injected application trust boundary, not inferred from payload prose/ids.

```text
trusted organizationAuthority adapter/context
  verifyMaterializationAuthorizationIssuer(...)
  verifyExecutionAuthorityPolicyPublisher(...)
  derive canonical issuedByAuthorityRef from verified principal/context
trusted ExecutionPrincipal provider/context
durable EXECUTION_AUTHORITY_POLICY head/model + revoke-sensitive lookup
durable MATERIALIZATION_AUTHORIZATION CAS head resolution
immutable CLAIM_RELEASE_RECEIPT construction + release-head publication
precheck/post-release freshness handshake + stale-generation fencing
```

No caller-provided domain string grants authority. No caller-provided `issuedByAuthorityRef` grants issuer/publisher authority either.

#### New — `packages/agentic-system/src/organization-claim-release-store.js`

Durable CAS state for crossing Board lifecycle ownership into executable capability:

```text
claimReleaseSubjectKey(projectId, itemId, claimGeneration)
  -> { status: RELEASED | FENCED, receiptRef }

resolveClaimReleaseHead(subjectKey)
compareAndSetClaimReleaseHead(subjectKey, expectedState, nextState)

first release: ABSENT -> RELEASED(exact receiptRef)
identical replay: return same receipt/head
conflicting receipt for same subject: fail closed
fence: RELEASED(exact receiptRef) -> FENCED(exact receiptRef, reasonRef)
```

Receipt payloads remain immutable/content-addressed in the organizational artifact store. `ClaimReleaseHead` is capability currentness only; it does not release or block Blackboard ownership. On authority invalidation, the Board lifecycle transition commits first, then this head is fenced idempotently. A later ordinary claim uses a new `claimGeneration` and therefore a new release subject.

#### New — `packages/agentic-system/src/organization-work-materializer.js`

Deterministic adapter from one explicitly authorized obligation to one immutable work contract + canonical Board work request.

```text
resolve exact candidate + accepted decision + ACTIVE authorization grant/generation
verify key/slice scope
compute obligationSubjectKey + materializationKey
copy exact owningDomain/workloadType/dependencies/output/acceptance semantics
persist content-addressed ORGANIZATION_WORK_CONTRACT
delegate canonical creation to materializeAcceptedWork(...)
```

No PM proposal dependency, model call, next-role selection or execution-policy/strategy resolution.

#### Change — `packages/agentic-system/src/application-orchestrator-base.js`

Add one narrow mutation primitive, not a scheduler:

```text
materializeAcceptedWork({
  acceptedDecisionRef,
  materializationAuthorizationRef,
  materializationAuthorizationGeneration,
  implementationArtifactRef,
  obligationKey,
  obligationSubjectKey,
  materializationKey,
  workContractRef
})
```

Transaction requirements:

```text
revalidate exact project/root + current ACTIVE authorization generation
verify accepted decision/artifact/scope
validate deterministic identity keys
at most one live item per obligationSubjectKey
same materializationKey replay returns same item/commit receipt
conflicting replay fails closed
derive/validate canonical item identity; caller cannot choose arbitrary duplicate id
attach workContract/auth/provenance atomically
```

Also add one narrow **canonical organization-claim invalidation** mutation, distinct from generic `recoverClaim(...)`:

```text
invalidateOrganizationClaim({
  itemId,
  expectedOwner,
  expectedClaimGeneration,
  invalidationRef,
  invalidationKind
})
```

Transaction requirements:

```text
require exact current CLAIMED { owner, claimGeneration }
require immutable validated CLAIM_AUTHORITY_INVALIDATION ref

EXECUTION_AUTHORITY_INVALIDATED
ABANDONED_PROVISIONAL_CLAIM
  -> attach invalidationRef
  -> owner = null
  -> status = REOPENED

WORK_AUTHORIZATION_INVALIDATED
  -> attach invalidationRef
  -> owner = null
  -> status = BLOCKED
  -> add exact authorization-invalidated blocker/ref

same invalidationRef replay -> idempotent committed result
stale/conflicting expected tuple -> fail closed
```

This Blackboard transaction is the **canonical lifecycle consequence** of authority invalidation. It commits before any `ClaimReleaseHead` fencing. The release-head fence is capability cleanup/currentness only, not lifecycle authority. Generic `recoverClaim(...)` is not used as a revocation alias.

#### New — `packages/agentic-system/src/organization-work-selection.js`

Read-only domain discovery:

```text
SessionHandoffSurface.read()
  -> lifecycle.eligibleWork
  -> item-scoped artifact refs
  -> resolve exact ORGANIZATION_WORK_CONTRACT
  -> validate project/root/item binding
  -> filter owningDomain
  -> candidates
```

No claim and no Board mutation.

#### New — `packages/agentic-system/src/organization-work-claim.js`

Application authorization gate:

```text
claimForPrincipal({ itemId, executionPrincipalContext })
  -> derive trusted ExecutionPrincipal (or accept only framework-authenticated context)
  -> resolve CURRENT ExecutionAuthorityPolicyHead(policyId)
  -> derive authorizedDomains(principal) from exact current policyRef/generation
  -> precheck current ACTIVE materialization-auth head
  -> re-read current Board + exact work contract
  -> require workContract.owningDomain in principal authorizedDomains
  -> derive Board owner/execution identity from trusted principal
  -> delegate ApplicationOrchestrator.claim(...) as provisional claim generation N
  -> re-read Board claim + both authority heads
       drift/revoked ->
         create immutable CLAIM_AUTHORITY_INVALIDATION
         commit ApplicationOrchestrator.invalidateOrganizationClaim(...) first
         idempotently fence ClaimReleaseHead(itemId,N) if one exists
         fail closed
  -> build immutable CLAIM_RELEASE_RECEIPT bound to itemId/N/principal/work/auth/policy heads
  -> CAS publish ClaimReleaseHead(itemId,N) -> exact receiptRef
  -> final re-read Board claim + both authority heads
       unchanged -> return durable releasedClaimReceiptRef
       drift/revoked ->
         create immutable CLAIM_AUTHORITY_INVALIDATION
         commit Board lifecycle invalidation first
         idempotently fence ClaimReleaseHead(itemId,N)
         fail closed
```

`requestedDomain` is not an authority parameter. A non-BA principal cannot claim BA work by spoofing the string. For organization-managed claims, the Board owner is the canonical durable principal identity (or a durable reversible mapping), so a fresh process can recover the principal from Board state.

The same module exposes explicit fresh-process reconciliation:

```text
reconcileOrganizationClaimAuthority({ itemId })
  -> read exact current Board item
  -> if not CLAIMED: no organization-claim reconciliation needed
  -> resolve canonical principal from durable Board owner
  -> resolve exact work contract + current materialization-auth head + current execution-authority-policy head
  -> resolve ClaimReleaseHead(itemId, claimGeneration)

  no release head + authority still valid
    -> deterministically finish release for SAME claimGeneration
    -> publish/reuse exact CLAIM_RELEASE_RECEIPT

  no release head + authority invalid
    -> create/reuse CLAIM_AUTHORITY_INVALIDATION
    -> invalidateOrganizationClaim(...)

  RELEASED head + authority still valid
    -> return/reconstruct exact usable receipt

  RELEASED/FENCED head + authority invalid or inconsistent
    -> commit/reconcile canonical Board invalidation first
    -> fence/verify historical release head idempotently
```

Canonical lifecycle mutation remains in `ApplicationOrchestrator.claim(...)` / `invalidateOrganizationClaim(...)`. The claim-release store is a distinct durable capability boundary: `CLAIMED` alone is never executable. Execution entry must revalidate Board `{owner, claimGeneration}`, direct current release head, materialization authorization head and execution-authority policy head before creating or recovering any `ExecutionAttemptBinding`.

#### Later owning-domain execution boundary — required before Integration B execution

A.1 stops at claim. Current source still assigns Worker execution selection to Orchestrator, so Integration B requires an accepted `DOMAIN_EXECUTION_CONTROL` migration.

After a **released** claim:

```text
OwningDomainController (single released claim only)
  -> resolve/create durable semantic ExecutionAttemptHead for this work
       ACTIVE/RECOVERY_REQUIRED -> reuse same executionAttemptId
       new attempt only after exact remediation/lifecycle authorization
  -> read exact domain execution-policy head
  -> resolve immutable ExecutionPolicy for (domain, workloadType, WorkContract version)
  -> resolve immutable ExecutionStrategyDescriptor
  -> validate workload/work-contract compatibility
  -> obtain exact runtime binding before side effects
  -> persist ExecutionAttemptBinding
       executionAttemptId
       workContractRef
       releasedClaimReceiptRef
       executionPolicyRef
       executionStrategyRef
       strategyKind / strategyId / strategyVersion
       runtimeBindingRef / runtimeCodeIdentity
       contextPolicyRef
       toolset/model/harness refs where applicable
  -> invoke strategy with executionAttemptId as attempt identity/idempotency subject
  -> persist runtimeInvocationId + ExecutionAttemptOutcome/provenance
  -> ordinary domain completion / verifier / Claim publication gate
```

The controller cannot scan/rank the Blackboard, claim unrelated work, change owning domain, modify work semantics, or bypass write/obligation authority. Strategy output is execution evidence/output only; product authority remains outside the strategy.

`ORGANIZATION_WORK_CONTRACT` carries no `ExecutionPolicyRef`, `ExecutionStrategyRef` or runtime target; it defines WHAT, not HOW. A pipeline/workflow may be used *inside* a strategy adapter but is not part of organizational work semantics.

Recovery/takeover of the same semantic execution attempt must use the same `ExecutionAttemptHead`, `executionAttemptId` and binding even when Board `claimGeneration` changes for writer fencing. A new remediation attempt receives a new `executionAttemptId` only after an explicit durable remediation/lifecycle transition advances the attempt head, and may then resolve a newer accepted policy. A policy/strategy promotion applies to new attempts only unless a separately authorized migration explicitly says otherwise.

Execution provenance must begin in Integration B; Integration I aggregates it later rather than inventing it retroactively.

Minimum Integration-B execution-control tests:

```text
- policy sees only one released claim/work contract; cannot select another Board item
- incompatible strategy/work-contract version fails closed
- policy-head change before binding commit invalidates/restarts resolution; no stale binding is released
- policy-head change after binding commit does not rewrite the in-flight attempt
- same executionAttemptId recovery reloads byte-equivalent binding
- new remediation attempt gets a new executionAttemptId and may use a newer policy
- strategy promotion does not stale already accepted product artifacts merely because HOW changed
- strategy output cannot publish authoritative Claim without ordinary domain completion/write gates
- human-assisted strategy cannot bypass the same gates
- a Backend strategy cannot directly dispatch QA organizational work; cross-domain continuation requires authorized Obligation/materialization/claim
- Restate Workflow adapter never uses stable workId as the once-per-workflow identity when remediation can create multiple attempts
- Restate adapter records runtime invocation/deployment identity and proves it matches the binding before outcome is accepted
```

#### No change in first bridge slice

```text
packages/core-harness/*
Oracle generic boundary
blackboard-orchestrator generic item schema
research-continuation lifecycle
ProductStateProjection
QA/deployment revision freeze
```

---

## 8. Deterministic materialization + authorization/replay contract

Preconditions:

```text
trusted accepted decision binds exact candidate
ACTIVE authorization grant binds exact decision + candidate + project/root + slice/key + policy revision + generation
caller supplies exact obligationKey but request is not authority
obligation unchanged in candidate
identity keys recompute exactly
```

Ordering:

```text
precheck current authorization head/generation with revoke-sensitive consistency
 -> compute obligationSubjectKey + materializationKey
 -> derive/persist immutable work contract
 -> materializeAcceptedWork Board transaction
      uses exact prechecked head as expected fence metadata
      enforces logical uniqueness
      returns PROVISIONAL Board commit receipt
 -> post-commit re-read authorization head
      same ACTIVE generation -> release usable receipt
      drift/revoked -> fence/supersede just-created work + fail closed
```

Failure/race semantics:

```text
contract put then crash -> orphan, no authority
concurrent identical retry -> same materializationKey -> same Board item/receipt
conflicting same obligation subject -> fail closed
revoke before claim -> claim gate rejects inactive authorization; no lifecycle ownership is created
claim uses precheck auth+principal-policy heads -> provisional Board claim -> post-commit recheck
head drift during that handshake -> commit exact `invalidateOrganizationClaim(...)`; no usable claim receipt
revoke after released claim before execution -> execution-entry refuses stale authority, commits Board invalidation first, then fences historical release head
```

Content-addressed payload identity is necessary but **not sufficient** for exactly-once logical organizational work.

## 9. Bootstrap and relationship to Integration B

```text
A.1 delivery plane
  accepted implementation slice -> existing delivery lifecycle -> bridge code

A.1 system-under-test plane
  bridge fixture -> exact runtime grant -> BA-owned READY/claimable fixture work

Integration B real product plane
  RootIntent + ROOT_OUTCOME_SET -> PM ProductObjective/ScopeDecision
  -> BA requirement-analysis workload -> RequirementSet
```

The bridge fixture is not the product vertical and its runtime authorization is not the implementation authorization that built the bridge.

---

## 10. Explicit unresolved mechanism matrix

| Gap | First bridge status | Why non-blocking for first bridge | Becomes blocking before | Required next research/output |
| --- | --- | --- | --- | --- |
| Domain wake-up trigger | OPEN | A.1 explicit/pull only. | Integration D | `DOMAIN_ACTIVATION`; Activation != Scheduling. |
| Domain execution-control ownership | OPEN | A.1 stops after claim. Current source assigns Worker selection to Orchestrator. | **Integration B** | `DOMAIN_EXECUTION_CONTROL`: Orchestrator lifecycle only; owning-domain controller owns durable semantic `ExecutionAttemptHead`, resolves `ExecutionPolicy -> ExecutionStrategyRef -> ExecutionAttemptBinding`, proves exact runtime binding, and emits durable provenance. Restart/takeover reuses the same active attempt; only explicit remediation/lifecycle authority may advance attempt generation. |
| Domain write-scope authority | OPEN | A.1 performs no role work. | B exit / reusable before C | enforced PM/BA writers; then reusable policy. |
| Cross-domain obligation issuance authority | OPEN | A.1 consumes one pre-authorized obligation. | C | allowed obligation kinds/targets/derivation refs. |
| Root intent / scope authority | OPEN | A.1 does not exercise PM product scope. | B | ROOT_OUTCOME_SET coverage; no B-v1 policy-exception bypass. |
| Dependency/Claim lineage + transitive invalidation | OPEN | no downstream product graph. | C | immutable exact refs + stale propagation/CAS/recovery. |
| Product-history completeness/projection subject | OPEN | no projection in A.1. | G | canonical history/head or equivalent completeness proof; projection derives current set. |
| Remediation timeout/escalation + human decision | OPEN | no loop. | F exit / H | bounded budget + BLOCKED + HUMAN_DECISION_REQUIRED. |
| QA exact revision freeze | OPEN | no QA/deploy. | F | AcceptanceSnapshot + observed runtime identity. |
| PM waiver vs override | OPEN | no closure. | G | separate waiver authority; waiver != root amendment. |
| Post-closure invalidation/currentness | OPEN | no closure. Current `supersede(DONE)` is not available as generic mechanism. | G/H | snapshot-relative ProductOutcomeClaim + new head/current projection + revalidation work, or separately reviewed terminal reopen. |
| Execution-strategy/policy drift during self-improvement | OPEN | no post-claim execution or upgrade. | J | fixed-work-semantics compatibility + immutable strategy refs + replay/eval; promotion changes HOW for new attempts only. |

Six mechanisms are **no longer allowed to remain unresolved inside A.1 itself**: trusted principal/domain authority, durable execution-authority-policy currentness, authorization grant/revocation freshness, deterministic materialization identity, durable claim-release capability/reconstruction, and canonical authority-revocation -> Blackboard lifecycle invalidation.

### Claim authority is not write-scope authority

The first bridge solves only the entry gate:

```text
may this domain claim this work item?
```

It does not yet establish the execution-time writer gate:

```text
after a valid claim, which artifact kinds or mutations may this domain publish?
```

Integration B may use concrete PM and BA producer APIs/stores instead of a generic policy, but this **must be enforced and negatively tested**, not documented as convention: PM cannot publish `RequirementSet`; BA cannot publish `ProductObjective`/`ScopeDecision`; producer identity binds authoritative artifacts/claims; forbidden cross-domain writes fail closed. Those tests are an Integration B exit condition.

Before Integration C introduces SA as another independent writer, reusable cross-domain authority must cover **both product writes and obligation issuance**:

```text
canPublishArtifactKinds
canPublishClaimKinds
canIssueObligationKinds
allowedTargetDomains
requiredDerivationRefs
forbiddenMutations
```

The receiving/materialization gate must verify that an emitted obligation is allowed for its issuer/domain/kind/target and is grounded in the required current claim/evidence/policy refs. Creating an arbitrary obligation for another domain is dispatch authority and must fail closed.

---

## 11. Product-state, completeness and post-closure currentness

Later product composition must not ask a caller to nominate “current” refs.

```text
canonical append-only product history / equivalent durable fact ledger
  -> ProductHistoryHead { generation, digest }
  -> derive complete active Claims + Obligations + lineage at that head

ProductStateProjectionInput
  = ProductHistoryHead ref/generation/digest
  + exact RootIntent/RootOutcomeSet/ProductObjective refs
  + acceptance-policy revision
  + applicable waiver refs
```

`ProductStateProjection` is deterministic/read-only and rebuildable. Caller-selected `currentClaimRefs[]` / `currentObligationRefs[]` are rejected as a completeness model.

`ProductOutcomeClaim` binds exact projection subject/input digest + history head. A later upstream supersession creates a new head; old ProductOutcomeClaim remains immutable historical evidence but is non-current if its dependencies are no longer current. The new projection may become NOT_READY and create bounded revalidation/remediation work.

This matters because current inspected Blackboard source rejects `supersede(...)` from `DONE`; therefore the architecture must not casually assume terminal mutation exists. First implementation direction for G/H is historical closure + derived current readiness. A generic terminal-DONE reopen primitive is an alternative requiring separate research/acceptance.

## 12. Independent review checklist

A reviewer should reject this candidate if any of these cannot be answered from the artifact + evidence refs:

```text
1. Who is allowed to authorize implementation?
2. What exact source boundary changes in the first bridge slice?
3. Why are domain fields not added to Blackboard yet?
4. What authority enforcement replaces self-reported owningDomain?
5. How is ORGANIZATION_WORK_CONTRACT governed and updated?
6. How is the bridge different from the PM+BA product vertical?
7. Why is global BSP rejected and where are local barriers still allowed?
8. Which known gaps remain open, and exactly when does each become blocking?
9. Are all hard invariants preserved by the proposed source seams?
10. Is claim authorization clearly separated from domain write-scope authorization?
11. Does the configured reviewer/evaluator actually have authority and scope for this architecture-level decision rather than only a narrow research finding?
12. Does the candidate preserve the full acceptance_model: exact revision lineage, deterministic stale propagation, crash/restart reconstruction, no shared conversation dependency, local bounded remediation, deterministic objective readiness and rebuildable/non-authoritative ProductStateProjection?
13. Can a fresh implementation session derive tests without reconstructing these decisions from chat history?
14. Is PM clearly prevented from becoming an organization scheduler through materialization?
15. Is RootIntent protected from ordinary PM scope weakening/closure substitution?
16. Is work-contract publication crash-safe under write-before-ref semantics?
17. Is dependency invalidation explicitly blocked before the first slice that uses it (Integration C)?
18. Is ProductStateProjection explicitly non-authoritative and rebuildable from complete pinned policy/root/waiver/claim inputs?
19. Does acceptance bind an exact materialization scope rather than implicitly authorizing every obligation?
20. Is ExecutionPolicy/ExecutionStrategy resolution absent from materialization and deferred to the owning domain after a released claim?
21. Are claim assertion payloads immutable after publication?
22. Is cross-domain obligation issuance explicitly governed before Integration C?
23. Does `ROOT_INTENT_SCOPE_AUTHORITY` reduce PM weakening detection to mandatory-id coverage plus authorized exceptions rather than PM semantic self-report?
24. Does Product QA require observed runtime identity evidence bound to the exact `AcceptanceSnapshot`?
25. Are remediation/verification time and cost budgets explicit before unattended E2E?

26. Does claim authority derive from a trusted ExecutionPrincipal + pinned authority policy rather than caller `requestedDomain`?
27. Does materialization authorization bind decision/candidate/policy generation and have explicit revoke/supersede freshness semantics?
28. Does identical concurrent materialization converge on one logical Board work identity/commit receipt?
29. Is post-claim execution selection explicitly migrated away from current Orchestrator ownership before Integration B execution?
30. Does DOMAIN_EXECUTION_CONTROL pin an immutable ExecutionAttemptBinding before execution?
31. Is ExecutionAuthorityPolicy currentness a durable CAS-fenced head rather than ambient config?
32. Is Board CLAIMED explicitly non-executable until an exact durable CLAIM_RELEASE_RECEIPT is released/revalidated?
33. Does execution-attempt ownership prevent restart/takeover from minting a new semantic attempt?
34. Can a strategy/policy revision change without changing WorkContract/acceptance semantics?
35. For a Restate adapter, is exact strategy runtime identity addressable/verified before start rather than inferred from "latest" after execution?
36. Does a Restate workflow use executionAttemptId rather than stable workId for once-per-ID semantics?
37. Is execution provenance mandatory from Integration B onward rather than deferred to Integration I?
38. Does authority revocation have one canonical Blackboard lifecycle transition, with Board invalidation committed before ClaimReleaseHead fencing?
39. Can a fresh process reconcile a provisional/released invalid claim without treating generic `recoverClaim(...)` as revocation?
40. Is organization-managed Board owner identity durable/canonical enough to recover the principal after a crash before claim-release publication?
41. Does ProductStateProjection derive completeness from a canonical ProductHistoryHead rather than arbitrary caller-selected current refs?
42. Is post-closure invalidation defined without mutating historical ProductOutcomeClaim or assuming an unavailable `supersede(DONE)` primitive?
```

Passing this review would authorize **the first bridge slice only**. It would not authorize the full A→J integration roadmap as already implementation-ready. A lifecycle-valid but scope-inadequate/rubber-stamp review must not be treated as sufficient acceptance evidence.

---

## 13. Verification contract for the first bridge slice

Required executable scenarios after independent acceptance:

```text
bootstrap separation
- accepted BB-046 source slice can be delivered without OrganizationWorkMaterializer existing
- bridge component never creates its own implementation task
- research acceptance alone does not authorize runtime organization work
- runtime fixture grant is issued/used only after A.1 code exists

artifact / authorization validation
- unreviewed runtime fixture cannot materialize
- forged/self-asserted issuedByAuthorityRef cannot issue a materialization grant or publish an execution-authority policy
- worker/BA execution principal cannot advance authorization/policy heads unless separately trusted as the configured authority publisher
- grant binds exact acceptedDecisionRef + candidate + project/root + slice/key + authorityPolicyRevision + generation
- wildcard/implicit-all rejected
- revoked/superseded grant rejected

trusted principal authorization
- BA principal can claim BA item
- non-BA principal sending requestedDomain=BA still fails closed
- principal/domain membership revoked in current execution-authority policy makes claim fail even if an older policy allowed it
- current execution-authority policy head survives fresh-process reconstruction with exact policyId/generation/policyRef/status
- old policy ref is rejected after head advances, even if that old policy allowed the principal
- concurrent policy-head update uses CAS; stale publisher cannot overwrite current head
- current execution-authority policy/model revision is recorded in claim/release provenance
- Board owner identity is derived from trusted principal/execution context

exactly-once logical materialization
- deterministic obligationSubjectKey/materializationKey recompute exactly
- two concurrent identical materializations -> one Board item + same commit receipt
- same obligationSubjectKey with conflicting contract/grant -> fail closed
- caller cannot create second item by supplying another id

claim-release durability
- Board CLAIMED with no ClaimReleaseHead is non-executable
- crash after Board claim but before release-head commit reconstructs a provisional/non-executable claim
- fresh reconciliation derives the canonical principal from durable Board owner; if authority is still valid it completes the SAME claim-generation release rather than minting a new claim
- crash after release-head commit reconstructs the same immutable CLAIM_RELEASE_RECEIPT
- duplicate release for the same itemId/claimGeneration returns the same receipt/head
- conflicting receipt for the same release subject fails closed
- ClaimReleaseHead.FENCED alone never counts as Blackboard lifecycle release

canonical authority invalidation
- EXECUTION_AUTHORITY_INVALIDATED on exact CLAIMED tuple -> Board REOPENED, owner cleared, invalidationRef atomically linked
- ABANDONED_PROVISIONAL_CLAIM -> Board REOPENED, owner cleared
- WORK_AUTHORIZATION_INVALIDATED -> Board BLOCKED, owner cleared, exact blocker/invalidationRef linked
- invalidation does not use generic recoverClaim as a revocation alias
- identical invalidation replay is idempotent
- stale/conflicting expected owner/generation fails closed
- after REOPENED invalidation, next authorized ordinary claim advances to a new claimGeneration

revoke / race
- authorization-head store survives fresh-process reconstruction with same current generation
- grant revoked after materialization before claim -> item non-claimable
- revoke/policy change between precheck and Board claim commit -> exact claim is invalidated through canonical Board transition
- revoke between materialization precheck and Board commit -> post-commit check invalidates provisional work deterministically
- revoke/policy-head change after release before execution -> execution-entry refuses stale receipt, commits Board invalidation first, then fences old release head
- crash after Board invalidation before release-head fence -> Board is already non-executable; fresh process fences old head idempotently
- crash before Board invalidation -> fresh `reconcileOrganizationClaimAuthority(...)` revalidates the exact current claim; valid authority completes/reuses release, invalid authority retries exact invalidation
- concurrent generic recover/takeover vs invalidation: one exact Board transaction wins; stale loser fails closed and must re-resolve current tuple/authority
- concurrent new claimant cannot claim until invalidation commits REOPENED; once it does, new claim gets a later generation and old release receipt cannot match
- policy re-authorizes principal after invalidation was triggered -> old claim is not resurrected; a new claim/release against current heads is required

publication / recovery
- contract put then crash -> orphan only; no eligible work
- retry converges on same logical Board work
- failed Board transaction exposes no partial item/ref
- fresh process reconstructs exact work/auth generation/principal-independent durable state

domain / execution boundary
- discovery filters by owningDomain but does not authenticate caller
- claim controller authenticates/authorizes principal
- materializer/work contract has no ExecutionPolicy, ExecutionStrategy or runtime-binding API/path
- A.1 stops after claim; Integration B cannot execute until DOMAIN_EXECUTION_CONTROL is accepted

conversation independence
- no shared chat is required for any reconstruction above
```

Passing only happy-path `BA sees work -> claim succeeds` is insufficient.

## 14. Architecture viability tripwire carried into later slices

Accepting this candidate does not make the blackboard/obligation model unfalsifiable. Integration D/E benchmark plans must freeze a bounded evaluation budget and tripwire thresholds before execution. Evidence must trigger `ARCHITECTURE_REASSESSMENT_REQUIRED` if the organization repeatedly shows patterns such as:

```text
healthy domains stuck in mutual obligations with no progress
progress requires a central actor to choose the next domain
local changes repeatedly invalidate unrelated work / approximate whole-stage reset
whole-organization barriers are repeatedly required for ordinary progress
materializer, PM or activation layer invents routing absent from accepted obligations/authorization
ProductStateProjection cannot be deterministically rebuilt from durable history
```

A fired tripwire pauses further architecture promotion and creates an explicit reassessment research obligation. It does not silently weaken the hard invariants or automatically select a replacement architecture.

---

## 15. Terminal semantics for BB-046

Current state of this file:

```text
candidate artifact exists
+ evidence trail exists
+ tradeoffs/rejected alternatives are explicit
+ hard invariants are explicit, including PM != Organization Scheduler and ProductStateProjection != Product Authority
+ first bridge scope is explicit
+ post-claim execution is rebased to WorkloadType -> ExecutionPolicy -> ExecutionStrategy -> ExecutionAttemptBinding
+ Restate is constrained to a replaceable execution runtime below organization authority
+ twelve downstream gaps are explicit
+ review-scope adequacy is an explicit acceptance condition
----------------------------------------
PROPOSED / AWAITING INDEPENDENT REVIEW
```

BB-046 should become terminal only after the existing independent review/decision path accepts the exact artifact according to project policy.

The research producer must not write its own terminal `IMPLEMENTATION_READY` status.
