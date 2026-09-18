---
kind: WORK_CONTEXT_SPEC
version: 1
status: PROPOSED_EXAMPLE

contextId: BB-046-context
itemId: BB-046
generation: 1
parentContextRef: null
transitionReasonRef: INTENT-exharness-agentic-system

project:
  rootIntentId: INTENT-exharness-agentic-system

boardSubject:
  expectedStatus: PENDING_REVIEW
  expectedOwner: null

action:
  kind: REVIEW
  summary: Independently review BB-046 organizational integration plus the proposed Blackboard Context Plane.
  allowedMutations: []
  forbiddenActions:
    - implement Integration A.1 source changes
    - implement Integration B-J
    - mark the candidate accepted without independent authority
    - widen Oracle, Core or Blackboard authority
    - use prior chat to fill missing required input

authority:
  implementationDecisionRef: null
  acceptanceAuthority: configured independent architecture/application reviewer

sourceBaseline:
  repository: vhwg06/ExHarness
  revision: ad36638dd7041a60c224dfe3c9beb252069ecdae

requiredCurrentSystemRefs:
  - docs/living/contracts.md
  - docs/living/pipelines.md
  - docs/living/README.md
  - docs/worktree/agentic-application/semantics.md
  - docs/worktree/agentic-application/boundaries.md
  - docs/worktree/agentic-application/capabilities.md
  - packages/agentic-system/src/blackboard-orchestrator.js
  - packages/agentic-system/src/application-orchestrator-base.js
  - packages/agentic-system/src/session-handoff.js

requiredInputRefs:
  - docs/living/knowledge/bb046-blackboard-context-architecture.md
  - docs/living/knowledge/bb046-blackboard-context-contracts.md
  - docs/living/knowledge/bb046-blackboard-context-pipelines.md
  - docs/living/knowledge/bb046-blackboard-context-evaluation.md
  - docs/living/knowledge/bb046-organizational-integration-implementation-artifact-readiness-v7.md
  - docs/living/knowledge/bb046-trust-transition-research-v7.md

auditRefs:
  - docs/living/knowledge/bb046-execution-strategy-rebase-research-v6.md
  - docs/living/knowledge/integration-phase-research-to-implementation-readiness-v7.md
  - docs/living/knowledge/bb028-decision-outcome-chain.md
  - docs/living/decisions/D009-generation-fenced-interrupted-recovery.md

sourceScope:
  read:
    - docs/living/**
    - docs/worktree/agentic-application/**
    - packages/agentic-system/src/blackboard-orchestrator.js
    - packages/agentic-system/src/application-orchestrator-base.js
    - packages/agentic-system/src/session-handoff.js
  write: []
  forbidden:
    - packages/core/**
    - packages/agentic-system/src/oracle/**
    - runtime implementation changes

hardInvariants:
  - Blackboard != Scheduler
  - Blackboard != Work Context
  - Work Context != Source Truth
  - Work Context != Acceptance Authority
  - Work Context != WorkContract
  - Context producer != context-currentness authority
  - Message != Authoritative Output
  - Research producer != acceptance authority
  - Organization != Workflow
  - Workload != Workflow
  - WorkContract != ExecutionPlan
  - ExecutionPolicy != Work Scheduler
  - ExecutionStrategy != Cross-Domain Dispatcher
  - PM != Organization Scheduler
  - Artifact acceptance != blanket obligation authorization
  - Board CLAIMED != executable capability
  - ClaimReleaseHead != Blackboard lifecycle authority

verification:
  - derive exact A.1 source seams without chat reinterpretation
  - verify trust transition crash/race semantics
  - verify the Blackboard Context Plane does not become a second lifecycle authority
  - verify context generation is distinct from claim/review/execution generations
  - verify normal loading uses required refs while audit refs remain lazy
  - verify no source mutation is authorized by this generation

expectedOutputs:
  - independent review decision/evidence for the exact candidate
  - grounded findings attached back to BB-046
  - if accepted, a new immutable g0002 implementation context with exact decisionRef and current source baseline

staleWhen:
  - BB-046 leaves PENDING_REVIEW
  - Board current context generation/ref changes
  - candidate architecture artifacts materially change
  - source baseline materially changes named source seams
  - configured reviewer authority/scope changes
---

# BB-046 g0001 — readiness-review context

This file is a **candidate example** of the proposed context architecture. It is not current implementation authority until the Blackboard context-plane contract itself is accepted.

## Review question

Can an independent reviewer determine, from this context plus the required refs, whether:

1. the organizational A.1 trust transition is deterministic enough to implement;
2. the Blackboard Context Plane reduces context inference without becoming a second Board/authority;
3. the next implementation slice can be generated explicitly after acceptance rather than inferred from this review artifact?

## Mandatory negative checks

The review must reject or reopen if it finds any path where:

```text
context currentness is inferred from file existence
old generation remains implementation permission
review PASS mutates review context into implementation context
context producer fabricates authority
worker must scan arbitrary Board refs to identify current context
audit-only research becomes hidden implementation requirement
context resolver selects work or schedules domains
Blackboard starts carrying source/context payload bodies
runtime WorkContract and repository Work Context are conflated
```

## Next generation

If the exact candidate is accepted:

```text
create g0002-implementation.md
  parentContextRef = this file
  transitionReasonRef = exact accepted review decision
  action.kind = IMPLEMENT
  implementationDecisionRef = exact decision
  sourceBaseline = then-current repository revision
  sourceScope.write = exact accepted A.1 source paths
  verification = exact commands/tests
```

Do not rewrite this generation in place.
