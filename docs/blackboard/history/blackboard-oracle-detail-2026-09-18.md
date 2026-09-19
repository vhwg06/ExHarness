# Oracle-detail Blackboard archive — 2026-09-18

Status: **TERMINAL / ARCHIVED**

This file preserves the complete active Oracle-detail coordination surface at phase closure. The phase contained three terminal items, all `DONE`, and zero non-terminal work. Current source-backed behavior lives under `docs/worktree/*`; the closure rationale lives in `../knowledge/oracle-detail-closure-2026-09-18.md`.

This archive is history, not an active work queue. Re-entry requires new grounded evidence or explicit user intent and must create/reopen work on the current Blackboard rather than mutating this file.

# Archived Oracle-detail board

## Phase

```text
phase: ORACLE_DETAIL
started: 2026-09-18
previous-board-archive: docs/living/history/blackboard-pre-oracle-detail-2026-09-18.md
previous-phase-closure: docs/living/knowledge/pre-oracle-detail-blackboard-closure-2026-09-18.md
previous-terminal-count: 42
previous-done-count: 38
previous-superseded-count: 4
current-phase-closure-scan: docs/living/knowledge/oracle-detail-closure-2026-09-18.md
current-active-debt: 0
next-work-id: BB-046
```

The previous coordination phase is fully terminal and archived. Historical items are not copied into this active surface.

## Active work

```text
BB-045
question/work: Integrate manifest-protected Backend -> QA continuation so exact producer manifest durability precedes QA_PENDING and publication failure resumes through Backend/Core recovery rather than fresh effect execution.
kind: IMPLEMENTATION
priority: P1
status: DONE
owner:
depends-on: [BB-044]
remaining-work: []
acceptance-criteria:
  - direct-reader workflows are byte-for-byte semantically compatible
  - protected QA_PENDING cannot exist without exact artifactManifestRef
  - publisher failure never dispatches QA and resume does not call fresh Backend execute
  - crash/orphan manifest before Board checkpoint can be re-published idempotently during Core-backed recovery
  - fresh QA resolution is scoped to the exact persisted manifest ref
  - missing/changed payload after QA_PENDING remains QA/source blocking and never becomes Backend replay authority
submission:
  - PR #136
review-requirements: [application/code review, Oracle architecture-boundary review, crash-recovery review]
reviews:
  - application/code review PASS on exact head 93d7bc79d5d237aa64fc2be146be18bffa6614b0
  - Oracle architecture-boundary review PASS on exact head 93d7bc79d5d237aa64fc2be146be18bffa6614b0
  - crash-recovery review PASS on exact head 93d7bc79d5d237aa64fc2be146be18bffa6614b0
artifact-refs:
  - docs/living/knowledge/bb044-manifest-publication-boundary.md
  - docs/worktree/oracle/artifact-manifest.md
  - packages/agentic-system/src/artifact-manifest.js
  - packages/agentic-system/src/durable-backend-qa.js
  - packages/agentic-system/test/bb045-manifest-protected-workflow.test.js
evidence-refs:
  - BB-044
  - D014
  - Actions #2101 green on living-doc-impact and Node 20/22/24
  - application/code review id 5245016965
  - Oracle architecture-boundary review id 5245017203
  - crash-recovery review id 5245017399
  - merge commit 2649986280b3e2a98c27fded346b5dd5b5855f4d
  - concurrency remediation PR #140 exact head 3931a3262a3411cf0437fbbd4c72f114c92f96ea
  - concurrency/storage review id 5245076636
  - remediation Actions #2122 green on living-doc-impact and Node 20/22/24
  - remediation merge commit 1d36ce696845227fa4f44eb857cf5c5b316bf90a
  - durable-receipt recovery remediation PR #144 exact head 9f5e2d457ab3e130728b51383d501fdbcc2b9c28
  - receipt-first recovery Actions #2147 green on living-doc-impact and Node 20/22/24
  - receipt-first application/code review id 5245261556
  - receipt-first crash-recovery review id 5245261861
  - receipt-first Oracle architecture-boundary review id 5245262130
  - receipt-first remediation merge commit f56ae2af3bc5cba59be9d076829b0476a0f88cfa
  - acceptance-semantic recovery remediation PR #148 exact head c11d9fc81df606aebb1ad6776df10581174428af
  - acceptance-semantic recovery Actions #2175 green on living-doc-impact and Node 20/22/24
  - acceptance-semantic application/code review id 5245398758
  - acceptance-semantic Oracle architecture-boundary review id 5245399062
  - acceptance-semantic crash-recovery/trust-provenance review id 5245399328
  - acceptance-semantic remediation merge commit 4db3457418836ec7a305f388d20626ddeea41abb
blockers: []
follow-up-refs: []
origin: BB-044 accepted implementation handoff
```

