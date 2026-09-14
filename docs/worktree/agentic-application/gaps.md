# Agentic Application gaps

Only unresolved seams that matter to the current application layer. Implementation ordering is owned by `../pipeline.md`.

## WAVES A + B + C CHECKPOINT — CLOSED

Backend execution/trustworthiness plus Backend -> QA dependent work now run concretely in `packages/agentic-system/`.

### S7 second role — observed result

QA was selected because it pressure-tests Backend semantics with a dependent **non-mutating** role.

Observed comparison:

```text
Backend
  mutates candidate
  requires lineage promotion
  evidence: mutation + typecheck + tests
  may invoke bounded BackendAdvisor for semantic gaps

QA
  inspects accepted Backend revision
  mutation is forbidden
  lineage must not advance
  evidence: behavior + regression
  issues -> deterministic remediation/CONTINUE
```

Extraction result:

- shared `ApplicationArtifactRef`: yes;
- shared evidence integrity / claim-state plumbing: yes;
- generic Worker: no evidence strong enough;
- generic WorkOrder/WorkResult: no evidence strong enough;
- generic Advisor: no;
- generic Orchestrator/workflow framework: no.

This negative extraction result is intentional. A second role permits generalization; it does not require it.

### S8 artifact handoff / internal sources — observed result

Delivered flow:

```text
accepted Backend completion
 -> BackendQaHandoff
    producer work-order id
    accepted revision
    acceptance decision ref
    artifact refs only
 -> QaWorkOrder selects semantic artifact paths
 -> Oracle artifactReader dereferences required refs
 -> QaContext carries resolved payload + sourceRef + APPLICATION_ARTIFACT provenance
 -> QaWorker
```

External repository IO and internal application-artifact IO remain separate adapters/boundaries. Serializer remains outside dereference/IO.

## APPLICATION STATE / RESILIENCE — S9

Now open with real multi-work pressure:

- what minimal durable state is needed for Backend accepted -> QA pending/running/completed;
- which result/artifact/decision refs survive restart;
- retry semantics when QA reports issues after accepted Backend work;
- block/cancel/resume semantics across the two stages;
- how application state composes with ExHarness interrupted-variation recovery;
- how artifact lookup failures/retries compose without duplicating Core effect/recovery authority.

Constraint:

```text
Application workflow state
    != ExHarness runtime/persistent state
    != artifact storage
    != Oracle source/cache state
```

## PRODUCTION EVALUATION / GENERALIZATION — S10

Open:

- task success across Backend -> QA;
- false completion rate at both role boundaries;
- artifact handoff correctness;
- context precision/cost for repository vs internal artifacts;
- QA issue/remediation rate;
- Advisor invocation/value-add;
- recovery correctness;
- whether another real role changes the current negative generic-Worker judgment.

## NON-GOALS UNTIL PROVEN

- group-chat architecture;
- shared global conversation state;
- model-selected Worker handoff;
- generic Crew/Team framework;
- dynamic role registry;
- workflow graph DSL;
- generic Worker/WorkOrder/Advisor contracts without stronger repeated semantics;
- application-owned model/session/runtime loop;
- concrete Blackboard storage/claim/lease/event protocol without separate grounding.
