# BB-046 Research Loop — Rebase post-claim execution around ExecutionPolicy / ExecutionStrategy

Date: 2026-09-18

Status: **RESEARCH RESULT — feeds candidate v6; does not authorize implementation**

Source baseline inspected: `vhwg06/ExHarness@ad36638dd7041a60c224dfe3c9beb252069ecdae`

## 1. Question

Can the Integration Phase remove `Pipeline` / `Workflow` as an organizational primitive and instead place them below the trust/organization boundary as replaceable domain-local execution mechanics, while preserving:

- exact work semantics and acceptance authority;
- current A.1 trust/claim boundaries;
- durable recovery;
- observability sufficient for later self-improvement;
- no hidden central scheduler;
- no goalpost manipulation when execution mechanics evolve?

The concrete pressure is the v4 gap `DOMAIN_EXECUTION_CONTROL`: after a domain has a released authorized claim, who owns HOW execution is performed without expanding `ApplicationOrchestrator` into a super-orchestrator?

## 2. Candidate hypothesis

```text
Role Domain
  -> Workload Type
  -> ExecutionPolicy
  -> ExecutionStrategy
       -> Restate handler/workflow
       -> application/Core loop
       -> human-assisted execution
```

With a hard boundary:

```text
TRUST / ORGANIZATION
ExecutionPrincipal
 -> Execution Authority
 -> WorkContract
 -> released claim
===============================
DOMAIN-LOCAL EXECUTION
DomainExecutionController
 -> ExecutionPolicy
 -> ExecutionStrategyRef
 -> ExecutionAttemptBinding
 -> execute/recover
===============================
PRODUCT / AUTHORITY
completion / verifier / write gate / Claim
```

Hypothesis: this resolves the conceptual bottleneck of post-claim execution ownership while leaving A.1 authorization/materialization concerns independent.

## 3. Source inspection — current ExHarness pressure

### 3.1 Worker selection is still application/Orchestrator-owned

Current `docs/worktree/agentic-application/boundaries.md` assigns:

```text
Work decomposition          -> Orchestrator; PM/Advisor may propose
Which Worker executes       -> Orchestrator
Application workflow state  -> Orchestrator
```

Therefore role-local execution control is a real migration, not a capability already delivered.

### 3.2 Current durable Backend→QA composition crosses organizational domains

`packages/agentic-system/src/durable-backend-qa.js` persists and selects stages including:

```text
BACKEND_PENDING
QA_PENDING
BACKEND_REMEDIATION_PENDING
```

The existing composition is valid for the current concrete Backend→QA vertical, but it cannot be lifted unchanged as one Backend-domain `ExecutionStrategy`. Doing so would preserve cross-domain dispatch below the new abstraction.

Safe reuse boundary:

```text
REUSE
  Backend objective/context preparation
  BackendWorker
  Core effect/session recovery
  Backend completion/evidence semantics
  QA worker/verifier/completion primitives inside QA-owned execution

DO NOT REUSE AS ONE DOMAIN STRATEGY
  Backend→QA stage dispatcher
  cross-domain remediation routing
  combined vertical workflow as organizational control
```

### 3.3 Existing self-upgrade boundary already supports HOW evolution

D016 / BB-034 / current self-upgrade pilot already separate:

```text
accepted baseline
candidate
fixed evaluator/scenarios/budget
adoptionAuthority: false
```

That is compatible with evolving an execution strategy while freezing work semantics and acceptance authority.

## 4. External research — Restate

Sources reviewed:

- Restate Services: https://docs.restate.dev/concepts/services/
- Restate service communication: https://docs.restate.dev/develop/java/service-communication
- Restate Lambda deployment: https://docs.restate.dev/services/deploy/lambda
- Restate Kubernetes deployment: https://docs.restate.dev/services/deploy/kubernetes
- Restate Vercel deployment: https://docs.restate.dev/services/deploy/vercel
- Restate Deno deployment: https://docs.restate.dev/services/deploy/deno-deploy
- Restate multi-agent orchestration: https://docs.restate.dev/ai/patterns/multi-agent
- Restate public repository: https://github.com/restatedev/restate

The public Restate repository has >1,000 GitHub stars at review time and therefore meets this project's public-repository evidence threshold.

### R1 — Restate itself argues against `Workflow` as the universal abstraction

Restate exposes Basic Services, Virtual Objects and Workflows. Durable execution is broader than Workflows.

Result:

```text
ExecutionStrategy
  is the architectural abstraction

Restate Workflow
  is one possible strategy implementation
```

### R2 — Workflow identity is not organizational work identity

