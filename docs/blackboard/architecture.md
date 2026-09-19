# Living documentation architecture

Status: **PROMOTED**

The repository uses two complementary operational documentation surfaces plus executable artifacts.

```text
SOURCE / TESTS / RUNTIME
        |
        | reconcile current behavior
        v
+-------------------------------+
| docs/worktree/*               |
| SOURCE-SYNCHRONIZED LIVING DOCS|
| current state/architecture/   |
| semantics/contracts/workflow  |
+-------------------------------+

unresolved gap/problem discovered
        |
        v
+-------------------------------+
| docs/living/blackboard.md     |
| OPERATIONAL OPEN WORK         |
| claim / status / blockers /   |
| result / artifact refs        |
+-------------------------------+
        |
        | work resolves + source changes
        +-----------> reconcile living docs
```

Durable evidence/judgment/audit/decisions remain under `docs/living/knowledge/` and `docs/living/decisions/`.

## Authority by question

```text
What exists / executes?          source + tests/runtime
What is the current system model? docs/worktree/*
What remains unresolved?         docs/living/blackboard.md
Why is a conclusion believed?    living/knowledge/evidence + judgment
What was accepted/promoted?      living/decisions + promoted contracts
```

The Blackboard is not a future runtime component. It is the current shared work surface. Worktree docs are not candidate/design scratchpads; they are materialized current-state documentation.
