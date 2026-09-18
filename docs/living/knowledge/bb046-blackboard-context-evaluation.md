# BB-046 — Blackboard context evaluation plan

Status: **PROPOSED / EVALUATION CANDIDATE**

The Blackboard Context Plane is justified only if it improves delivery while preserving or strengthening correctness/authority boundaries.

This document defines how to falsify the proposal.

## 1. Hypothesis

Compared with the current heuristic:

```text
read Board
-> worker decides "smallest relevant docs"
-> inspect source
```

an explicit context plane should:

1. reduce irrelevant context loading;
2. reduce wrong-scope implementation;
3. improve fresh-session reproducibility;
4. preserve exact underlying-source verification;
5. add less coordination overhead than the rework it prevents.

## 2. What BB-028 does and does not prove

BB-028 already provides one useful signal:

- current bounded handoff: 623 context chars, zero correctness answers without underlying reads;
- raw full graph: 3,967 chars plus multiple artifact reads;
- bounded summary can improve orientation but correctness still depends on exact underlying artifacts.

That is **not** direct evidence that `WORK_CONTEXT_SPEC` is valuable. It only supports two design constraints:

```text
bounded orientation can be cheaper
copied summary/context must not become correctness evidence
```

BB-046 needs its own benchmark.

## 3. Baseline modes

Evaluate at least:

### A. Current heuristic

```text
Blackboard
-> worker selects relevant docs/source
```

### B. Raw/full graph

Worker receives all plausible living/worktree/research refs for the item.

### C. Explicit context

```text
Blackboard
-> exact WORK_CONTEXT_SPEC
-> required refs/source only
-> lazy audit on demand
```

## 4. Representative scenarios

### Scenario 1 — independent BB-046 readiness review

Question:

Can a fresh reviewer identify the A.1 trust-transition blockers, exact source seams and non-goals without prior conversation?

### Scenario 2 — accepted A.1 implementation handoff

Question:

Can a fresh implementation worker mutate only the accepted slice, without implementing Integration B or turning Restate into organization control?

### Scenario 3 — source drift

Change one named source seam after context generation.

Expected:

```text
explicit context detects stale subject / requires regeneration
```

### Scenario 4 — irrelevant source drift

Change an unrelated file.

Expected:

```text
context remains usable
```

### Scenario 5 — missing required accepted decision

Implementation context exists without exact acceptance decision ref.

Expected:

```text
fail closed
```

### Scenario 6 — audit-only loss

Remove one optional audit ref.

Expected:

```text
normal implementation path still works unless challenge requires that ref
```

### Scenario 7 — scope discovery

Worker discovers one additional semantic source path outside write scope.

Expected:

```text
no silent durable mutation
new context generation before scope expansion
```

### Scenario 8 — fresh session

Delete all conversation state and restart reviewer/worker.

Expected:

```text
same safe next action reconstructed from Board + context + refs
```

### Scenario 9 — stale generation

Worker starts from g1 while Board has advanced to g2.

Expected:

```text
g1 rejected for new durable action
```

### Scenario 10 — misleading historical research

Place a rejected alternative in `auditRefs`.

Expected:

```text
worker does not treat it as required implementation input
```

## 5. Metrics

Capture:

```text
orientation input chars/tokens
number of files/artifacts loaded before first correct action
number of lazy audit reads
time-to-first-correct-action
required-ref omission count
irrelevant-read count
wrong-scope mutation count
chat-only dependency count
stale-context escapes
review reopen count caused by context misunderstanding
context generation count
context-generation overhead
```

For implementation runs also capture:

```text
verification pass/fail
source paths touched
paths outside declared write scope
rework/remediation count
```

## 6. Hard acceptance criteria

Regardless of efficiency, the candidate fails if any evaluated explicit-context run:

```text
uses prior conversation as required input
self-authorizes implementation from research acceptance
mutates outside declared source scope without regeneration
accepts stale context generation
treats audit/history prose as correctness authority
lets context producer fabricate acceptance authority
requires putting work-product payloads into Blackboard
turns Context Resolver into scheduler/coordinator
```

Fresh-session deterministic fixtures must have zero escapes for the above controls.

## 7. Delivery/value criteria

Before implementation promotion, freeze a benchmark budget against the measured baseline rather than choosing thresholds after seeing results.

At minimum:

```text
correctness/authority controls: no regression vs baseline
fresh-session completion: no regression
irrelevant reads: must improve on representative scenarios
wrong-scope mutations: must improve or remain zero
total context-management overhead: must not erase the saved orientation/rework cost
```

If explicit context requires nearly the same raw graph reads for ordinary work, the architecture has not earned its complexity.

## 8. Architecture tripwires

Pause promotion and reopen architecture research if:

```text
context generations churn on unrelated commits
most workers still need full audit graph
context specs become long architecture narratives
Board begins duplicating context payloads
context producers routinely invent missing authority
source scope blocks normal work more often than it prevents wrong changes
workers bypass context because regeneration is too expensive
context state becomes another lifecycle system
```

## 9. Evaluation artifacts

A future implementation/research probe should produce:

```text
artifacts/bb046-blackboard-context-eval.json
docs/living/knowledge/bb046-blackboard-context-eval.md
```

Expected evidence class initially:

```text
DETERMINISTIC_REPOSITORY_FIXTURE
productionEvidence: false
```

## 10. Promotion rule

A positive benchmark may justify a bounded context-plane implementation.

It does **not** automatically justify:

- a generic context service;
- automatic LLM context generation;
- runtime adoption for every Blackboard consumer;
- replacing Oracle/session-handoff/WorkContract semantics.
