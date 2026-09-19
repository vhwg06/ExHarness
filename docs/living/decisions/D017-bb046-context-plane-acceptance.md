# D017 — Accept the BB-046 Blackboard Context Plane and A.1 bridge boundary

Status: **ACCEPTED**

Accepted: 2026-09-19

Acceptance boundary: independent fresh review of BB-046 generation 2 against immutable semantic candidate `d013b6118dccfea67e8615f4624d3a00f6e10b4f`. The review was reconstructed from repository state and exact referenced artifacts rather than prior conversation. PR #151 is navigation only.

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-046/g0002-readiness-review.json
subjectCandidateHeadSha: d013b6118dccfea67e8615f4624d3a00f6e10b4f
verdict: ACCEPT
scope:
  - repository-local Blackboard Context Plane first implementation slice
  - Integration A.1 bridge architecture only
```

The review also checked the post-target envelope. The semantic candidate is an ancestor of the pre-merge source baseline `ad36638dd7041a60c224dfe3c9beb252069ecdae`; the merge to `main` materialized the reviewed candidate plus the declared review envelope. No later source/runtime implementation is treated as part of this acceptance.

## Choice

Accept the bounded Blackboard Context Plane with these authority boundaries:

```text
Blackboard
  = lifecycle + dependencies + blockers + exact current context pointer

WORK_CONTEXT_SPEC
  = immutable safe-next-action declaration for one item generation

Context Resolver
  = deterministic resolution of declared required refs/source identities

source/tests/worktree
  = current-system truth

review/decision evidence
  = acceptance authority according to existing contracts
```

The context plane is not a second Blackboard, scheduler, correctness authority, WorkContract, or execution runtime.

Accept Integration A.1 only as the first organizational bridge architecture. This decision does not authorize Integration B-J and does not turn PM, the materializer, Restate, Oracle, or ApplicationOrchestrator into an organization scheduler.

## Independent review findings

No blocking contradiction remains in the reviewed A.1 trust-transition contract. The accepted boundary preserves:

- trusted principal -> authorized domain-set claim authorization;
- exact materialization authorization rather than blanket obligation authorization;
- durable CAS-fenced execution-authority policy currentness;
- Board `CLAIMED` distinct from executable capability;
- immutable claim-release receipt/head;
- Board lifecycle invalidation before release-head fencing;
- deterministic duplicate materialization convergence;
- runtime HOW selection deferred below the organization/work-contract boundary;
- ProductStateProjection as derived/rebuildable rather than product authority.

The review specifically accepts the v7 correction that `ClaimReleaseHead.FENCED` never substitutes for a canonical Blackboard lifecycle transition.

## Implementation authorization

This acceptance authorizes only the repository-local BB-046 context-plane implementation slice described by the reviewed readiness artifact:

```text
scripts/blackboard-context-contract.mjs
scripts/blackboard-context-board.mjs
scripts/blackboard-context-resolver.mjs
scripts/blackboard-context-generate.mjs
scripts/blackboard-context-verify.mjs
scripts/blackboard-context-eval.mjs
contract/fixture tests
package.json verify/eval commands
promotion of delivered context semantics into living docs
```

The implementation context must carry the exact write scope and verification contract. Runtime organizational A.1 source changes require their own implementation context/slice; this decision does not silently combine them with the repository context-plane implementation.

## Required implementation properties

The first implementation must fail closed for:

```text
missing/duplicate Board current-context binding
Board item/ref/generation mismatch
generation rollback
missing required refs
REVIEW context with source writes
IMPLEMENT context without exact accepted decision
write/forbiddenWrite overlap
stale current-context pointer
decision subjectContextRef mismatch
decision subjectCandidateHeadSha mismatch
candidate-surface drift outside the allowed review envelope
```

It must keep `auditRefs` lazy/non-authoritative and must not infer currentness by scanning files or artifact existence.

## Evaluation gate

Promotion remains evidence-gated. Deterministic fixtures must show zero authority/staleness escapes and compare explicit context against the current heuristic loading baseline. If explicit context provides no useful reduction in irrelevant loading/wrong-scope risk, the architecture is reopened rather than generalized.

## Not accepted

This decision does not accept:

- a generic context service/database;
- runtime adoption for every Blackboard consumer;
- a global workflow graph or role registry;
- automatic LLM context authority;
- automatic architecture acceptance;
- Integration B-J implementation;
- Restate as organization control;
- changing product/work acceptance semantics through execution-strategy evolution.

## Evidence

- `docs/living/work-context/BB-046/g0002-readiness-review.json`
- `docs/living/knowledge/bb046-blackboard-context-architecture.md`
- `docs/living/knowledge/bb046-blackboard-context-contracts.md`
- `docs/living/knowledge/bb046-blackboard-context-pipelines.md`
- `docs/living/knowledge/bb046-blackboard-context-evaluation.md`
- `docs/living/knowledge/bb046-blackboard-context-implementation-readiness.md`
- `docs/living/knowledge/bb046-organizational-integration-implementation-artifact-readiness-v7.md`
- `docs/living/knowledge/bb046-trust-transition-research-v7.md`

## What would reopen this decision

Reopen if implementation cannot enforce immutable review-subject/current-context binding without brittle/fuzzy Board parsing, if the evaluation value gate fails, if runtime adoption requires materially different semantics, or if A.1 executable tests expose a trust-transition hole not represented by the reviewed contracts.
