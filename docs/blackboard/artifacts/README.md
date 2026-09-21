# Blackboard task artifacts

The canonical task artifact tree has exactly two directories:

```text
docs/blackboard/artifacts/objective/
  BB-<id>.json              # current OBJECTIVE input
  BB-<id>.source.json       # retained source evidence, when migration needs it

docs/blackboard/artifacts/ready-implement-plan/
  BB-<id>.json              # current READY_IMPLEMENT_PLAN
  BB-<id>.source.json       # retained legacy plan/spec evidence
  BB-<id>.readiness-jev-evaluation.json
  BB-<id>.candidate-jev-evaluation.json
  BB-<id>.implementation-result.json
  BB-<id>.judgment.json      # retained terminal evidence, when applicable
```

There are no canonical `implementation-input/`, `implementation-spec/`, `implementation-result/` or `judgment/` directories. Those names belonged to the previous multi-lane layout. Retained terminal evidence is co-located under the task's ready-plan directory so current routing has one path vocabulary.

The active contract is:

```text
OBJECTIVE
  -> RESEARCH_SA
  -> READY_IMPLEMENT_PLAN
  -> WORKER
  -> DELIVERED_FEATURE
```

Only the unsuffixed `objective/BB-<id>.json` and `ready-implement-plan/BB-<id>.json` files are current lane inputs. `.source.json`, `.implementation-result.json` and `.judgment.json` files are retained evidence; they are never discovered or selected by scanning. The graph binds every active task to its exact current refs.

When a current artifact changes, update that canonical file in place. A content hash in the graph/evaluation binding detects a same-path replacement. Git retains revision history; no `vN`, `gNNNN` or parallel legacy directory is created.

`current-only` means terminal evidence is retained, while routing remains current-only. Completing a task removes its active context but does not remove the canonical evidence kept under these two directories.

`OBJECTIVE` owns outcome, problem, scope, constraints and success criteria. `READY_IMPLEMENT_PLAN` owns architecture decisions, invariants, source seams, authorized write scope, implementation slices, atomic acceptance criteria and verification. The plan is not executable until Jev readiness is satisfied. Worker evidence and Jev evaluation are bound to the exact plan and candidate; they cannot redefine upstream semantics.

The artifact validator rejects any direct subdirectory below `docs/blackboard/artifacts/` other than `objective` and `ready-implement-plan`. This keeps the filesystem shape aligned with the two outer lanes rather than preserving historical routing names.