Restate Workflow `run` executes once per workflow ID.

But one organizational `workId` can require multiple semantic attempts:

```text
workId W1
  attempt A1 -> rejected
  attempt A2 -> remediation
  attempt A3 -> accepted
```

Therefore:

```text
workId != Restate workflowId
executionAttemptId -> runtime invocation/workflow identity
```

Same-attempt recovery keeps the same identity; a new remediation attempt gets a new identity.

### R3 — `strategyVersion` is not proof of runtime code identity

Restate deployments are immutable and existing invocations remain pinned to their original deployment, while new requests normally route to the latest registered version.

Therefore controlled replay / baseline-vs-candidate evaluation needs two identities:

```text
strategy descriptor identity
  backend-feature@v4

runtime code identity
  exact deployment/versioned endpoint/image digest
```

A post-hoc label `strategyVersion=v4` is insufficient if the invocation could have started against a different mutable `latest` target.

### R4 — Restate can supply durability without owning organization semantics

Restate supports durable calls, idempotency keys, invocation identities, recovery, agent routing and orchestration.

Those are useful inside one `ExecutionStrategy`, but none should be promoted into authority to decide:

```text
which organizational work is valid
which domain owns it
who may claim it
which downstream domain runs next
what acceptance means
whether product is DONE
```

A Restate multi-agent router may route internal specialists inside a bounded domain strategy. It must not become organization routing.

## 5. Refined model after research

### 5.1 Work semantics

```text
Obligation
 -> ORGANIZATION_WORK_CONTRACT
 -> owningDomain + workloadType + exact inputs/outputs/acceptance
```

No runtime implementation choice lives here.

### 5.2 Execution policy

```yaml
kind: EXECUTION_POLICY
policyId: backend.feature-delivery
revision: p17
domain: BACKEND
workloadType: feature-delivery
compatibleWorkContractVersions: [v1]
strategyRef: strategy://backend-feature/v4
```

Policy input is one released claim + its exact work contract + the domain-local policy head.

Policy is not allowed to scan/rank Board work, choose another domain, or rewrite acceptance semantics.

### 5.3 Strategy descriptor

```yaml
kind: EXECUTION_STRATEGY_DESCRIPTOR
strategyId: backend-feature
strategyVersion: v4
strategyKind: restate-handler | restate-workflow | application-core-loop | human-assisted
compatibleWorkloadTypes: [feature-delivery]
compatibleWorkContractVersions: [v1]
adapterRef: <exact ref>
runtimeBindingMode: VERSION_ADDRESSABLE | IMMUTABLE_LOCAL | HUMAN_SESSION
```

No generic registry is needed for Integration B. One concrete policy + strategy adapter is sufficient to prove the boundary.

### 5.4 ExecutionAttemptBinding

Policy/strategy resolution must be frozen before effects begin:

```yaml
kind: EXECUTION_ATTEMPT_BINDING
executionAttemptId: <attempt identity>
workContractRef: <exact>
releasedClaimReceiptRef: <exact>
executionPolicyRef: <exact>
executionStrategyRef: <exact>
strategyKind: <kind>
strategyId: <id>
strategyVersion: <semantic revision>
runtimeBindingRef: <exact addressable runtime binding>
runtimeCodeIdentity: <deployment/image/code identity>
contextPolicyRef: <exact>
toolsetRef: <exact or null>
modelProfileRef: <exact or null>
harnessRef: <exact or null>
```

```text
same attempt recovery -> same binding
new remediation attempt -> new executionAttemptId -> may resolve newer accepted policy

policy head race before binding commit -> fail/re-resolve
policy promotion after binding commit -> current attempt remains pinned
```

## 6. Hard invariants after rebase

```text
Organization != Workflow
Workload != Workflow
WorkContract != ExecutionPlan
ExecutionPolicy != Work Scheduler
ExecutionStrategy != Product / Write Authority
ExecutionStrategy != Cross-Domain Dispatcher
ExecutionStrategy descriptor != runtime deployment identity
Execution strategy may evolve
Work semantics may not silently evolve with it
```

A strategy may orchestrate internal agents/tools/verifiers. It may not acquire another organizational domain's authority or directly create authoritative cross-domain work.

## 7. Observe / self-improve consequences

Observation must separate WHAT from HOW from configuration:

