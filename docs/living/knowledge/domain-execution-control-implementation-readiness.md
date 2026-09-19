# DOMAIN_EXECUTION_CONTROL — implementation-readiness research

Status: **PENDING REVIEW**

## Goal

Make the deferred Integration B boundary implementation-ready without implementing it before A.1 is accepted.

Integration B begins only after one exact organizational claim has been released as executable capability. It owns HOW for that one claim; it does not select organizational work, change domain ownership, or change acceptance semantics.

## Existing source pressure

Current ApplicationOrchestrator still owns lifecycle and worker-selection responsibilities. Existing durable Backend→QA composition crosses organizational domains, so it cannot be wrapped and renamed as a Backend ExecutionStrategy without preserving hidden cross-domain control.

The current reusable primitives are narrower: domain workers, context preparation, Core execution/recovery, verification/completion gates, generation fencing, immutable refs, and durable stores.

## Minimal Integration B slice

Introduce one concrete domain-local path only:

released claim receipt
-> DomainExecutionController
-> durable ExecutionAttemptHead
   -> ACTIVE / RECOVERY_REQUIRED: load the existing immutable ExecutionAttemptBinding; do not re-resolve policy
   -> ABSENT: resolve current ExecutionPolicy head + immutable ExecutionStrategyDescriptor, then CAS-create the first attempt/binding
   -> TERMINAL: require an explicit remediation/new-attempt decision before creating another attempt
-> execute/recover one BA-owned workload from the bound attempt
-> ordinary completion/verification/write gates

No global StrategyRegistry is required.

## Contracts

### ExecutionPolicy

- keyed by domain + workloadType;
- compatible WorkContract versions are explicit;
- points to exact strategy descriptor;
- may not inspect/rank the Blackboard;
- may not change work inputs, outputs, acceptance, domain, priority, or downstream obligations.

### ExecutionStrategyDescriptor

- immutable strategy identity and semantic version;
- exact adapter/runtime binding mode;
- compatible workload and WorkContract versions;
- runtime code identity remains distinct from semantic strategyVersion.

### ExecutionAttemptHead

The attempt owner sits above adapters.

- ABSENT: one controller may create the first semantic attempt;
- ACTIVE / RECOVERY_REQUIRED: restart/takeover must reuse the same attempt;
- TERMINAL: a new attempt requires an explicit remediation/new-attempt decision;
- claimGeneration fences writers but is not the semantic attempt identity.

### ExecutionAttemptBinding

Must be durably committed before effects begin and pins:

- executionAttemptId;
- exact WorkContract ref;
- exact released ClaimReleaseReceipt ref;
- exact ExecutionPolicy ref;
- exact ExecutionStrategyDescriptor ref;
- exact runtime binding/code identity;
- context/tool/model/harness refs where applicable.

Policy promotion after binding commit cannot rewrite an in-flight attempt.

## Recovery semantics

Controller entry first reads ExecutionAttemptHead before any policy/strategy resolution.

If the head is ACTIVE or RECOVERY_REQUIRED, recovery loads the already-bound attempt and MUST NOT resolve the current policy/strategy again.

Only ABSENT may resolve current ExecutionPolicy + ExecutionStrategyDescriptor for a first attempt. That resolution and attempt/binding publication must be fenced so a racing controller cannot create a second semantic attempt.

Crash before attempt-head/binding commit: no semantic attempt exists; retry may resolve policy again.

Crash after the attempt/binding commit: the same attempt is RECOVERY_REQUIRED; reconstruct/reload the same immutable binding rather than minting another or observing a newer policy.

Crash after effect start: adapter recovery must use the same binding/runtime identity.

Claim takeover/recovery may advance Blackboard claimGeneration while the semantic execution attempt remains the same until external-effect reconciliation resolves it.

## Authority fences

- released claim is a prerequisite, not a scheduler input;
- execution-entry revalidates exact current claim/release authority;
- strategy cannot create authoritative cross-domain work;
- Backend strategy cannot directly dispatch QA;
- internal multi-agent routing remains within one owning domain;
- completion still goes through existing independent verification/write/acceptance gates.

## First concrete strategy

Use one BA workload strategy for Integration B because it proves the organization boundary without reusing the cross-domain Backend→QA dispatcher.

Candidate strategy kind: application-core-loop or human-assisted adapter first. Restate remains an optional strategy implementation after the contract is proven; it is not required to establish the boundary.

## Required tests before implementation can be accepted

1. policy cannot select a different Board item;
2. incompatible WorkContract version fails closed;
3. strategy cannot change output/acceptance semantics;
4. restart while attempt ACTIVE/RECOVERY_REQUIRED loads ExecutionAttemptHead first and reuses the same attempt/binding without policy re-resolution;
5. policy promotion does not alter an in-flight binding;
6. runtime code identity must be exact, not mutable latest;
7. Backend strategy cannot dispatch QA organizational work;
8. claim-generation fencing prevents stale writers without automatically minting a new semantic attempt;
9. missing/stale released claim prevents execution entry;
10. human-assisted strategy does not bypass completion/acceptance gates.

## Source placement candidate

Keep the implementation in packages/agentic-system. Do not widen packages/core-harness for organization scheduling semantics.

Candidate modules:

- domain-execution-controller.js
- execution-policy.js
- execution-attempt-store.js
- one BA execution strategy adapter
- focused bb0xx tests

The controller composes existing Core/runtime primitives but does not move organization authority into Core.

## Readiness result

The contract is specific enough for a bounded Integration B source slice after A.1 is accepted and a dedicated implementation context authorizes it. Attempt ownership is resolved before policy/strategy selection so recovery cannot accidentally bind a newer policy to an existing semantic attempt.

This artifact does not authorize Integration B implementation.