```text
BB-044
question/work: Research the durable publication/recovery boundary required to compose the optional D014 artifact manifest with Backend -> QA without exposing QA before trusted manifest state exists or replaying Backend effects after interruption.
kind: RESEARCH
priority: P1
status: DONE
owner:
depends-on: [BB-043]
research-hypothesis: The current optional manifest primitives need an application-owned publication checkpoint between Backend ACCEPT and QA_PENDING; that boundary must remain producer-side, crash-safe and effect-aware without turning Oracle into workflow authority.
target-consumer: createDurableBackendQaWorkflow accepted-Backend transition
implementation-output: Accepted narrow application-owned manifest publication/checkpoint ordering with Core recovery preserved as effect authority.
value-gate: Demonstrated current QA_PENDING visibility before manifest durability and a bounded ordering/recovery contract.
remaining-work: []
acceptance-criteria:
  - current failure/ambiguity is executable against the delivered BB-043 primitives and durable workflow
  - candidate ordering identifies exactly which state is durable at every crash point
  - no candidate redispatches a potentially effectful Backend action merely to recreate manifest state
  - QA_PENDING is not considered manifest-protected until exact manifest provenance is durable
  - evidence class and production limitations are explicit
submission:
  - PR #135
review-requirements: [Oracle architecture-boundary review, crash-recovery/application review]
reviews:
  - Oracle architecture-boundary review PASS on exact head b477e13096b954632ce0c04fb524f81a72b761a9
  - crash-recovery/application review PASS on exact head b477e13096b954632ce0c04fb524f81a72b761a9
artifact-refs:
  - docs/living/knowledge/bb044-manifest-publication-boundary.md
  - packages/agentic-system/test/bb044-manifest-publication-boundary-research.test.js
evidence-refs:
  - BB-043
  - D014
  - Actions #2068 green on living-doc-impact and Node 20/22/24
  - merge commit f261e290bea64f906d5d096435c70b2742a8bca5
blockers: []
follow-up-refs: [BB-045]
origin: INTENT-exharness-agentic-system; ORACLE_DETAIL integration pressure discovered after BB-043 delivery
```

```text
BB-043
question/work: Deliver the accepted D014 optional application-artifact manifest adapter for ref-only Backend -> QA continuation.
kind: IMPLEMENTATION
priority: P1
status: DONE
owner:
depends-on: []
remaining-work: []
acceptance-criteria:
  - unchanged valid artifacts still resolve through resolveQaContext with existing QA schemas
  - changed bytes behind a stable ref are rejected before QA receives context
  - producer work-order, revision and acceptance-decision mismatches fail closed
  - unavailable payload and missing manifest are distinguishable adapter failures while Oracle preserves their cause
  - the manifest contains identity/provenance/retention metadata but no artifact payload body
  - the adapter grants no correctness, acceptance, lifecycle or retention authority to Oracle
submission:
  - PR #133
review-requirements: [application/code review, Oracle architecture-boundary review]
reviews:
  - application/code review PASS on exact head 07276b1d13b06a3fb55a8b7ef6a4bb5a6fca6638
  - Oracle architecture-boundary review PASS on exact head 07276b1d13b06a3fb55a8b7ef6a4bb5a6fca6638
artifact-refs:
  - docs/living/decisions/D014-application-artifact-manifest-adapter.md
  - docs/living/knowledge/bb039-artifact-manifest-research.md
  - docs/worktree/oracle/artifact-manifest.md
  - packages/agentic-system/src/artifact-manifest.js
  - packages/agentic-system/test/bb043-artifact-manifest-adapter.test.js
evidence-refs:
  - BB-039 accepted research
  - D014 ACCEPTED
  - Actions #2054 green on living-doc-impact and Node 20/22/24
  - application/code review id 5244789001
  - Oracle architecture-boundary review id 5244789380
  - merge commit 9511b5a196bc5442a3a3b91db39ee706ae5438dc
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; ORACLE_DETAIL phase implementation handoff from accepted D014
```

New work belongs here only when it is a concrete unresolved Oracle-detail gap/problem/question with source-backed scope or explicit user intent. Historical re-entry triggers create a new work item rather than mutating the archive.

