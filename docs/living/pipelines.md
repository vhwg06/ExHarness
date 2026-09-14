# Accepted living pipelines

Status: **PROMOTED**

Decision: `decisions/D001-living-docs-authority.md`

This document owns the accepted work-coordination and knowledge-promotion lifecycles.

## Session work pipeline

Every non-trivial session follows:

```text
READ docs/living/blackboard.md
  -> identify eligible READY/REOPENED work
  -> CLAIM one item
  -> load only the context needed for that item
  -> execute
  -> verify/evaluate
  -> WRITE BACK result + refs + blockers + discoveries
  -> DONE | BLOCKED | READY
  -> create new board items for newly exposed work
```

The next session starts from the updated board, not from an unconstrained fresh plan.

Example:

```text
A READY
B READY
C READY

session-1 claims A
A CLAIMED
B READY
C READY

session-1 resolves A
A DONE
B READY
C READY

session-2 may choose B or C; A is no longer eligible.
```

This is the core Blackboard coordination property.

## Board transitions

```text
READY    -> CLAIMED
REOPENED -> CLAIMED
CLAIMED  -> DONE
CLAIMED  -> BLOCKED
CLAIMED  -> READY
BLOCKED  -> READY      when blocker is resolved
DONE     -> REOPENED   only with explicit reopening evidence
```

Dependency eligibility is evaluated from board state. A worker must not claim an item whose required dependencies are unresolved.

## Candidate-to-promotion lifecycle

Work completion and knowledge promotion are different.

```text
DRAFT
  -> PROPOSED
  -> SUPPORTED
  -> AUDITED
  -> ACCEPTED
  -> PROMOTED
```

A session boundary does not advance this lifecycle by itself.

### DRAFT
Private or rough working material. No authority.

### PROPOSED
Explicit candidate with motivation, assumptions, unknowns and scope.

### SUPPORTED
Material evidence supports the candidate, but contradiction/alternatives may remain.

### AUDITED
Independent challenge appropriate to impact has been applied. `AUDITED` does not mean correct.

### ACCEPTED
A decision boundary has accepted the conclusion/choice.

### PROMOTED
The accepted choice has been materialized into the relevant authority surface.

## Side transitions

```text
PROPOSED  -> REJECTED
SUPPORTED -> CONTRADICTED
AUDITED   -> PROPOSED
ACCEPTED  -> SUPERSEDED
PROMOTED  -> SUPERSEDED -> reconciliation
```

## Evidence and promotion flow

```text
Blackboard work result / discovery
  -> evidence record
  -> judgment
  -> audit/challenge
  -> decision
  -> promotion
```

A judgment may remain unresolved for any number of sessions. Convergence is measured by evidence and acceptance, not elapsed turns.

## Reconciliation flow

```text
runtime/source evidence contradicts promoted view
  -> evidence: CONTRADICTED
  -> judgment reopened
  -> affected DONE board item may become REOPENED when necessary
  -> audit/decision as needed
  -> promoted view corrected or superseded
```

## Product delivery pipeline

`../worktree/pipeline.md` records the larger Agentic System delivery ordering. `blackboard.md` is the operational projection that tells the next worker which concrete pieces of that pipeline are already resolved, active, blocked or eligible.

The worker reads the Blackboard first, then uses the worktree pipeline as supporting context for the claimed item.
