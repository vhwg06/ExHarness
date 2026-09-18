# Agentic Application capabilities

Current source-backed capability semantics of the Agentic Application. APIs are implementation entry points, not the capability definition.

## A1 — Project-bound fresh-session handoff
Outcome: reconstruct one durable project's current lifecycle/continuation state.
Requires: durable Board, one user-intent root, matching project id, traceable provenance.
Guarantees: project identity + lifecycle buckets + generations + active review + checkpoints + refs; fail-closed identity/provenance.
Durable state: `USER_INTENT_ROOT` + Board.
Limits: handoff does not select work, resolve source bytes, execute Workers or authorize completion.
Details: `contracts.md`, `state.md`.

## A2 — Durable Blackboard lifecycle
Outcome: claim/checkpoint/block/submit/review/recover/reopen/reconcile/complete work across reconstruction.
Requires: transactional Board store + exact current lifecycle generation.
Guarantees: dependency/eligibility checks; stale execution/review generations cannot mutate; Worker submission cannot self-authorize `DONE`; reviews/remaining obligations gate completion.
Durable state: work graph, generations, checkpoints, submission, review/finding state.
Limits: Board is not Core effect truth, Oracle payload authority or trust-artifact payload storage.
Details: `contracts.md`.

## A3 — Grounded mutating Backend execution
Outcome: execute Backend work and accept only after committed-lineage/evidence policy succeeds.
Requires: concrete Backend objective/order/context + Core execution/evidence.
Guarantees: `APPLIED` requires lineage advancement; default completion grounds mutation + typecheck + tests + artifacts; Advisor proposals cannot self-authorize acceptance.
Failure: interrupted mutating work must recover against durable Core session/effect truth.
Limits: no generic Worker/Advisor abstraction is claimed.
Details: `state.md`, `backend-preparation.md`.

## A4 — Non-mutating QA verification
Outcome: verify one accepted Backend target and accept it or return bounded remediation.
Requires: exact accepted Backend handoff + Oracle-resolved artifacts.
Guarantees: QA cannot mutate/advance lineage; completion grounds behavior/regression evidence; abandoned generation is fenced before redispatch.
Failure: source unavailability blocks exact stage; QA issues return to remediation.
Limits: QA acceptance is role-local, not project `DONE`.
Details: `state.md`, `workflow.md`.

## A5 — Durable Backend -> QA continuation
Outcome: carry accepted Backend work across fresh sessions into QA and remediation.
Guarantees: exact stage checkpoint; ref-only `BackendQaHandoff`; Backend acceptance precedes QA; QA acceptance submits to `PENDING_REVIEW`.
Durable state: `BACKEND_PENDING | QA_PENDING | BACKEND_REMEDIATION_PENDING | BLOCKED` + decision/artifact refs.
Failure: QA source failure blocks/resumes; Backend interruption goes through Backend/Core recovery.
Limits: no automatic project acceptance.
Details: `workflow.md`, `contracts.md`.

## A6 — Manifest-protected publication ordering
Outcome: exact producer manifest is durable before protected `QA_PENDING`.
Requires: explicit publisher + revision-bound producer source.
Guarantees: persist exact `artifactManifestRef`; publication failure after Backend effects enters recovery-required path; receipt reuse requires semantically equivalent recovered acceptance.
Failure: conflicting semantics fail closed; protected flow cannot downgrade to direct-reader mode.
Limits: manifest integrity is not semantic correctness or acceptance.
Details: `../oracle/artifact-manifest.md`.

## A7 — Trusted Backend/QA project acceptance
Outcome: fresh-session grounded review can complete, reconcile or reopen the same item for remediation.
Requires: PM-sourced requirement + exact decision/application refs + trust artifacts + verifier/evaluator/attestation dependencies.
Guarantees: exact-input preparation; review subject/generation fencing; trust-policy validation before mutation; rejection/inconclusive reopens same item.
Failure: missing/corrupt/mismatched inputs fail closed; interrupted review gets a new generation.
Limits: PM configuration does not cryptographically prove PM identity; reviewer prose is not evidence.
Details: `project-acceptance.md`.

## A8 — Distinct review obligation sources
Outcome: Worker review requests and PM project review requirements coexist without conflating authority.
Guarantees: `REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT`; Orchestrator owns lifecycle state.
Durable state: requirement source/key/reason + active review.
Limits: no concrete PM runtime Worker or SA runtime Worker is implemented. D003's PM/SA split is an authority boundary; only PM-sourced requirement transport/lifecycle exists in source today.
Details: `contracts.md`, `boundaries.md`, `state.md`.

## A9 — Bounded project work selection
Outcome: propose one eligible item without taking claim authority.
Requires: current eligible work + explicit policy + current measurements/evidence + budget.
Guarantees: eligibility hard gate; mandatory/starvation gates before scoring; full freshness before decision reuse; ordinary claim rechecks Board.
Limits: not a default scheduler.
Details: `work-selection.md`.

## A10 — Durable research continuation
Outcome: resume exact incomplete research, skip completed experiments, reassess stale evidence, submit only a reviewable proposal.
Requires: `RESEARCH_CONTINUATION v1` + declared external refs.
Guarantees: Board stores cursor/refs; only declared refs resolve; scope-aware freshness; proposal + PM-required review commit together.
Failure: inconsistent experiment state or unresolved freshness blocks submission.
Limits: no generic research engine or automatic decision promotion.
Details: `research-continuation.md`.

## A11 — Bounded self-upgrade proposal
Outcome: evaluate one pinned candidate vs accepted baseline and either keep baseline or propose for review.
Requires: fixed protocol, independent evaluator, fixed scenarios/budget/rollback, `adoptionAuthority: false`.
Guarantees: durable attempt blocker; bounded retry/recovery; only `PROPOSE_FOR_REVIEW` submits; baseline remains selected pending acceptance.
Limits: no merge/deploy/rollout/self-modification/adoption authority.
Details: `self-upgrade.md`.

## A12 — Decision/outcome reconstruction
Outcome: materialize an immutable orientation summary over existing Core chain and re-verify exact source artifacts in a fresh review.
Requires: exact chain refs + resolver + immutable summary store.
Guarantees: relation validation, digest pins, summary ref in submission, fresh re-resolution/re-derivation.
Failure: missing/changed/stale source blocks materialization/reconstruction.
Limits: summary is not correctness evidence, action authorization or project acceptance.
Details: `decision-outcome.md`.

## Cross-layer rule

```text
Application declares WHAT semantic context/work is required
  -> Oracle resolves only those declared sources
  -> Core executes concrete Worker work and supplies
     evidence/trust/effect/recovery primitives
```

Application must not turn Oracle into workflow authority or Core into project lifecycle authority.
