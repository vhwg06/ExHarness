# Blackboard development artifacts

Blackboard artifacts are current semantic/decision/result/judgment work products used by the development pipelines.

## Canonical paths

Each current subject has one canonical file. Do not encode revision history in filenames with `vN` or `gNNNN`.

Examples:

```text
implementation-input/integration-c-cross-domain-obligation-lineage.json
implementation-spec/integration-c-cross-domain-obligation-lineage.json
readiness/BB-050.json
implementation-result/BB-050.json
judgment/BB-050.json
```

When the current artifact changes, update the canonical file in place. Git history preserves previous revisions.

## Retention

`current-only` applies to revisions of the same artifact subject; it does not mean `active-work-only`.

Closing a work item removes its `context/<WORK_ID>/current.json` and active routing entry, but does **not** delete its canonical delivery artifacts merely because the work became terminal. Accepted `IMPLEMENTATION_INPUT`, retained `IMPLEMENTATION_SPEC`, produced `IMPLEMENTATION_RESULT`, and recorded `JUDGMENT` remain addressable at their canonical paths. A later correction updates the same canonical file in place; it does not create a `vN` or `gNNNN` sibling.
Deleting a canonical delivery artifact requires an explicit semantic retirement/supersession reason; work completion alone is not such a reason.


## Separation

```text
IMPLEMENTATION_INPUT
  = WHAT / WHY / required behavior / invariants / acceptance

IMPLEMENTATION_SPEC
  = worker-ready HOW / source seams / implementation slices / negative tests / forbidden moves
  = retained by semantic subject
  != routing authority
  != work-id allocation authority

current.json
  = bounded helper context / refs / scope / verification

READINESS_DECISION
  = implementation entry authority

IMPLEMENTATION_RESULT
  = producer facts/evidence only

JUDGMENT
  = independent correctness assessment
```

Helper context identity is never embedded as authority/provenance.

## IMPLEMENTATION_RESULT

May state candidate identity, changed surfaces, verification runs, evidence and observed facts.

It cannot claim `ACCEPT`, `DONE`, correctness or safe-to-merge.

## JUDGMENT

Binds the exact work id, semantic input, implementation result, candidate and source baseline.

`ACCEPT` requires all assessments satisfied and zero findings. `FINDINGS` requires concrete findings.

Allowed finding types:

- `IMPLEMENTATION_FINDING`
- `EVIDENCE_INSUFFICIENT`
- `INPUT_CONTRADICTION`

There is no `CONTEXT_STALE` finding.

## Queue

This directory does not define queue membership. Current accepted unallocated inputs are named only by `docs/blackboard/state.md`.


## Implementation-spec identity

Implementation specs are keyed by semantic subject, not by mutable Blackboard routing ids.

A migrated spec may retain an `originWorkId` only in provenance. That id never reactivates work, consumes `next-work-id`, or becomes current routing authority. This avoids collisions when an old delivery work id was later reused by a different Research/SA item.

For an active implementation session:

```text
current.json
  -> IMPLEMENTATION_INPUT   # semantic authority / WHAT
  -> IMPLEMENTATION_SPEC    # worker-ready HOW
  -> current system refs
```

The worker may repair the implementation spec in place when current source seams change, but may not use that repair to change the semantic input or acceptance criteria.