```text
Organizational identity
  objectiveId
  workId
  domain
  workloadType
  workContractRef
  claimReceiptRef

Execution decision
  executionAttemptId
  executionPolicyRef
  strategyKind / strategyId / strategyVersion
  runtimeBindingRef / runtimeCodeIdentity
  runtimeInvocationId

Execution config
  contextPolicyRef
  toolsetRef
  modelProfileRef
  harnessRef/version
  domainControllerVersion

Outcome
  artifactRefs
  verificationRefs
  acceptanceDecisionRefs
  duration/cost/retries/remediationRound
```

This data must begin at Integration B. Integration I aggregates it; it must not infer/backfill missing historical identities.

Self-improvement becomes layer-specific:

```text
observed failure
 -> strategy/policy/context candidate
 -> same frozen WorkContract + acceptance semantics
 -> replay / benchmark / independent evaluation
 -> propose promotion
```

Promotion is append-only: new immutable strategy descriptor + new `ExecutionPolicy` revision/head. It changes HOW for new attempts. It does not silently rewrite work/acceptance semantics and does not automatically invalidate an already accepted product artifact merely because the strategy implementation changed.

## 8. Rejected alternatives

### A — Restate as organization workflow engine

Rejected because it reintroduces a global execution graph/control surface. Restate belongs below the domain-execution boundary.

### B — `WorkloadType -> PipelineId` as the architectural contract

Rejected because it couples organizational semantics to one execution shape and makes strategy evolution harder.

### C — Record strategy provenance only after execution

Rejected because policy/config/runtime can drift between selection and effects. `ExecutionAttemptBinding` must exist before execution.

### D — Treat `strategyVersion` as sufficient runtime pinning

Rejected because Restate new invocations normally route latest while in-flight invocations are deployment-pinned. Runtime code identity is a separate subject.

### E — Wrap current `createDurableBackendQaWorkflow(...)` in Restate and call it a Backend strategy

Rejected because the existing composition selects QA/remediation stages and therefore carries cross-domain control. Wrapping it durably would hide rather than remove the architectural coupling.

### F — Build universal StrategyRegistry before Integration B

Rejected by YAGNI. One concrete BA policy/strategy proves the boundary; generalization waits for multiple real consumers.

## 9. Effect on roadmap

### A/A.1

No new runtime dependency. A.1 still stops at released authorized claim. Restate does not solve or participate in A.1 principal/authorization/materialization trust blockers.

### Integration B

`DOMAIN_EXECUTION_CONTROL` is now concrete and becomes a hard precondition for actual PM/BA execution:

```text
released claim
 -> DomainExecutionController
 -> ExecutionPolicy
 -> ExecutionStrategyDescriptor
 -> ExecutionAttemptBinding
 -> execute/recover
 -> ExecutionAttemptOutcome
 -> ordinary completion/write gate
```

### C–H

Every domain execution emits the same attempt-level provenance. Different domains may use different strategy kinds.

### I

Aggregates complete historical provenance; fails if B–H omitted attempt/policy/strategy/config identity.

### J

Closes one real evolutionary loop over strategy/policy/config while freezing work semantics, evaluator and adoption authority.

## 10. Adversarial checks before accepting this rebase

```text
1. Can ExecutionPolicy inspect the whole Board and choose another work item?
   -> MUST FAIL by contract.

2. Can strategy change output/acceptance semantics because its adapter prefers another shape?
   -> MUST FAIL compatibility; block/escalate.

3. Can Backend strategy directly dispatch QA organizational work?
   -> MUST FAIL; cross-domain continuation re-enters Obligation/materialization/claim boundary.

4. Can Restate Workflow use stable workId and therefore prevent remediation attempts?
   -> MUST FAIL adapter verification; workflow/invocation identity is attempt-scoped.

5. Can strategy v4 be claimed if invocation actually routed to unknown/latest code?
   -> Outcome cannot count until exact runtime binding/code identity is proven.

6. Can strategy promotion rewrite an in-flight attempt?
   -> NO. Same attempt recovers from same immutable binding.

7. Can strategy promotion make old accepted BackendDelivery stale solely because HOW changed?
   -> NO, unless product semantics/input lineage separately changed.

8. Can human-assisted strategy bypass product acceptance because a human executed it?
   -> NO. Same completion/write/acceptance gates apply.

9. Can internal Restate multi-agent routing choose another organizational domain?
   -> NO. Internal specialists stay within the owning domain's authority boundary.
```

## 11. Result

The rebase is supported.

It resolves the conceptual `DOMAIN_EXECUTION_CONTROL` bottleneck by separating:

```text
WHAT / WHO / AUTHORITY
from
HOW / RUNTIME
```

The important refinement beyond the original guide is `ExecutionAttemptBinding` plus separate runtime code identity. Without these, strategy evolution and Restate versioning are observable only after the fact and cannot support grounded replay/evaluation.

