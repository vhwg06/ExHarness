# Accepted knowledge pipelines

Status: **PROMOTED**

Decision: `decisions/D001-living-docs-authority.md`

This document owns accepted knowledge-lifecycle semantics. Product delivery sequencing remains in `../worktree/pipeline.md` until a later migration changes that structure.

## Candidate-to-promotion lifecycle

```text
DRAFT
  -> PROPOSED
  -> SUPPORTED
  -> AUDITED
  -> ACCEPTED
  -> PROMOTED
```

A session boundary does not advance this state machine by itself.

### DRAFT

Private or rough working material. No authority.

### PROPOSED

Explicit candidate with motivation, assumptions, unknowns and scope. Still no desired-state authority.

### SUPPORTED

Material evidence supports the candidate, but contradiction/alternatives may remain.

### AUDITED

The candidate/judgment has received independent challenge appropriate to its impact. `AUDITED` does not mean correct.

### ACCEPTED

A decision boundary has accepted the conclusion/choice. It may now guide work.

### PROMOTED

The accepted choice has been materialized into the relevant durable authority surface.

## Side transitions

```text
PROPOSED  -> REJECTED
SUPPORTED -> CONTRADICTED
AUDITED   -> PROPOSED       when challenge requires redesign
ACCEPTED  -> SUPERSEDED     when later evidence/decision replaces it
PROMOTED  -> SUPERSEDED     followed by reconciliation of materialized views
```

## Evidence flow

```text
observation
  -> evidence record
  -> judgment
  -> audit/challenge
  -> decision
  -> promotion
```

A judgment may remain unresolved for any number of sessions. Convergence is measured by evidence and acceptance, not elapsed turns.

## Reconciliation flow

Promoted docs are current accepted models, not immutable truth.

```text
runtime/source evidence contradicts promoted view
  -> evidence: CONTRADICTED
  -> judgment reopened
  -> audit/decision as needed
  -> promoted view corrected or superseded
```

## Coordination flow

The runtime coordination plane is intentionally separate:

```text
agent/session
  -> observe relevant Blackboard state
  -> claim/execute according to the eventual coordination contract
  -> emit progress/discovery/artifact refs
  -> evaluation/reflection produces candidate durable knowledge
  -> promote only through the knowledge lifecycle above
```

The exact Blackboard runtime contract is not yet promoted.

## Product delivery pipeline

`../worktree/pipeline.md` remains the accepted current delivery ordering for Agentic Application + Oracle + ExHarness Core work. Its order can guide implementation without making every stage-local design sketch an accepted architecture component.
