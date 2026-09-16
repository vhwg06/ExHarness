# D008 — Blackboard authority is scoped by explicit project identity

Status: **PROMOTED**

Promoted: 2026-09-16

Promotion boundary: BB-015 implemented project-bound session handoff on PR #80 and exact-head application/session-handoff review plus CI confirmed the boundary. Promotion does not claim Markdown/JSON convergence, distributed coordination or repository self-hosting.

## Question

Should ExHarness immediately converge the repository Markdown Blackboard and the JSON-backed runtime Blackboard into one stored representation, or first make their project authority explicit?

## Decision

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

A handoff-safe runtime Board carries a stable project identity separate from filesystem path, session identity and user-intent content.

```text
project id
!= store path
!= session/owner id
!= WorkOrder/item id
!= user-intent id
```

The project-bound session-handoff path persists this identity on the durable `USER_INTENT_ROOT`, exposes it in the handoff projection and fails closed when a caller expects another project.

An unbound legacy reader cannot silently open a project-bound Board, and a project-bound reader cannot silently upgrade a legacy Board that has no project identity.

User intent remains the durable objective root **inside** the project; it does not replace project identity.

## Legacy boundary

Low-level/legacy Board snapshots remain usable where project-identity handoff safety is not claimed. They are not silently upgraded by guessing project identity from path, task text or user intent.

Project identity belongs to Board/root authority. It is not copied into every work-item origin; work provenance continues to describe root-intent, parent and finding lineage independently.

## Repository projection

This decision does not make Markdown a runtime store and does not make JSON the canonical ExHarness repository Board.

If ExHarness later self-hosts its own repository project through `ApplicationOrchestrator`, the same project must have one writable canonical lifecycle representation. The preferred convergence candidate is then machine-readable canonical state plus a generated/read-only Markdown projection, but that requires separate evidence and implementation for:

- one-time migration;
- project/mutation revision or digest;
- optimistic conflict/stale-write detection;
- deterministic projection with source revision;
- preservation of IDs, intent provenance, dependencies, checkpoints, submissions, reviews and refs.

Bidirectional writable Markdown↔JSON synchronization is not acceptable.

## Consequences

- a fresh project-bound session can verify it opened the intended runtime project before continuing work;
- legacy unbound compatibility remains explicitly outside project-identity handoff safety;
- current repository coordination remains source-backed truth rather than being retroactively labeled a projection of a JSON file that does not exist;
- later self-hosting has an explicit migration trigger instead of accidental dual authority;
- no project-state registry or Markdown/JSON synchronization is introduced by this decision.

## Evidence

- `packages/agentic-system/src/session-handoff.js` project-bound root/read semantics;
- `packages/agentic-system/test/project-identity.test.js` same-project resume and fail-closed mismatch/legacy contracts;
- `docs/worktree/agentic-application/state.md` current source projection;
- `docs/worktree/agentic-application/contracts.md` current contract projection;
- `docs/worktree/agentic-application/decisions.md` promoted current decision;
- `packages/agentic-system/src/blackboard-orchestrator.js` durable Board/store semantics;
- current in-repository JSON-store usage in application tests/evaluation uses caller-selected temporary paths;
- BB-014 research artifact `../knowledge/bb014-project-state-authority.md`;
- PR #78 post-merge Markdown lifecycle lag as evidence of manual repository reconciliation pressure, not JSON/Markdown divergence;
- PR #80 exact-head CI including Node 20/22/24 and living-doc-impact gate.

## What would change this decision

Reopen when a concrete project is intentionally represented by both executable JSON state and a repository-readable Markdown view, or when a remote/multi-writer store requires stronger canonical revision semantics.