This research does **not** authorize A.1 or Integration B. It updates the BB-046 candidate architecture and makes `DOMAIN_EXECUTION_CONTROL` a more concrete blocking contract before Integration B.


---

# Follow-up research loop — trust transition after v5 review

## Question

After the execution-strategy rebase, is `claim -> released executable capability -> semantic execution attempt` sufficiently durable and reconstructable, or does v5 still leave implementation to invent trust/currentness semantics?

## Source inspection findings

### R6.1 Existing ExHarness gives us two reusable primitives

Current source already uses:

```text
monotonic generation fencing
  claimGeneration
  reviewGeneration

and

immutable artifact/ref + canonical durable state
  where a ref without established canonical effect is not a commit receipt
```

Therefore the next design should reuse these shapes rather than build a generic IAM/capability framework.

### R6.2 Execution-authority currentness is underspecified in v5

V5 names a "current execution-authority policy head/model" but only defines a durable CAS head for `MATERIALIZATION_AUTHORIZATION`.

Decision:

```text
EXECUTION_AUTHORITY_POLICY payload = immutable
ExecutionAuthorityPolicyHead = durable CAS currentness subject
```

Minimum head:

```text
policyId -> { generation, status, policyRef }
```

Claim and release provenance pin exact policy generation/ref. A new generation removing a principal/domain binding makes an old ref historical, not current authority.

External cross-check: OpenFGA authorization models are immutable/versioned and recommends explicitly pinning authorization model IDs for consistent checks; Zanzibar's design emphasizes consistent authorization under concurrent ACL/object changes. Those systems are not being adopted here, but they reinforce the need to distinguish immutable policy identity from current authorization state.

### R6.3 Board `CLAIMED` cannot be the trust→execution capability

Current Blackboard source treats `CLAIMED + claimGeneration` as lifecycle ownership and explicitly separates it from external-effect truth. V5's prose "release usable claim receipt" therefore needs a durable subject.

Selected:

```text
CLAIM_RELEASE_RECEIPT artifact
+
ClaimReleaseHead(itemId, claimGeneration) -> exact receiptRef/status
```

The receipt binds:

```text
itemId / claimGeneration
trusted principal
workContractRef
materialization authorization ref+generation
execution authority policy ref+generation
```

`CLAIMED` without a current release head is non-executable.

Crash schedules:

```text
claim committed -> crash before release
  => provisional CLAIMED; fresh process cannot execute

release committed -> crash before caller sees response
  => fresh process reconstructs same release receipt

authority head changes after release
  => execution-entry recheck rejects/fences old receipt

recoverClaim increments claimGeneration
  => old release subject automatically stale
```

### R6.4 Semantic attempt ownership must sit above strategy adapters

Current ExHarness recovery is evidence that Board writer generation and external execution attempt are not the same thing: `recoverClaim(...)` fences the old writer by incrementing generation, while Backend/Core recovery may need to reconcile the same prior external effect/session.

Therefore:

```text
claimGeneration != semantic executionAttemptId
```

Selected B-level contract:

```text
ExecutionAttemptHead(workId)
  ABSENT -> create attempt
  ACTIVE/RECOVERY_REQUIRED -> reload same attempt/binding
  terminal remediation + exact remediation decision -> advance attempt
```

Restart or takeover does not authorize a new attempt. This prevents an ordinary crash from accidentally selecting a newer policy/runtime and duplicating side effects.

## Adversarial schedules

```text
S1 stale policy replay
  policy p7 allows BA principal
  head advances p8 removing BA
  caller presents cached p7
  => reject because p7 != current head

S2 claim crash before release
  Board CLAIMED generation 4
  process dies before ClaimReleaseHead commit
  => no execution capability

S3 release crash after commit
  ClaimReleaseHead points receipt R4
  process dies before response
  => fresh process reconstructs R4 and revalidates heads

S4 recover takeover
  claimGeneration 4 had execution attempt A1
  recoverClaim -> generation 5
  => writer fenced; semantic attempt remains A1 until recovery resolves it

S5 accidental new attempt on restart
  controller restarts while attempt A1 ACTIVE
  => must reload A1/binding; cannot mint A2 or resolve newer policy
```

## Conclusion

The execution-strategy architecture remains accepted. V5 still had two A.1 trust-currentness holes and one B-level execution-attempt ownership gap. V6 closes the A.1 contract by making both policy currentness and claim release durable/fenced subjects, and strengthens `DOMAIN_EXECUTION_CONTROL` so strategy adapters cannot own semantic attempt creation.