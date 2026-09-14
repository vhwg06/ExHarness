# Evidence

Evidence records observations. They do not contain the conclusion that should be drawn from those observations.

Use this shape for material entries:

```text
E-XXX
status: OBSERVED | PARTIAL | CONFIRMED | CONTRADICTED | STALE | SUPERSEDED
source/provenance: <artifact / run / source / decision ref>
observation: <what was actually observed>
supports: [judgment ids]
does-not-establish: [claims this observation cannot prove]
contradicts: [judgment/evidence ids]
```

Rules:

- provenance is required for material claims;
- a few examples do not establish a universal property;
- model prose or a prior judgment is not raw evidence;
- executable/runtime evidence can contradict promoted docs and trigger reconciliation;
- stale evidence remains traceable but must not be treated as current.

No project-specific evidence entries are added by the living-doc architecture migration merely to make the ledger look populated.
