# D004 — Blackboard is the durable session-handoff boundary

Status: **PROMOTED**

Accepted at: 2026-09-16

Acceptance boundary: repository owner explicitly defined cross-session handoff as an ExHarness objective.

## Decision

A project lifecycle must outlive any individual model/agent/chat session.

```text
session != project lifecycle
```

The Blackboard is the canonical work-lifecycle tracker and the handoff boundary between sessions.

A fresh session must be able to continue from:

```text
Blackboard
+ referenced artifacts/evidence
```

without depending on previous conversation state, hidden agent memory or another session's unpersisted reasoning.

## User intent root

Project intent originates from the user.

```text
User
 -> idea / objective / bullets / constraints
 -> durable UserIntent root on the Blackboard
```

PM may later manage/decompose/sequence work around that intent, but PM does not invent the root objective.

Every handoff-safe work item must trace to the durable user intent directly or transitively through grounded follow-up provenance.

## Tracker vs artifacts

The Blackboard remains a work tracker.

It stores lifecycle state and references such as:

```text
work
status
owner / claim
dependencies
remaining work
blockers
submission
review state
artifact refs
evidence refs
follow-up provenance
```

Actual work products remain external durable artifacts and are dereferenced when a later session needs detail.

```text
Blackboard tracks the work.
Artifacts hold the work products.
```

## Session handoff

A fresh session handoff must expose enough durable state to answer:

```text
What is the user's objective?
What work exists?
What can run now?
What is already claimed?
What is pending review/reconciliation?
What is blocked or done?
Which artifact/evidence refs must be resolved to continue?
```

A Board without a durable user-intent root must fail closed as not handoff-safe rather than inferring project intent from a task list.

## Non-goals

This decision does not introduce:

- a generic workflow DSL;
- PM or SA runtime implementations;
- a Reviewer/Teacher registry;
- universal context storage in the Blackboard;
- conversation history as project state.

## Promotion targets

- `../contracts.md`
- `../blackboard.md`
- `../../worktree/agentic-application/state.md`
- `../../worktree/agentic-application/workflow.md`
- `../../../packages/agentic-system/src/session-handoff.js`
