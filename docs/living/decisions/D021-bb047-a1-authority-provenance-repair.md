# D021 — Authorize BB-047 A.1 authority-provenance repair

Status: **ACCEPTED REPAIR AUTHORIZATION**

Accepted for bounded repair: 2026-09-19

## Decision subject

```text
subjectContextRef: docs/living/work-context/BB-047/g0011-repair-review.json
subjectCandidateHeadSha: 1e5cc2297322f7b2da7e21a6a874cf776d325dcc
verdict: ACCEPT
reviewEvidence: 5256017957
acceptedAction: REIMPLEMENT_WITH_VALID_AUTHORITY_PROVENANCE
```

The g0011 review rejected candidate acceptance because its code repaired D020 semantics under invalid authority provenance. The semantic repair itself is not accepted as delivered source.

## Historical generations

D020 remains the immutable REJECT decision for g0009. g0010 remains malformed/rejected implementation history and MUST NOT authorize source. g0011 remains immutable rejected review history.

## Authorized repair

A new implementation generation may reproduce the already-reviewed D020 semantic repair only when:

1. this D021 decision already exists before implementation begins;
2. the new immutable implementation context binds D021 before any source mutation;
3. its exact write scope includes `packages/agentic-system/src/organization-work.js` plus the other source/test/projection files required by the D020 repair;
4. D020, g0010 and g0011 are not mutated to manufacture authority retrospectively;
5. the resulting source candidate receives a new independent review.

No DONE, merge, terminal Blackboard transition, DOMAIN_EXECUTION_CONTROL or Integration B is authorized.
