# D008 — Blackboard authority is scoped by explicit project identity

Status: **PROPOSED**

Proposed: 2026-09-16

## Question

Should ExHarness immediately converge the repository Markdown Blackboard and the JSON-backed runtime Blackboard into one stored representation, or first make their project authority explicit?

## Proposed decision

A Blackboard is canonical only within one explicit project identity.

Current ExHarness evidence does not show Markdown and JSON as two active writers of the same project. The repository Markdown Board coordinates development of ExHarness itself. Current in-repository JSON-store instantiations are tests/evaluation using caller-selected temporary paths; the public store API allows a caller-selected runtime path, but this repository does not yet demonstrate an external production consumer.

Therefore the immediate architecture is:

```text
repository development project
  -> docs/living/blackboard.md is its current canonical coordination state

runtime consumer project
  -> one explicitly identified JSON Blackboard store is its canonical executable lifecycle state
```

Do not synchronize these surfaces merely because both use the word Blackboard.

## Runtime project identity

A handoff-safe runtime Board must carry a stable project identity separate from filesystem path, session identity and user-intent content.

```text
project id
!= store path
!= session/owner id
!= WorkOrder/item id
!= user-intent id
```

The session-handoff path must expose that identity and fail closed when a caller expects another project.

User intent remains the durable objective root **inside** the project; it does not replace project identity.

## Legacy boundary

Low-level/legacy Board snapshots may remain usable where handoff safety is not claimed. They must not be silently upgraded by guessing project identity from path, task text or user intent.

## Repository projection

This decision does not make Markdown a runtime store and does not make JSON the canonical ExHarness repository Board.

If ExHarness later self-hosts its own repository project through `ApplicationOrchestrator`, the same project must have one writable canonical lifecycle representation. The preferred convergence candidate is then machine-readable canonical state plus a generated/read-only Markdown projection, but that requires separate evidence and implementation for:

- one-time migration;
- project/mutation revision or digest;
- optimistic conflict/stale-write detection;
- deterministic projection with source revision;
- preservation of IDs, intent provenance, dependencies, checkpoints, submissions, reviews and refs.

Bidirectional writable Markdown↔JSON synchronization is not acceptable.

## Consequences if accepted

- BB-015 can implement project identity without premature storage migration;
- a fresh session can verify it opened the intended runtime project before continuing work;
- current repository coordination remains source-backed truth rather than being retroactively labeled a projection of a JSON file that does not exist;
- later self-hosting has an explicit migration trigger instead of accidental dual authority.

## Evidence

- `packages/agentic-system/src/blackboard-orchestrator.js`
- `packages/agentic-system/src/session-handoff.js`
- current in-repository JSON-store usage in application tests/evaluation uses caller-selected temporary paths;
- `docs/living/blackboard.md` current Storage boundary;
- BB-014 research artifact `../knowledge/bb014-project-state-authority.md`;
- PR #78 post-merge Markdown lifecycle lag as evidence of manual repository reconciliation pressure, not JSON/Markdown divergence.

## What would change this decision

Reopen when a concrete project is intentionally represented by both executable JSON state and a repository-readable Markdown view, or when a remote/multi-writer store requires stronger canonical revision semantics.
