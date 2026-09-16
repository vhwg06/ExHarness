# D010 — Backend/QA project completion requires an explicit trusted acceptance obligation

Status: **PROPOSED**

Proposed: 2026-09-16

Acceptance boundary: BB-018 application-architecture review plus acceptance/trust review. This proposal must not be promoted into `docs/worktree/*` or used to mark BB-018 complete before those reviews accept it.

## Context

The durable Backend -> QA workflow already produces grounded Backend and QA role-local acceptance decisions and submits one final immutable Blackboard payload containing the accepted revision, decision refs, artifact refs and evidence refs.

The Blackboard Orchestrator already supports separate Worker review requests, PM review requirements, exact review subjects, trusted evidence/decision/attestation bundles and finding reconciliation.

However the concrete Backend -> QA final submission currently supplies no review requirement. `submit(...)` still moves it to `PENDING_REVIEW`, while `beginReview(...)` requires a persisted matching requirement. The project acceptance obligation is therefore absent from the concrete composition.

## Choice

For the first concrete Backend -> QA project completion path:

1. project acceptance review is an **explicit mandatory project obligation**;
2. the obligation is persisted through the existing PM/project-requirement authority path and is not fabricated as a Worker request;
3. a bounded project reviewer receives only the frozen review target, final Backend/QA submission lineage, declared refs and explicit project acceptance policy;
4. independent verifier evidence, reviewer evaluation and attestation use the existing Core trust artifacts and `TrustBoundary.ACCEPTANCE`;
5. `ApplicationOrchestrator` remains completion authority and derives `DONE` only after all declared review obligations are trusted-ACCEPTED, findings are reconciled and no current remaining work exists;
6. absence of the mandatory project acceptance configuration fails closed. It never means auto-acceptance and must not leave an undispatchable `PENDING_REVIEW` item silently;
7. a future no-review mode, if ever required, needs an explicit `NO_REVIEW_REQUIRED` project-policy authority outcome. Empty review requirements are not that outcome.

Conceptually:

```text
Backend ACCEPT
  -> QA ACCEPT
  -> final immutable BackendQa submission
  -> explicit project acceptance REQUIREMENT
  -> exact review target
  -> declared-ref resolution
  -> independent verification EvidenceArtifact[]
  -> reviewer DecisionArtifact @ ACCEPTANCE
  -> signed Attestation
  -> Orchestrator trust validation
  -> DONE | REOPENED | PENDING_RECONCILIATION
```

## Trust authorities

The first implementation must preserve these separate authorities:

```text
submission producer
project-obligation authority
review evaluator
verification evidence producer
attestation issuer
ApplicationOrchestrator lifecycle authority
```

The reviewer must differ from the submission producer. Verification evidence and attestation must satisfy the configured independent-authority policy. Roles or prose alone do not establish authority.

The accepted trust bundle remains:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

No new review-specific trust artifact type is introduced.

## Failure semantics

- review not yet dispatched -> durable `PENDING_REVIEW`;
- required review input unavailable -> defer/block the concrete review preparation without fabricating a verdict;
- stale/forged/unauthorized trust bundle -> reject canonical assessment mutation;
- trusted `REJECTED` / `INCONCLUSIVE` -> reopen the same current work with grounded blockers;
- trusted `ACCEPTED` with findings -> `PENDING_RECONCILIATION` until findings are classified;
- trusted `ACCEPTED` with every obligation satisfied and no remaining current work -> `DONE`;
- missing mandatory project-acceptance configuration -> fail closed as configuration/project-obligation error.

## Rejected alternatives

### Treat QA ACCEPT as project DONE

Rejected. QA owns a concrete verification role and its evidence policy; it is not the enclosing project completion authority.

### Add a Worker review request from QA merely to make the item dispatchable

Rejected. A Worker may request specialist verification, but the mandatory final project acceptance obligation is a project-policy/PM concern. Conflating the two erases the existing authority split.

### Empty review requirements mean no review required

Rejected. Absence is ambiguous and currently creates an undispatchable `PENDING_REVIEW` state. Acceptance must be explicit.

### Introduce a generic Reviewer framework now

Rejected. One concrete Backend/QA project review does not establish repeated semantics for a generic Reviewer type, registry or workflow DSL.

### Let reviewer prose authorize completion

Rejected. Reviewer narrative is not grounded evidence, an integrity-checked decision or an attestation.

## Consequences

- BB-019 can implement one bounded Backend/QA acceptance-review composition using existing Orchestrator and Core trust machinery;
- the durable workflow gains a legal path from QA completion to independently grounded project `DONE`;
- missing review configuration becomes diagnosable instead of silently stranded;
- rejection/remediation remains on the same Blackboard item;
- independent findings retain current-work versus follow-up reconciliation;
- PM/SA concrete runtime roles remain deferred to their own evidence pressure;
- interrupted-review recovery remains owned by BB-016/017 and is composed rather than duplicated.

## Evidence

- `docs/living/knowledge/bb018-review-to-completion.md`;
- `packages/agentic-system/src/durable-backend-qa.js` final QA submission behavior;
- `packages/agentic-system/src/blackboard-orchestrator.js` requirement, dispatch, trust and reconciliation semantics;
- `packages/agentic-system/test/wave-d.test.js` executable trusted-review contracts;
- `packages/agentic-system/src/backend-completion.js` and `qa-completion.js` role-local acceptance boundaries;
- `packages/core-harness/src/trust.js` authority/evidence/decision/attestation policy primitives;
- `docs/worktree/agentic-application/contracts.md` current source-backed authority split.

## Promotion targets

Only after BB-019 implements and verifies this concrete composition should applicable current-system facts be promoted into:

- `docs/worktree/agentic-application/contracts.md`;
- `docs/worktree/agentic-application/state.md`;
- the durable Backend -> QA workflow projection.

The proposed design itself stays in living decision/knowledge surfaces until implemented.

## What would reopen this decision

Reopen if a second concrete project-review slice demonstrates materially different review-context or authority semantics, if a real project requires an explicitly authorized no-review mode, or if production trust infrastructure cannot satisfy the proposed independence/freshness policy without a different boundary.
