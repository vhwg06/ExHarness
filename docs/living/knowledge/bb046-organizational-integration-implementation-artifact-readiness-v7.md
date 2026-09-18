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