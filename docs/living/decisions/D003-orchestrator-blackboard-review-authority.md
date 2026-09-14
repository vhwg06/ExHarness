# D003 — Orchestrator-owned Blackboard review authority

Status: **PROMOTED**

## Decision

The Blackboard is shared operational state, not an actor and not correctness authority.

The Agentic Application Orchestrator owns Blackboard lifecycle transitions:

```text
read -> claim -> dispatch/execute -> submit -> review scheduling -> assessment reconciliation -> DONE/REOPEN/BLOCK
```

A Worker may produce a submission and may request review, but it cannot authorize `DONE` for its own work.

## Horizontal roles

Two horizontal roles are intentionally separate:

```text
PM
= project coordination
= sequencing / dependency / timeline / progress
= may require review because of project obligations

SA
= architecture only
= architecture constraints / architecture judgment / architecture review
= does not own project coordination
```

PM and SA must receive separately resolved context appropriate to their authority. A single global review context is not the target design.

Planning is already a broad upper bound for SA; SA must not absorb project management, review-queue management or timeline ownership.

## Vertical execution and review

All other specialist execution/review remains vertical and context-bound.

Examples:

```text
Backend implementation context -> Backend Worker
Backend review context         -> Backend Reviewer
Frontend implementation context -> Frontend Worker
Frontend review context         -> Frontend Reviewer
QA context                       -> QA Worker/Reviewer semantics
```

`Reviewer` is not a global horizontal role beside PM/SA. "Teacher" is only a conceptual abstraction for bounded review authority; it is not a required runtime component or registry.

## Review initiation and scheduling

Two review-initiation paths are valid:

```text
Worker finishes
 -> raises a review request

or

work is submitted
 -> PM requires review from project obligations
```

These mean different things:

```text
REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT
```

The Orchestrator owns dispatch/scheduling and may execute review immediately in the current session or defer it for a later/batch review session. Review timing must not change review semantics.

## Follow-up generation

Workers, reviewers, PM, SA and runtime/evidence may surface unresolved findings. They do not directly create canonical follow-up work by self-report.

The Orchestrator reconciles findings into Blackboard state:

```text
finding still belongs to current acceptance obligation
 -> REOPEN / narrow current work

finding already represented by another unresolved item
 -> LINK existing work

finding is genuinely independent actionable work
 -> CREATE new Board item with origin/dependency provenance

finding is merely non-actionable / speculative / no concrete pressure
 -> do not create Board work
```

Invariant:

```text
Do not generate new work when the finding is evidence that the current work is not done.
```

## Completion authority

```text
Worker submission != acceptance
review request != review verdict
review verdict != global project coordination
role completion != Blackboard problem completion
```

`DONE` is derived only after required review/acceptance obligations are satisfied and no unresolved current-work finding remains.

## Relationship to ExHarness boundaries

- Agentic Application owns project/work/review semantics and Orchestrator control.
- Oracle resolves context declared by each concrete role/context contract.
- ExHarness Core remains execution/evidence/trust substrate and does not decide domain/project correctness.
- Advisor remains bounded judgment and does not own Blackboard transitions or correctness authority.

## Implementation discipline

Do not introduce a generic Teacher/Reviewer registry, workflow graph or universal review context merely because this decision names common semantics.

Concrete PM, SA and vertical review contexts must be earned from real slices. Common abstractions may be extracted only after repeated source-backed semantics justify them.
