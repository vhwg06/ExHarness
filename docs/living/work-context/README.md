# Blackboard work-context candidates

Status: **PROPOSED / BB-046 RESEARCH SURFACE**

This directory contains immutable candidate context generations for active Blackboard items.

It is not a work queue and not lifecycle authority.

Currentness must come from the Blackboard's exact context ref/generation after the BB-046 context architecture is accepted. Until then, files here are reviewable examples only.

## Shape

```text
work-context/
  BB-046/
    g0001-readiness-review.md
    g0002-implementation.md
```

Rules proposed by BB-046:

- never mutate one generation into another semantic action;
- keep payloads/ref targets external;
- required inputs and audit inputs are distinct;
- source write scope is explicit;
- context artifacts never self-authorize Board currentness;
- old generations remain history, not current permission.
