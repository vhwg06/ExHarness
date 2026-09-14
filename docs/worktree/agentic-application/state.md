# Agentic Application convergence state

Durable convergence material for the application layer above ExHarness Core and beside Oracle infrastructure.

This subtree is **not automatic desired-state authority**. Read `../README.md` and `../../living/contracts.md` before treating future component shapes as accepted architecture.

## ACCEPTED PURPOSE / OWNERSHIP

The Agentic Application Layer owns what work exists, how work is decomposed, which specialist role executes it, what semantic context that role requires, what structured result is expected and when application work is complete.

Current accepted ownership direction:

- Application owns Objective, role/work semantics, required semantic context, result/completion semantics and deterministic workflow control.
- Orchestrator owns dispatch/application workflow state and remains deterministic where next actions are known.
- Advisor supplies bounded judgment only where planning/assessment/replanning is genuinely needed.
- Worker owns one specialist execution responsibility and returns machine-inspectable role-specific result state.
- Oracle resolves/dereferences application-defined context; it does not decide what context a role should need.
- ExHarness owns agent/runtime execution mechanics, cognition, evidence/trust and recovery/lifecycle primitives.

Names above describe accepted responsibilities. They do not imply that every future interface/service shape already exists or is promoted.

## OBSERVED CHECKPOINT — WAVES A + B + C

The concrete application in `packages/agentic-system/` now includes two different specialist roles:

```text
BackendObjective
 -> BackendWorkOrder
 -> BackendWorker (mutating)
 -> grounded Backend completion
 -> BackendQaHandoff refs
 -> QaWorkOrder
 -> QaWorker (non-mutating)
 -> grounded QA completion
```

Wave A established concrete Backend execution and direct deterministic composition. Wave B established Backend-specific evidence/completion and the narrow BackendAdvisor judgment boundary.

Wave C established:

- QA is the second real role and consumes only an accepted Backend revision;
- QA has its own Objective/WorkOrder/Context/WorkResult/completion semantics;
- QA cannot invoke environment mutation or advance lineage;
- QA evidence is `qa.behavior` + `qa.regression`, not Backend mutation/typecheck/tests semantics;
- QA issues deterministically produce `CONTINUE` for remediation rather than borrowing Backend completion behavior;
- `ApplicationArtifactRef` is a proven common shape because Backend produces it and QA consumes/inspects it;
- evidence artifact integrity and required-claim state are shared plumbing after appearing in both completion policies;
- a generic Worker/WorkOrder/Orchestrator remains unjustified because Backend and QA lifecycle/authority differ materially;
- concrete `runBackendThenQaObjective(...)` composes the two roles without a workflow framework;
- QA is gated on accepted Backend completion.

These are observed implementation facts. The broader judgment that no generic Worker should yet be promoted is recorded in living knowledge as `SUPPORTED`, not `ACCEPTED/PROMOTED` merely by this worktree update.

## ACTIVE CANDIDATE CONVERGENCE — WAVE D

Implementation ordering follows `../pipeline.md`.

```text
S9 multi-work application state
   -> retry / block / resume / recovery pressure
   -> compose with Core recovery/effect boundaries

S10 evaluate Backend + QA + handoff
   -> measure success / false completion / context cost / handoff correctness
   -> generalize only repeated semantics supported by evidence
```

Do not introduce a generic workflow graph, role registry, claim manager or Blackboard runtime contract simply because two work items now exist. S9 must first expose the minimum durable application state actually required.

## ROUTING

- semantic meaning of roles/control -> `semantics.md`
- candidate layer/component boundaries -> `architecture.md`
- authority/dependency bounds -> `boundaries.md`
- candidate execution topology -> `workflow.md`
- concrete-first extraction policy -> `contracts.md`
- prior accepted/working constraints -> `decisions.md`
- unresolved application seams -> `gaps.md`
- implementation order -> `../pipeline.md`
- promotion rules -> `../../living/README.md`
