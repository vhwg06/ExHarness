# Agentic Application boundaries

Authority and dependency boundaries for the current application layer and its accepted role constraints.

## OWNERSHIP MATRIX

| Concern | Owner |
| --- | --- |
| Objective / domain goal | Agentic Application |
| Work decomposition | Orchestrator; bounded Advisor or PM coordination may propose, but cannot commit canonical graph state directly |
| Which Worker executes | Orchestrator |
| Worker role semantics | Agentic Application |
| WorkOrder / WorkResult contracts | Agentic Application |
| Required context semantics/shape | Agentic Application |
| Context source resolution/adaptation | Oracle / infrastructure |
| Backend-local continuation/gap proposal | Bounded Advisor |
| Project-level coordination/progress proposal | PM through the bounded PM/SA coordination slice |
| Project coordination / sequencing / dependency / timeline / progress proposal | PM through the bounded PM/SA coordination slice; Orchestrator owns canonical mutation |
| Architecture assessment / architecture-review need | SA through the bounded PM/SA coordination slice; no project lifecycle authority |
| Application workflow control/state | Orchestrator |
| Agent/model execution mechanics | ExHarness |
| Turn/runtime lifecycle | ExHarness |
| Semantic memory / cognition substrate | ExHarness |
| Evidence/trust/runtime authority primitives | ExHarness |
| Filesystem/process/network/workspace enforcement | Infrastructure/executor |
| Source-specific transport/auth | Oracle/infrastructure adapter |

## APPLICATION -> ORACLE

```text
Application owns:
WHAT context is needed
WHY it is needed
HOW the result is shaped
required/optional/relevance/budget semantics

Oracle owns:
WHERE source data lives
HOW to retrieve it
HOW to adapt source representation
HOW to satisfy the declared contract
```

Oracle must not widen or invent semantic requirements that the application did not declare.

## APPLICATION -> EXHARNESS

```text
Application owns:
role/task/workflow meaning
WorkOrder and expected WorkResult
when a specialist should run
what application completion means

ExHarness owns:
how agent execution runs
model/tool/capability invocation mechanics
runtime lifecycle and bounded cognition
execution observation/trust/evidence primitives
```

The application must not create a second agent runtime, session loop, memory system or recovery model around ExHarness merely to coordinate Workers.

## APPLICATION / ORCHESTRATOR -> PM / SA COORDINATION

```text
Application session handoff
  -> bounded SA context
       -> evidence-bound architecture assessment
       -> durable SA assessment ref

Application session handoff
  -> bounded PM context + optional grounded SA assessment
       -> PM coordination proposal bound to exact target lifecycle tuple
       -> durable PM proposal ref

PM/SA coordination controller
  -> validates project/root/target/evidence freshness
  -> delegates canonical mutation to ApplicationOrchestrator.extendWorkGraph(...)
```

PM and SA produce bounded proposal/judgment state; neither mutates Blackboard directly.

PM may propose prerequisite work, dependency edges, blockers and PM-sourced review requirements. It cannot rewrite user intent or carry architecture, completion or review-verdict authority.

SA may assess architecture evidence and state whether architecture review is required. It cannot own dependency, priority, sequencing, timeline, lifecycle, completion or review-verdict authority.

A durable proposal/assessment artifact becomes continuation-relevant only when its ref is canonically linked with the corresponding Board effects. Orphan or spoofed refs are not lifecycle truth. This slice is not a generic PM/SA Worker runtime or horizontal-role framework.

## ORCHESTRATOR -> ADVISOR

```text
Orchestrator = authority to control application workflow
Advisor      = authority to propose bounded judgment only
```

Advisor cannot dispatch Workers, commit application state or certify completion by self-report.

## ORCHESTRATOR -> WORKER

```text
Orchestrator
    -> explicit WorkOrder + resolved context
Worker
    -> explicit WorkResult
Orchestrator
    -> next deterministic decision
```

Worker cannot implicitly transfer control to another Worker through conversation handoff.

## WORKER -> INFRASTRUCTURE

Worker receives only the capabilities/resources/workspace authority explicitly bound for its execution. Infrastructure enforcement remains outside application semantics.

## STATE SEPARATION

These states must remain distinct:

```text
Application workflow state
!= ExHarness runtime/work state
!= semantic memory
!= trace/event history
!= evidence/trust artifacts
!= effect-recovery state
!= Oracle source/cache state
```

References between them may be explicit; one must not silently become the source of truth for another.

## DEFAULT EXCLUSIONS

Unless a concrete use case proves otherwise, the application layer does not own:

- group-chat/shared conversation coordination;
- speaker selection;
- hidden context refresh;
- source connector/retrieval frameworks;
- generic workflow graph engines;
- model routing/runtime loops already supplied by ExHarness.

## Organizational trust → claim boundary

```text
accepted obligation
  + current MATERIALIZATION_AUTHORIZATION
  -> deterministic OrganizationWorkMaterializer
  -> immutable ORGANIZATION_WORK_CONTRACT + READY Board item
  -> trusted ExecutionPrincipal provider/context
  -> derived { principalRef, Board owner }
  + current ExecutionAuthorityPolicyHead
  -> Blackboard CLAIMED { owner, claimGeneration }
  -> immutable project/root-bound CLAIM_RELEASE_RECEIPT
  -> current ClaimReleaseHead(projectId, itemId, claimGeneration) = { status, receiptRef }
  -> released executable capability
```

The materializer has no work-selection, scheduling or execution-policy authority. The claim controller cannot choose another item/domain or rewrite work semantics. Board `CLAIMED` alone is not execution authority, and `ClaimReleaseHead.FENCED` is not a Blackboard lifecycle transition.

A.1 ends at released claim. `DOMAIN_EXECUTION_CONTROL` owns HOW only after this boundary and remains a separate integration slice.


The caller cannot self-assert the execution principal identity. Application code obtains it through the injected trusted principal boundary and derives Board ownership from that result.

Materialization and claim capability are both project/root-bound. A stale materialization-authorization observation cannot leave new READY work eligible: publication revalidates the exact observation and post-publication drift is reconciled to BLOCKED.

Claim invalidation provenance is an immutable content-addressed artifact, not a caller-authored evidence string. The canonical Board transition validates that artifact against the exact project/root + claim tuple before mutation; release-head fencing remains second and idempotent.


## Final A.1 trust/currentness boundary

The organizational claim bridge has four caller/authority separations:

```text
caller principal context
  -> trusted ExecutionPrincipal provider
  -> canonical principalRef + Board owner

Board organization item
  -> exact materialization authorizationId/ref/generation/revision
  -> current grant must still be that exact observation

application controller configuration
  -> executionAuthorityPolicyId
  -> caller cannot select another policy subject

logical obligation subject
  -> one live Board item maximum
  -> exact grant/decision produces materialization identity beneath that subject
```

Fresh-process reconciliation operates only on the current durable Board claim. It recovers the principal from durable owner identity through the trusted provider, keeps the same `claimGeneration`, and converges the release/invalidation boundary from durable Board, immutable artifacts and current heads.

Authority publisher verification produces canonical provenance that is stored in the immutable authority artifact before the pointer head advances. Payload fields that merely claim an issuer/publisher identity are not authority.


### A.1 final acceptance repair

The bridge now has an explicit read-only discovery seam before claim:

```text
Board eligible work
  -> resolve exact ORGANIZATION_WORK_CONTRACT
  -> validate project/root/item/materialization provenance
  -> require dependencies DONE
  -> filter owningDomain
  -> candidates
```

Discovery is not an authentication or scheduling boundary. Claim authority remains separate and derives the exact materialization authorization subject from Board provenance plus the configured current execution-authority policy.

The immutable work contract carries the complete governed WHAT/provenance set; Board origin remains lifecycle/index provenance rather than a second source of work semantics.

Execution entry is an active revocation boundary, not only a predicate: a stale released claim persists an exact invalidation artifact, commits the typed canonical Board lifecycle consequence first, and fences the historical release head second.

Concurrent identical materialization must converge across both immutable-artifact persistence and Blackboard publication. Conflicting materializations for the same live logical obligation fail closed.

## Domain execution HOW boundary

Integration B begins only after A.1 has produced an exact current released organizational claim. A.1 remains authority for WHAT/WHO and claim currentness; the domain execution controller owns only HOW for that one already-authorized work subject.

```text
A.1 released claim
  -> DomainExecutionController
       -> ExecutionPolicyHead / immutable policy
       -> ExecutionAttemptHead / immutable binding
       -> trusted runtime adapter
       -> factual outcome
       -> separate domain completion authority
       -> separate publication authority
```

The controller cannot inspect or rank unrelated Blackboard work, issue authoritative cross-domain obligations, mutate ApplicationOrchestrator lifecycle semantics, or treat an ExecutionStrategy as a cross-domain dispatcher. A strategy result is not runtime identity, runtime success is not domain acceptance, and acceptance is not publication authority. Telemetry or the derived ExecutionJudgmentBundle may index evidence but cannot become correctness authority.
