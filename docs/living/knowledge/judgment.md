# Judgment

Judgments are conclusions derived from evidence. They may remain unresolved across many sessions.

Use this shape:

```text
J-XXX
status: DRAFT | PROPOSED | SUPPORTED | AUDITED | ACCEPTED | REJECTED | CONTRADICTED | SUPERSEDED
claim: <conclusion>
derived-from: [evidence ids]
assumptions: []
alternatives: []
contradictions/risks: []
confidence: <bounded statement, not fake precision>
missing-evidence: []
what-would-change-it: []
```

A judgment must not promote itself. `ACCEPTED` requires an explicit decision boundary. `PROMOTED` is represented by the resulting decision plus mutation of the appropriate durable authority view.
