# Audit

Audit is independent challenge against material architecture, pipeline, contract, evidence, judgment or artifact claims.

An audit finding is not automatically truth.

Use this shape:

```text
A-XXX
status: OPEN | RESOLVED | SUPERSEDED
subject-ref: <judgment / decision / artifact / promoted doc>
challenge: <what is being challenged>
evidence-reviewed: []
contradictions: []
missing-evidence: []
result: <sustain / weaken / reopen / reject / unresolved>
follow-up: []
```

Typical flow:

```text
audit finding
  -> contradiction or evidence need
  -> judgment reconsideration
  -> decision when warranted
  -> reconciliation/promotion
```

Audit is intentionally separate from the authoring path when material independence is needed.
