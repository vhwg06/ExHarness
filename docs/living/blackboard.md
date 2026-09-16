# Blackboard

Status: **ACTIVE COORDINATION SURFACE**

The Blackboard is the canonical home for every unresolved gap, problem, question, blocker and next piece of non-trivial shared work.

It is shared operational state. It is **not** an actor and it is **not** correctness authority. Agentic Application orchestration owns Board lifecycle transitions.

Living system documents describe current source-backed reality only. If a document discovers something that is not true yet, that item belongs here before another session can work on it.

## Durable project intent root

```text
id: INTENT-exharness-agentic-system
source: USER
objective: Build ExHarness as an agentic system whose project lifecycle can survive and hand off across arbitrary sessions through the Blackboard plus referenced artifacts.
bullets:
  - user defines ideas/objectives/constraints; PM manages rather than invents intent
  - Blackboard remains the canonical work-lifecycle tracker
  - Orchestrator owns lifecycle/dispatch/reconciliation authority
  - specialized work/review remains bounded by concrete context and authority
  - any fresh session must be able to resume from Blackboard + referenced artifacts
constraints:
  - project-critical continuation state must not live only in prior conversation/model context
  - artifacts hold work products; Blackboard stores lifecycle state and refs
  - concrete semantics before generic role/workflow abstractions
```

This root is durable project input, not a generated PM objective and not a correctness claim.

## Session protocol

```text
FRESH SESSION
  -> read durable project intent + Board
  -> recover eligible/pending/blocked/review/reconciliation state
  -> recover current partial-work checkpoint when present
  -> resolve only referenced artifacts/evidence needed for the next context
  -> choose only eligible unresolved work
  -> CLAIM
  -> resolve concrete work context
  -> dispatch/execute bounded Worker work
  -> CHECKPOINT partial continuation OR SUBMIT final result
  -> establish required review work
  -> review now OR leave PENDING_REVIEW for a later/batch session
  -> reconcile assessments/findings
  -> DONE | REOPENED | BLOCKED
  -> reconcile source-synchronized living docs when source changed
```

A Worker submission never self-authorizes `DONE`.

```text
CLAIMED -> DONE
```

is invalid.

A later session must not redo `DONE` work unless new grounded evidence explicitly reopens it.

Session is not project lifecycle. No project-critical continuation state may exist only in previous conversation/model context.

## Session handoff

A handoff-safe project must expose enough durable state for a fresh session to answer:

```text
what project did I open?
what is the user's objective?
what work exists?
what can run now?
what exact partial-work checkpoint should resume?
what is already claimed?
what is pending review or reconciliation?
what is blocked or done?
which artifact/evidence refs must be resolved to continue?
```

The Agentic Application session-handoff surface uses one durable user-intent root and rejects work that cannot trace directly or transitively to that root.

For project-identity handoff safety, `createSessionHandoffSurface({ orchestrator, projectId })` persists the stable project id on the durable user-intent root, exposes it in the handoff projection and fails closed when a fresh session expects another project. Project identity is distinct from store path, session/owner identity, work id and user-intent id.

An unbound legacy reader cannot silently open a project-bound Board. A project-bound reader cannot silently assign identity to a legacy Board. Legacy unbound Boards remain available only for low-level compatibility where project-identity handoff safety is not claimed.

## Review initiation

Review can be initiated from two different sources:

```text
Worker
  -> REQUEST review because the produced change needs specialist verification

PM
  -> REQUIRE review because project scope/dependency/risk/acceptance obligations require it
```

Those sources do not perform the review by implication. The Orchestrator schedules/dispatches the required concrete review role and may run it immediately or defer it.

```text
REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT
```

PM and SA are horizontal roles with different authority:

- PM owns project coordination, sequencing, dependency, timeline and progress semantics;
- SA owns architecture constraints/judgment/review only;
- remaining specialist execution and review is vertical and context-bound.

PM and SA must receive separately resolved context; there is no universal review context.

## Follow-up reconciliation

Unresolved findings are proposals/observations until the Orchestrator reconciles them against current Board state.

```text
finding is still part of current item's acceptance obligation
  -> REOPEN current item and narrow remaining work

finding already exists elsewhere on Board
  -> LINK existing item

finding is genuinely independent actionable work
  -> CREATE child/follow-up with origin/dependency provenance

finding is speculative/non-actionable/no concrete pressure
  -> do not create Board work
```

Invariant:

```text
Do not generate new work when the finding is evidence that the current work is not done.
```

## Work-item shape

The current runtime slice persists the following semantics; this Markdown projection keeps the same authority model without requiring byte-for-byte JSON identity.

```text
id: BB-XXX
question/work: <gap/problem/work to resolve>
status: READY | CLAIMED | PENDING_REVIEW | REVIEWING | PENDING_RECONCILIATION | BLOCKED | DONE | REOPENED | SUPERSEDED
owner: <session/agent only while claimed>
depends-on: []
remaining-work: []
checkpoint: <durable partial-work continuation state, when present>
checkpointed-by: <last session/agent that persisted partial work>
submission: <immutable submitted result refs, when present>
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers: []
follow-up-refs: []
origin: <root-intent or parent/finding provenance>
```

A checkpoint is continuation state, not acceptance state. Persisting a checkpoint never means the work is complete.

The Board is operational state, not a diary and not an architecture document.

## Completion invariants

- Worker result/submission is not completion authority.
- partial checkpoint is not completion authority.
- `DONE` requires all required reviews/acceptance obligations to be satisfied.
- rejected or inconclusive review reopens/narrows the current work unless the finding is independently scoped work;
- Board completion does not automatically promote a design judgment; evidence/judgment/decision semantics remain distinct;
- role-local completion (for example Backend or QA completion) does not automatically mean the enclosing Blackboard problem is done.

## Migration rule

When reconciling an old/current document:

```text
statement
  -> true in source now?               -> living document
  -> unresolved real gap/problem?      -> Blackboard
  -> deliberately absent / no pressure -> living non-goal/constraint, not fake work
  -> stale/resolved?                   -> remove or rewrite as current fact
```

No `gaps.md`, `TODO`, `next`, `remaining`, candidate future API or unresolved design question may live in the source-synchronized `docs/worktree/` projection.

# Current board

## Delivered history

```text
BB-001
question/work: Prove concrete Backend vertical slice (Wave A)
status: DONE
result: delivered
```

```text
BB-002
question/work: Ground Backend completion/evidence and bounded Advisor boundary (Wave B)
status: DONE
result: delivered
```

```text
BB-003
question/work: Add second real role and ref-only Backend -> QA artifact handoff (Wave C)
status: DONE
result: delivered by PR #67
```

```text
BB-011
question/work: Correct Blackboard completion authority and implement the first Orchestrator-owned durable review/follow-up lifecycle.
status: DONE
owner:
depends-on: [BB-003]
remaining-work: []
submission:
  - PR #70
review-requirements:
  - application/code review
  - architecture-boundary review
reviews:
  - merged PR #70 after CI/review hardening
artifact-refs:
  - packages/agentic-system/src/blackboard-orchestrator.js
  - packages/agentic-system/test/wave-d.test.js
evidence-refs:
  - Wave D contract tests in PR #70
  - merge commit 1cba83928c7bd320f431be08ba37a7a1d7e50968
blockers: []
follow-up-refs: [BB-004, BB-012]
origin: governance correction discovered while pressure-testing Blackboard DONE semantics
```

```text
BB-012
question/work: Make the Blackboard a durable session-handoff surface rooted in user-defined intent so any fresh session can resume from Board state + referenced artifacts without previous conversation context.
status: DONE
owner:
depends-on: [BB-011]
remaining-work: []
submission:
  - PR #71
review-requirements:
  - application/code review
  - session-handoff boundary review
reviews:
  - merged PR #71 after session-handoff contract tests and CI
artifact-refs:
  - packages/agentic-system/src/session-handoff.js
  - packages/agentic-system/test/session-handoff.test.js
  - docs/living/decisions/D004-blackboard-session-handoff.md
evidence-refs:
  - session-handoff contract tests in PR #71
  - merge commit 3bf194934693e51cf13b9b2ddfcd59219ad24b1a
blockers: []
follow-up-refs: [BB-004]
origin: direct user objective defining Blackboard as the cross-session handoff boundary
```

```text
BB-004
question/work: Integrate the durable Orchestrator-owned application workflow with the concrete Backend accepted -> QA pending/running/completed path, including restart/recovery behavior.
status: DONE
owner:
depends-on: [BB-003, BB-011, BB-012]
remaining-work: []
submission:
  - PR #72
review-requirements:
  - application/code review
  - architecture-boundary review
reviews:
  - agentic-system review pass on exact PR #72 head after authority correction
  - merged PR #72 after Node 20/22/24 CI
artifact-refs:
  - packages/agentic-system/src/blackboard-orchestrator.js
  - packages/agentic-system/src/durable-backend-qa.js
  - packages/agentic-system/src/session-handoff.js
  - packages/agentic-system/test/durable-backend-qa.test.js
evidence-refs:
  - durable Backend -> QA restart/remediation/block-resume/cancel contract tests in PR #72
  - CI run #1111 on reviewed head
  - merge commit 10a6b3426389a7675cf47609ea01af9cac9f14d5
blockers: []
follow-up-refs: [BB-005, BB-007]
origin: durable cross-session application execution pressure exposed after BB-012
```

BB-004 deliberately does not claim external-effect exactly-once/reconciliation semantics. Core effect truth and recovery composition remain separate under BB-006 and BB-007.

## Agentic Application

```text
BB-005
question/work: Production-evaluate the concrete Backend -> QA system and generalize only evidence-supported repeated semantics.
status: BLOCKED
owner:
depends-on: [BB-004]
remaining-work:
  - run a versioned representative real-repository/provider task corpus
  - measure production task success across Backend -> QA
  - measure false-completion rate at role and Board boundaries
  - measure artifact handoff correctness under real task execution
  - measure context precision/cost for repository vs internal artifacts
  - measure QA issue/remediation rate
  - measure Advisor invocation/value-add or explicitly retain UNEVALUATED with reason
  - measure recovery correctness under representative interruptions
  - re-test whether generic Worker/WorkOrder/context/review abstractions are justified
submission:
review-requirements: []
reviews: []
artifact-refs:
  - docs/living/knowledge/bb022-agentic-evaluation-protocol.md
  - artifacts/agentic-backend-qa-reference-eval.json
evidence-refs:
  - BB-022
  - deterministic reference evidence declares productionEvidence=false
blockers:
  - no versioned representative real-repository/provider workload corpus is currently available in the project; deterministic BB-022 fixture evidence cannot be promoted to production effectiveness
follow-up-refs: [BB-022]
origin: INTENT-exharness-agentic-system; production evaluation of the delivered BB-004 workflow
```

The promoted PM/SA topology in D003 is not yet claimed as a concrete source role implementation. Concrete PM context, SA context and vertical reviewer slices must be added only when their real WorkOrder/context/result pressure is implemented and tested; they must not be fabricated into current-state docs.

## ExHarness Core

```text
BB-006
question/work: Close the built-in external-effect/persistence crash window so candidate/trace/variation state can never be mistaken for proof that an externally visible action completed.
status: DONE
owner:
depends-on: []
remaining-work: []
submission:
  - PR #73
review-requirements:
  - core/code review
  - effect/recovery boundary review
reviews:
  - system review pass on exact PR #73 head after public-facade and authority-boundary hardening
  - merged PR #73 after Node 20/22/24 CI
artifact-refs:
  - packages/core-harness/src/avo-action-effect.js
  - packages/core-harness/src/effect-aware-harness.js
  - packages/core-harness/test/avo-action-effect.test.js
  - docs/worktree/core-harness/workflow.md
evidence-refs:
  - confirmed-result crash recovery / fail-closed ambiguity / explicit idempotent replay contract tests in PR #73
  - exact-head CI run #1128
  - merge commit f31af9741118d38bf6b8b68c8e94a392d37ef182
blockers: []
follow-up-refs: [BB-007]
origin: Core effect/persistence crash-window pressure retained from pre-Blackboard architecture review
```

```text
BB-007
question/work: Compose deterministic restore -> pending-effect reconciliation -> evidence restoration -> explicit resume for a concrete recovery consumer.
status: DONE
owner:
depends-on: [BB-004, BB-006]
remaining-work: []
submission:
  - PR #74
review-requirements:
  - core/code review
  - recovery-composition authority review
reviews:
  - system review pass on exact PR #74 head
  - merged PR #74 after Node 20/22/24 CI
artifact-refs:
  - packages/core-harness/test/recovery-composition.test.js
  - docs/worktree/core-harness/workflow.md
evidence-refs:
  - confirmed-effect/no-redispatch, NON_RECONCILABLE fail-closed and IDEMPOTENT machine-first recovery contracts in PR #74
  - exact-head CI run #1134
  - merge commit 7d793c41871cb13df1567ea4c21d26862eaff643
blockers: []
follow-up-refs: [BB-008]
origin: deterministic recovery-composition pressure after BB-004 and BB-006
```

```text
BB-008
question/work: Determine whether a higher-level executable Core lifecycle surface is justified after recovery composition is concrete.
status: DONE
owner:
depends-on: [BB-007]
remaining-work: []
submission:
  - PR #75
review-requirements:
  - Core architecture-boundary review
reviews:
  - architecture-boundary review passed on PR #75 and authorized D005 promotion
  - merged PR #75 after final exact-head Node 20/22/24 CI
artifact-refs:
  - docs/living/decisions/D005-no-core-lifecycle-facade-yet.md
  - docs/worktree/core-harness/decisions.md
  - docs/worktree/core-harness/workflow.md
evidence-refs:
  - BB-007 concrete recovery-reference consumer in packages/core-harness/test/recovery-composition.test.js
  - repository usage assessment found no second real consumer repeating the full recovery sequence
  - final exact-head CI run #1149
  - merge commit 1a506dce1e1f19f604ba47382e55c191d3c9152d
blockers: []
follow-up-refs: []
origin: abstraction assessment explicitly deferred until BB-007 made recovery sequencing concrete
```

## Oracle

Resolved during Waves A/C and durable Backend -> QA composition:

- first concrete Backend context slice exists;
- internal application-artifact context slice exists for QA;
- stable `sourceRef` is carried by resolved Backend/QA context;
- internal artifact provenance carries `APPLICATION_ARTIFACT`, producer work-order id and acceptance-decision provenance;
- failures identify the concrete repository vs application-artifact source boundary;
- QA artifact lookup failure is now preserved as a blocked durable application checkpoint and can retry after source recovery.

Current unresolved questions:

```text
BB-009
question/work: Determine whether Oracle needs a common resolver contract beyond the two current concrete functions/adapters.
status: BLOCKED
owner:
depends-on: []
remaining-work:
  - reopen when a third real source or repeated adapter boilerplate demonstrates a common contract
submission:
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers:
  - two current source classes still have materially different lifecycle/provenance semantics
  - MCP protocol support alone is not a third source; no concrete MCP-backed source exists yet
  - no repeated pressure yet justifies Resolver<I,O>, registry or provider lifecycle
follow-up-refs: []
```

```text
BB-010
question/work: Determine whether callers need structured Oracle resolution diagnostics beyond the current boundary-specific errors.
status: BLOCKED
owner:
depends-on: []
remaining-work:
  - if pressure appears, distinguish source unavailable/auth/not-found/adaptation/schema/optional absence without fabricating required context
submission:
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers:
  - current Backend/QA callers do not yet demonstrate a machine-readable diagnostic requirement
  - MCP MRTR/task semantics are mapped architecturally but no concrete adapter/caller yet requires a diagnostic contract
follow-up-refs: []
```

```text
BB-013
question/work: Evaluate MCP 2026-07-28 as an Oracle capability/continuation boundary against the current concrete resolver semantics without prematurely making Oracle MCP-first.
status: DONE
owner:
depends-on: []
remaining-work: []
submission:
  - PR #76
review-requirements:
  - Oracle architecture-boundary review
reviews:
  - architecture review passed on PR #76 head 4a187204e8d0ace2885824b487c7299fd6a624d1 after provenance hardening and authorized D006 promotion
artifact-refs:
  - docs/living/decisions/D006-mcp-is-an-oracle-adapter-boundary.md
  - docs/worktree/oracle/state.md
  - docs/worktree/oracle/architecture.md
  - docs/worktree/oracle/workflow.md
  - docs/worktree/oracle/decisions.md
evidence-refs:
  - https://modelcontextprotocol.io/specification/2026-07-28/changelog
  - https://modelcontextprotocol.io/specification/2026-07-28/server/resources
  - https://modelcontextprotocol.io/specification/2026-07-28/server/tools
  - https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks
  - CI run #1155 green on Node 20/22/24 before promotion/current-doc synchronization
blockers: []
follow-up-refs: [BB-009, BB-010]
origin: direct user architectural pressure after reviewing MCP 2026-07-28 stateless request, explicit continuation and task-lifecycle changes
```

BB-013 concludes that MCP is a conditional source/capability adapter and source-call continuation boundary. It is **not** promoted as an MCP-first Oracle layer, a project lifecycle authority or a source class by itself. BB-009/BB-010 remain blocked until a concrete MCP-backed source demonstrates real source/diagnostic pressure.

Caching/freshness and semantic retrieval are not Board gaps merely because they are absent.

## High-impact upgrade roadmap

This roadmap records the user's request to define future workflow, architecture and pipeline upgrades. Every item traces to `INTENT-exharness-agentic-system` through this request and its cited source pressure.

Research must produce a durable comparison, evidence, recommended boundary and acceptance scenarios. A research item can conclude that an upgrade is not justified. Its implementation item then remains blocked or is explicitly superseded with that reason; research completion alone does not authorize implementation or promote a decision.

Priority expresses impact and ordering, not a new runtime lifecycle state. `kind`, `priority` and `acceptance-criteria` below are Markdown planning metadata. Delivered items retain their accepted evidence below; unresolved implementation items remain blocked until dependencies and decision gates are satisfied.

| Track | Research | Implementation | Priority | Project impact |
| --- | --- | --- | --- | --- |
| Canonical project state | BB-014 | BB-015 | P1 | Fresh sessions and executable orchestration use consistent project identity, intent, work and evidence state. |
| Interrupted execution/review | BB-016 | BB-017 | P1 | Work can continue after a session dies inside a stage, with effect truth checked before redispatch. |
| Review-to-completion pipeline | BB-018 | BB-019 | P1 | Backend/QA results can reach independently grounded project acceptance. |
| PM/SA architecture and coordination | BB-020 | BB-021 | P2 | User intent drives bounded decomposition, sequencing and architecture review. |
| Evaluation and evidence pipeline | existing BB-005 | BB-022 | P1 | Upgrade decisions use reproducible task, quality, cost and recovery evidence. |

BB-014/015 and BB-022 are delivered. BB-005 is blocked on representative production evidence. The next eligible P1 research tracks are BB-016 and BB-018; delivery order continues to favor interrupted-work recovery and concrete review before broader role orchestration. BB-009/010 retain their existing evidence gates; MCP support by itself does not unblock them.

```text
BB-014
question/work: Research the authority and synchronization boundary between repository Markdown coordination and executable JSON Blackboard state.
kind: RESEARCH
priority: P1
status: DONE
owner:
depends-on: [BB-012]
remaining-work: []
acceptance-criteria:
  - referenced research artifact distinguishes observed divergence risks from confirmed runtime defects
  - accepted decision identifies the authority for each project and eliminates ambiguous dual writers
  - migration and fresh-session scenarios preserve intent, IDs, dependencies, review state and evidence refs
submission:
  - PR #79
review-requirements: [architecture-boundary review, session-handoff review]
reviews:
  - architecture/session-handoff review accepted explicit project identity boundary without claiming same-project JSON/Markdown dual writers
artifact-refs:
  - docs/living/knowledge/bb014-project-state-authority.md
  - docs/living/decisions/D008-explicit-project-state-boundary.md
evidence-refs:
  - docs/living/blackboard.md (Storage)
  - packages/agentic-system/src/blackboard-orchestrator.js
  - packages/agentic-system/src/session-handoff.js
  - exact-head CI #1228 green on living-doc-impact and Node 20/22/24
  - merge commit b5c71feb731c3228dbc18ec6db9212f7e1c55f59
blockers: []
follow-up-refs: [BB-015]
origin: INTENT-exharness-agentic-system; user-requested architecture roadmap grounded in the two current Board surfaces
```

```text
BB-015
question/work: Implement the accepted project-state authority/projection contract from BB-014.
kind: IMPLEMENTATION
priority: P1
status: DONE
owner:
depends-on: [BB-014]
remaining-work: []
acceptance-criteria:
  - a fresh session identifies the correct project and recovers the same lifecycle state as its Orchestrator
  - stale or wrong-project continuation is rejected rather than silently accepted
  - existing intent/work/checkpoint/submission/review/artifact semantics remain compatible
submission:
  - PR #80
review-requirements: [application/code review, session-handoff/project-state review]
reviews:
  - application/session-handoff review passed exact head 0c4daa4249d7f7bb2b122ec501f2c9a41d35162c
artifact-refs:
  - packages/agentic-system/src/session-handoff.js
  - packages/agentic-system/test/project-identity.test.js
  - docs/worktree/agentic-application/state.md
  - docs/worktree/agentic-application/contracts.md
  - docs/worktree/agentic-application/decisions.md
  - docs/living/decisions/D008-explicit-project-state-boundary.md
evidence-refs:
  - wrong-project, unbound-reader and legacy-upgrade fail-closed contract tests
  - exact-head CI #1240 green on living-doc-impact and Node 20/22/24
  - merge commit 81ae7562e8809f0647520c3fc13a53fca7cecd05
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; implementation follow-up to BB-014
```

```text
BB-016
question/work: Research safe continuation after interruption inside claimed execution or active review, across Application and Core recovery boundaries.
kind: RESEARCH
priority: P1
status: READY
owner:
depends-on: [BB-004, BB-007, BB-012]
remaining-work:
  - map crashes after claim, during Backend/QA execution, after an external effect, before checkpoint and during review
  - distinguish lost claim ownership, lost review dispatch, Core effect ambiguity and completed-stage continuation
  - compare explicit takeover, ownership generations and lease policies without assuming elapsed time proves a Worker stopped
  - specify how the concrete application consumer resolves Core effect/evidence state before retrying a stage
  - recover active review key, reviewer identity and exact subject from the handoff surface; current workSummary omits activeReview (review R4)
acceptance-criteria:
  - failure matrix cites current claim/checkpoint/review behavior and executable reproduction scenarios
  - accepted design rejects stale owners and stale review results after takeover
  - unknown effect outcomes require reconciliation or escalation before redispatch
  - design preserves D005 unless new consumer evidence justifies reopening the facade decision
submission:
review-requirements: [application recovery review, Core effect-boundary review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/agentic-system/src/blackboard-orchestrator.js
  - packages/agentic-system/src/durable-backend-qa.js
  - packages/core-harness/test/recovery-composition.test.js
  - docs/living/knowledge/project-review-2026-09-16.md (R4; active review projection omission)
blockers: []
follow-up-refs: [BB-017]
origin: INTENT-exharness-agentic-system; current claim accepts only READY/REOPENED while interruption can leave CLAIMED/REVIEWING state
```

```text
BB-017
question/work: Implement the accepted interrupted-work and review recovery path for the concrete Backend -> QA application.
kind: IMPLEMENTATION
priority: P1
status: BLOCKED
owner:
depends-on: [BB-016]
remaining-work:
  - implement explicit recovery transitions and stale-owner/reviewer protection from the accepted design
  - compose application continuation with existing Core effect recovery where the failure matrix requires it
  - expose the recovery obligation and required refs to a fresh session
  - preserve active review identity/target in fresh-session continuation and verify it against current Board state
acceptance-criteria:
  - process interruption at each accepted failure boundary can resume or explicitly block with durable reasons
  - confirmed effects are not dispatched again and ambiguous effects are not guessed complete
  - old owners and superseded review targets cannot mutate resumed work
  - existing successful-stage handoff, remediation and review authority contracts remain valid
submission:
review-requirements: [application/code review, crash-recovery review]
reviews: []
artifact-refs: []
evidence-refs: [BB-016]
blockers: [BB-016 must establish an accepted recovery protocol and failure scenarios]
follow-up-refs: []
origin: INTENT-exharness-agentic-system; implementation follow-up to BB-016
```

```text
BB-018
question/work: Research a concrete Backend/QA review pipeline from final submission to project acceptance.
kind: RESEARCH
priority: P1
status: READY
owner:
depends-on: [BB-004, BB-011]
remaining-work:
  - identify acceptance obligations left after Backend/QA role completion
  - specify bounded reviewer context, artifact/evidence resolution and independent assessment production
  - map Worker requests, PM requirements, Orchestrator dispatch and trusted acceptance as separate steps
  - define missing-evidence, rejection, deferred-review and no-declared-review-obligation behavior
acceptance-criteria:
  - concrete review contract names inputs, outputs, trust authorities and failure transitions
  - evidence producer/evaluator/attestor assumptions are explicit and cannot be replaced by reviewer prose
  - proposed pipeline uses existing trust primitives and preserves current-work versus independent-follow-up semantics
submission:
review-requirements: [application architecture review, acceptance/trust review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/agentic-system/src/durable-backend-qa.js
  - packages/agentic-system/src/blackboard-orchestrator.js
  - packages/agentic-system/test/wave-d.test.js
blockers: []
follow-up-refs: [BB-019]
origin: INTENT-exharness-agentic-system; durable QA completion submits PENDING_REVIEW while concrete reviewer execution is not yet delivered
```

```text
BB-019
question/work: Deliver the concrete review-to-completion pipeline specified by BB-018.
kind: IMPLEMENTATION
priority: P1
status: BLOCKED
owner:
depends-on: [BB-018]
remaining-work:
  - implement the bounded reviewer and declared artifact/evidence context
  - connect Orchestrator dispatch, durable review state, trusted assessment and finding reconciliation
  - provide a runnable Backend -> QA -> review -> acceptance/remediation composition
acceptance-criteria:
  - a concrete submission reaches DONE only after its declared obligations pass trusted independent assessment
  - forged, stale or unauthorized review evidence is rejected
  - rejected current obligations reopen the same item and deferred review survives reconstruction
  - integration evidence uses a concrete verifier/trust configuration rather than only permissive test stubs
submission:
review-requirements: [application/code review, independent acceptance-boundary review]
reviews: []
artifact-refs: []
evidence-refs: [BB-018]
blockers: [BB-018 must define the accepted concrete review and trust contract]
follow-up-refs: [BB-021]
origin: INTENT-exharness-agentic-system; implementation follow-up to BB-018
```

```text
BB-020
question/work: Research concrete PM/SA context and project workflow architecture against the delivered Backend/QA lifecycle.
kind: RESEARCH
priority: P2
status: DONE
owner:
depends-on: [BB-004, BB-012]
remaining-work: []
acceptance-criteria:
  - research includes a concrete project scenario and explicit role input/output/authority contracts
  - accepted recommendation preserves PM/SA separation and Orchestrator lifecycle authority from D003
  - implementation is justified by scenario evidence; generic registries or workflow DSLs require separate repeated-use evidence
submission:
  - PR #100
review-requirements: [project-workflow review, architecture-boundary review]
reviews:
  - project-workflow review passed exact research head 0bbc5aea63881d75d5ce16c8cd239c81cb652301; semantic replanning and deterministic-fixture limitations retained
  - architecture-boundary review passed exact research head 0bbc5aea63881d75d5ce16c8cd239c81cb652301; PM/SA remain proposal-only and Orchestrator remains mutation authority
artifact-refs:
  - docs/living/knowledge/bb020-pm-sa-workflow.md
  - packages/agentic-system/test/bb020-pm-sa-research.test.js
evidence-refs:
  - docs/living/decisions/D003-orchestrator-blackboard-review-authority.md
  - docs/living/decisions/D004-blackboard-session-handoff.md
  - packages/agentic-system/src/session-handoff.js
  - packages/agentic-system/src/durable-backend-qa.js
  - packages/agentic-system/src/blackboard-orchestrator.js
  - exact research-head CI #1611 green on living-doc-impact and Node 20/22/24
  - measured fixture: baseline 8/11 obligations (72.73%) vs bounded 11/11 (100%), zero false obligations, 3 semantic replans, 1 SA assessment, 4 authority-fence rejections; productionEvidence=false
  - separate role-context serialization: 4464 chars vs universal 7743 chars (42.35% reduction proxy)
  - research result: NARROW; no generic role framework or runtime default authorized
blockers: []
follow-up-refs: [BB-021]
origin: INTENT-exharness-agentic-system; user-requested workflow/architecture research beyond current concrete Backend/QA roles
```

```text
BB-021
question/work: Implement the evidence-supported PM/SA coordination slice selected by BB-020 and connect it to concrete review dispatch.
kind: IMPLEMENTATION
priority: P2
status: BLOCKED
owner:
depends-on: [BB-019, BB-020]
remaining-work:
  - implement only the concrete role contexts and proposal contracts accepted by BB-020
  - validate dependency/review/re-planning proposals through application orchestration
  - persist coordination decisions and required artifact refs for fresh-session continuation
acceptance-criteria:
  - one user-rooted project progresses through coordination, execution and required review across sessions
  - PM cannot invent or overwrite user intent and SA cannot assume project-management authority
  - role proposals cannot bypass claim, review, completion or follow-up reconciliation rules
submission:
review-requirements: [application/code review, PM/SA authority review]
reviews: []
artifact-refs: []
evidence-refs: [BB-019, BB-020]
blockers:
  - BB-019 must deliver the review execution boundary used by coordination
follow-up-refs: []
origin: INTENT-exharness-agentic-system; conditional implementation follow-up to BB-020
```

```text
BB-022
question/work: Build a reproducible application evaluation and evidence-report pipeline supporting BB-005.
kind: IMPLEMENTATION
priority: P1
status: DONE
owner:
depends-on: [BB-004, BB-011, BB-012]
remaining-work: []
acceptance-criteria:
  - another session can reproduce fixture runs from durable inputs and inspect why each outcome was assigned
  - reports separate role acceptance from Board completion and missing/inconclusive evidence from success
  - baseline comparisons identify regressions without inventing production effectiveness from fixture scores
  - real-task evaluation protocol and baseline-derived acceptance thresholds are documented for BB-005
submission:
  - PR #78
review-requirements: [evaluation-method review, application/code review]
reviews:
  - evaluation-method/application review passed deterministic reference boundary without promoting fixture scores to production evidence
artifact-refs:
  - scripts/agentic-backend-qa-eval.mjs
  - artifacts/agentic-backend-qa-reference-eval.json
  - docs/worktree/agentic-application/evaluation.md
  - docs/living/knowledge/bb022-agentic-evaluation-protocol.md
evidence-refs:
  - package.json
  - packages/agentic-system/test/durable-backend-qa.test.js
  - packages/agentic-system/test/wave-d.test.js
  - exact-head CI #1217 green on living-doc-impact and Node 20/22/24
  - deterministic reference result declares productionEvidence=false
  - merge commit a16328708e751740a3a1b74fe6a7a2dd74769568
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; tooling child of BB-005, which retains ownership of production evaluation and abstraction conclusions
```

## Additional findings and stateful research roadmap

Review evidence: `knowledge/project-review-2026-09-16.md`, inspected revision `ad61a2b037b99384e16fdd5245ee04f43dc36083`. R1-R4 were reproduced with isolated adapters; they do not assert production incidents. BB-023/024/025 address newly grounded defects without erasing delivered history. R4 extends BB-016/017. BB-026/027 define a research consumer before choosing an abstraction.

Current sequence: BB-023 is delivered. BB-024 and BB-025 have merged implementations and passing targeted regression tests; their Board acceptance awaits review-evidence reconciliation. Continue BB-016/018 and the bounded research pilot without reimplementing those fixes. BB-014/015/022 remain delivered; BB-005 still requires representative production evidence.

```text
BB-023
question/work: Prevent expired-lock takeover from allowing a live stale transaction to overwrite newer committed Blackboard state.
kind: FIX
priority: P1
status: DONE
owner:
depends-on: []
remaining-work: []
acceptance-criteria:
  - the R1 interleaving cannot lose a committed item; conflicting old writes fail explicitly
  - lock cleanup verifies ownership and cannot remove a newer lock
  - tests cover paused live owners, abandoned locks and competing recovery attempts
submission:
  - PR #84
review-requirements: [persistence/concurrency review, application/code review]
reviews:
  - persistence/concurrency + application/code review passed exact head baf175809c45b25b2bbee9e7a234aef7a0e0f9e6
artifact-refs:
  - packages/agentic-system/src/blackboard-store.js
  - packages/agentic-system/test/blackboard-store.test.js
  - docs/living/knowledge/bb023-blackboard-commit-fencing.md
  - docs/living/decisions/D011-blackboard-commit-fencing.md
  - docs/worktree/agentic-application/contracts.md
  - docs/worktree/agentic-application/workflow.md
  - docs/worktree/agentic-application/decisions.md
evidence-refs:
  - docs/living/knowledge/project-review-2026-09-16.md (R1)
  - exact-head CI #1344 green on living-doc-impact and Node 20/22/24 before decision/Board promotion
  - paused stale writer, competing recovery writer, legacy-lock, failed-publication, projection-authority, projection-failure and repeated-state regression contracts
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; grounded follow-up from current project review, store exclusion distinct from BB-016 work ownership
```

```text
BB-024
question/work: Preserve SUPERSEDED cancellation when delayed finding reconciliation arrives.
kind: FIX
priority: P1
status: PENDING_REVIEW
owner:
depends-on: []
remaining-work:
  - reconcile required review and CI evidence for merged PR #85 before marking DONE
acceptance-criteria:
  - cancel followed by NON_ACTIONABLE or CURRENT_WORK reconciliation cannot become DONE or REOPENED
  - late NEW_WORK reconciliation cannot create child work after cancellation
  - normal pending-finding reconciliation still derives completion only after remaining obligations resolve
submission:
  - merged PR #85 at dfc5249073ebfb1722047a3e4ac851caaee41d19
review-requirements: [workflow/acceptance review, application/code review]
reviews: []
artifact-refs:
  - packages/agentic-system/src/application-orchestrator.js
  - packages/agentic-system/test/bb024-cancellation-reconciliation.test.js
evidence-refs:
  - docs/living/knowledge/project-review-2026-09-16.md (R2)
  - targeted BB-024 regression passed at 8125bef297973c7e4ff24540875589beca303a18
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; reproduced cancellation-to-DONE transition through reconcileFinding
```

```text
BB-025
question/work: Validate Blackboard dependency graph integrity and diagnose stored graphs that cannot progress.
kind: FIX
priority: P1
status: PENDING_REVIEW
owner:
depends-on: []
remaining-work:
  - reconcile required review and CI evidence for merged PR #87 before marking DONE
acceptance-criteria:
  - R3 dangling and cyclic inputs fail with actionable item/edge diagnostics before persistence
  - valid unordered DAGs and durable intent-root dependencies remain accepted
  - invalid mutations leave the prior snapshot intact and repair never silently drops dependencies
submission:
  - merged PR #87 at 8125bef297973c7e4ff24540875589beca303a18
review-requirements: [state/schema review, application/code review]
reviews: []
artifact-refs:
  - packages/agentic-system/src/blackboard-graph.js
  - packages/agentic-system/test/blackboard-graph.test.js
evidence-refs:
  - docs/living/knowledge/project-review-2026-09-16.md (R3)
  - targeted BB-025 regression passed at 8125bef297973c7e4ff24540875589beca303a18
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; reproduced acceptance of unresolvable dependency graphs
```

```text
BB-026
question/work: Research a concrete stateful investigation pipeline that preserves hypotheses, experiments and evidence validity across sessions.
kind: RESEARCH
priority: P2
status: READY
owner:
depends-on: [BB-012, BB-015, BB-022]
remaining-work:
  - use BB-016 failure-boundary research as the concrete pilot rather than repeat its recovery-design scope
  - compare existing generic checkpoints plus referenced artifacts with a minimal research-specific contract
  - define durable question/hypothesis/experiment/result/decision lineage and unresolved continuation state
  - evaluate evidence invalidation when implementation, configuration, source or policy revisions change
  - keep observations, derived judgments, independent audit and promoted decisions distinct
acceptance-criteria:
  - a second fresh session identifies completed experiments, contradictory evidence and the next unresolved experiment without prior chat
  - a changed source/policy revision flags affected conclusions for reassessment without deleting historical results
  - report records costs and limitations of both approaches and may conclude no new runtime API is needed
  - accepted recommendation specifies artifact/provenance boundaries and a bounded implementation only if demonstrated
submission:
review-requirements: [research-method review, architecture-boundary review]
reviews: []
artifact-refs: []
evidence-refs:
  - docs/living/knowledge/project-review-2026-09-16.md (research opportunity)
  - docs/living/knowledge/bb022-agentic-evaluation-protocol.md
  - packages/agentic-system/src/session-handoff.js
blockers: []
follow-up-refs: [BB-027]
origin: INTENT-exharness-agentic-system; direct user request for stateful research and high-impact architecture upgrades, grounded in existing research backlog
```

```text
BB-027
question/work: Deliver the accepted research-continuation workflow from BB-026 using existing artifacts/checkpoints or its demonstrated minimal extension.
kind: IMPLEMENTATION
priority: P2
status: BLOCKED
owner:
depends-on: [BB-026]
remaining-work:
  - implement the accepted concrete artifact/checkpoint convention and any justified runtime integration
  - expose resumable experiment state and evidence-validity decisions with provenance
  - exercise the research pilot across interruption and source-revision changes
acceptance-criteria:
  - completed valid experiments are not silently repeated and interrupted experiments are not treated as completed evidence
  - stale and contradictory findings remain inspectable and cannot silently become accepted architecture
  - work products stay in referenced artifacts; Board holds lifecycle and continuation refs
  - research completion cannot bypass independent acceptance or promote its own conclusions
submission:
review-requirements: [research-workflow review, application/code review if runtime changes]
reviews: []
artifact-refs: []
evidence-refs: [BB-026]
blockers: [BB-026 must deliver an accepted evidence-backed continuation contract; supersede if no implementation work is justified]
follow-up-refs: []
origin: INTENT-exharness-agentic-system; conditional implementation follow-up to BB-026
```

## Further architecture, decision and self-upgrade roadmap

These items extend the user's request for high-impact upgrades from existing capabilities. They are research hypotheses and conditional delivery work, not confirmed defects or claims of implemented behavior. Research may conclude that composition conventions suffice. Implementation stays blocked until an accepted research result identifies a concrete benefit and scope.

Here, a decision chain means explicit hypotheses, concise rationales, artifact provenance and observable action/outcome links. It does not require recording private model reasoning. Self-upgrade means proposing and evaluating bounded candidates under independent acceptance; this backlog does not authorize deployment, merging or changes to the evaluator's authority.

| Track | Research | Delivery | Priority |
| --- | --- | --- | --- |
| Inspectable decision-to-outcome chain | BB-028 | BB-029 | P1 |
| Outcome-driven workflow and investment | BB-030 | BB-031 | P1 |
| Architecture composition from existing primitives | BB-032 | BB-033 | P2 |
| Evidence-gated self-upgrade loop | BB-034 | BB-035 | P1 |

BB-023/024/025 remain the immediate correctness priorities. BB-028/030/032/034 can be researched against existing source. BB-026/027 own durable research continuation; BB-020/021 own PM/SA roles; BB-005 owns production-effectiveness conclusions. These new tracks consume those results without duplicating their scope. BB-035 additionally waits for BB-027 and the concrete independent review pipeline BB-019 before an application-level upgrade pilot is delivered.

```text
BB-028
question/work: Research a concrete decision-to-outcome chain for Backend/QA remediation using existing deliberation, ActionIntent and grounded reflection.
kind: RESEARCH
priority: P1
status: READY
owner:
depends-on: []
remaining-work:
  - Map user objective -> explicit hypothesis/options -> concise decision rationale -> authorized action -> verification -> outcome -> grounded reflection.
  - Compare existing artifact links with a minimal application correlation contract on one Backend/QA remediation task.
  - Measure review effort, incorrect conclusions and context size with and without the decision summary; preserve counterevidence and uncertainty.
acceptance-criteria:
  - A fresh reviewer can recover the chosen action, alternatives, supporting evidence and observed outcome through bounded artifact summaries.
  - The design records explicit decision summaries, not raw/private chain-of-thought; rationale is never correctness evidence by itself.
  - Missing, stale or contradictory evidence stays visible and no explanation can bypass action authorization or independent acceptance.
submission:
review-requirements: [architecture-boundary review, evaluation-method review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/core-harness/src/deliberation-controller.js
  - packages/core-harness/src/grounded-cognition.js
  - docs/worktree/core-harness/workflow.md
blockers: []
follow-up-refs: [BB-029]
origin: INTENT-exharness-agentic-system; direct user request for architecture/workflow/decision/self-upgrade roadmap. Core already has bounded deliberation, action authorization, effect refs and grounded reflection; their usefulness as one application-level explanation and continuation path has not been demonstrated.
```

```text
BB-029
question/work: Deliver the accepted decision-to-outcome artifact composition for one concrete Backend/QA remediation workflow.
kind: IMPLEMENTATION
priority: P1
status: BLOCKED
owner:
depends-on: [BB-028]
remaining-work:
  - implement the accepted bounded pilot using existing primitives before introducing shared abstractions
  - persist configuration, candidate/baseline revisions and evidence refs needed for reproduction and continuation
  - reconcile current documentation only after the corresponding behavior is implemented and verified
acceptance-criteria:
  - Decision summaries link the exact objective, action, revision and outcome without fabricating intermediate reasoning.
  - Fresh-session reconstruction and contradictory/stale evidence cases preserve the accepted contract.
  - Measured comparison reports benefits, costs and failure cases; no blanket claim of improved model reasoning.
submission:
review-requirements: [application/code review, independent outcome/authority review]
reviews: []
artifact-refs: []
evidence-refs: [BB-028]
blockers:
  - BB-028 must produce an accepted scope and evidence-backed evaluation contract
follow-up-refs: []
origin: INTENT-exharness-agentic-system; conditional delivery follow-up to BB-028
```

```text
BB-030
question/work: Research application-level work prioritization and stopping rules based on measured outcomes and explicit user priorities.
kind: RESEARCH
priority: P1
status: READY
owner:
depends-on: []
remaining-work:
  - Define impact using user acceptance goals, dependency unblocking, defect severity, evidence confidence and measured cost; distinguish estimates from observations.
  - Compare the current deterministic queue with one bounded prioritization policy on recorded scenarios and controlled task runs.
  - Specify budgets, retry ceilings, plateau/stop/escalation rules and checks against starvation or repeatedly selecting cheap low-value tasks.
acceptance-criteria:
  - A replayable comparison reports outcome quality, blocked-work reduction, cost and uncertainty rather than only completed-item counts.
  - Safety/correctness obligations and user constraints cannot be traded away for aggregate score; missing measurements cannot be invented.
  - The proposal preserves PM coordination and Orchestrator transition authority, and distinguishes application scheduling from Core promotion.
submission:
review-requirements: [architecture-boundary review, evaluation-method review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/core-harness/src/search-investment.js
  - scripts/agentic-backend-qa-eval.mjs
  - docs/living/knowledge/bb022-agentic-evaluation-protocol.md
blockers: []
follow-up-refs: [BB-031]
origin: INTENT-exharness-agentic-system; direct user request for architecture/workflow/decision/self-upgrade roadmap. Core search-investment controls variation continuation; BB-022 measures application fixtures. Neither establishes a project-level policy for ranking work by expected user impact.
```

```text
BB-031
question/work: Implement the accepted bounded application scheduling/investment pilot over existing Blackboard work.
kind: IMPLEMENTATION
priority: P1
status: BLOCKED
owner:
depends-on: [BB-030]
remaining-work:
  - implement the accepted bounded pilot using existing primitives before introducing shared abstractions
  - persist configuration, candidate/baseline revisions and evidence refs needed for reproduction and continuation
  - reconcile current documentation only after the corresponding behavior is implemented and verified
acceptance-criteria:
  - Eligible dependencies and mandatory reviews remain gates regardless of ranking score.
  - Priority decisions carry policy/input revisions, reasons and measured-versus-estimated fields in referenced artifacts.
  - Stop, retry, starvation and cost-budget scenarios are reproducible; effectiveness claims use the declared evidence class.
submission:
review-requirements: [application/code review, independent outcome/authority review]
reviews: []
artifact-refs: []
evidence-refs: [BB-030]
blockers:
  - BB-030 must produce an accepted scope and evidence-backed evaluation contract
follow-up-refs: []
origin: INTENT-exharness-agentic-system; conditional delivery follow-up to BB-030
```

```text
BB-032
question/work: Research a minimal concrete composition boundary across application workflow, Core cognition/recovery and Oracle context.
kind: RESEARCH
priority: P2
status: READY
owner:
depends-on: []
remaining-work:
  - Map actual call/data ownership for dispatch, context, persistent state, effects, evidence and completion using existing source consumers.
  - Identify duplicated sequencing, missing links and incompatible assumptions using concrete failure scenarios, including BB-016 findings when available.
  - Compare explicit composition with a narrow adapter/facade; document a no-extraction outcome when repetition is insufficient.
acceptance-criteria:
  - The architecture proposal includes executable scenario evidence, dependency direction and named owners for each state/decision boundary.
  - Any shared interface is justified by real consumers and has compatibility/migration tests; no registry or workflow DSL is inferred from a diagram.
  - D005 is preserved unless explicit new evidence supports a separately reviewed superseding decision.
submission:
review-requirements: [architecture-boundary review, evaluation-method review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/agentic-system/src/durable-backend-qa.js
  - packages/core-harness/test/recovery-composition.test.js
  - docs/living/decisions/D005-no-core-lifecycle-facade-yet.md
blockers: []
follow-up-refs: [BB-033]
origin: INTENT-exharness-agentic-system; direct user request for architecture/workflow/decision/self-upgrade roadmap. Existing capabilities span distinct authority planes; the current Backend/QA consumer and recovery-reference consumer expose different compositions. D005 requires repeated evidence before a general lifecycle facade.
```

```text
BB-033
question/work: Implement only the concrete composition improvement accepted by BB-032.
kind: IMPLEMENTATION
priority: P2
status: BLOCKED
owner:
depends-on: [BB-032]
remaining-work:
  - implement the accepted bounded pilot using existing primitives before introducing shared abstractions
  - persist configuration, candidate/baseline revisions and evidence refs needed for reproduction and continuation
  - reconcile current documentation only after the corresponding behavior is implemented and verified
acceptance-criteria:
  - Selected consumers execute the same acceptance/recovery scenarios through the proposed composition without changing authority.
  - Effect confirmation, role acceptance and Board DONE remain separate and invalid evidence fails closed.
  - A no-change research conclusion supersedes this item with provenance instead of forcing an abstraction.
submission:
review-requirements: [application/code review, independent outcome/authority review]
reviews: []
artifact-refs: []
evidence-refs: [BB-032]
blockers:
  - BB-032 must produce an accepted scope and evidence-backed evaluation contract
follow-up-refs: []
origin: INTENT-exharness-agentic-system; conditional delivery follow-up to BB-032
```

```text
BB-034
question/work: Research a bounded self-improvement loop that proposes and evaluates upgrades from observed project failures using existing Core primitives.
kind: RESEARCH
priority: P1
status: READY
owner:
depends-on: []
remaining-work:
  - Define observed failure -> grounded reflection -> improvement hypothesis -> isolated candidate -> controlled experiment -> independent acceptance -> rollout/rollback artifact.
  - Choose one reversible pilot, such as context selection or remediation policy, with a fixed baseline, held-out scenarios and measured resource budget.
  - Specify candidate scope, provenance, stale-evidence rejection, experiment continuation and a stop rule when improvement is absent; reuse BB-026 research-continuation findings.
acceptance-criteria:
  - Baseline and candidate are compared under recorded conditions with held-out outcomes; the candidate cannot rewrite its own evaluator or acceptance thresholds.
  - A reflection proposes an experiment but cannot accept, deploy, merge or grant new authority; approved lifecycle transitions remain with application orchestration.
  - The report includes negative results, regression checks, cost and rollback criteria; fixture success alone does not justify production rollout.
submission:
review-requirements: [architecture-boundary review, evaluation-method review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/core-harness/src/grounded-cognition.js
  - packages/core-harness/src/semantic-memory-evolution.js
  - packages/core-harness/src/search-investment.js
  - scripts/agentic-backend-qa-eval.mjs
blockers: []
follow-up-refs: [BB-035]
origin: INTENT-exharness-agentic-system; direct user request for architecture/workflow/decision/self-upgrade roadmap. Grounded cognition, semantic-memory evolution, candidate evaluation and application reference runs exist; they do not establish a validated autonomous upgrade process for the project itself.
```

```text
BB-035
question/work: Deliver one accepted self-upgrade experiment pipeline with isolated candidates, independent evaluation and explicit adoption control.
kind: IMPLEMENTATION
priority: P1
status: BLOCKED
owner:
depends-on: [BB-034, BB-027, BB-019]
remaining-work:
  - implement the accepted bounded pilot using existing primitives before introducing shared abstractions
  - persist configuration, candidate/baseline revisions and evidence refs needed for reproduction and continuation
  - reconcile current documentation only after the corresponding behavior is implemented and verified
acceptance-criteria:
  - A failing or inconclusive candidate leaves the baseline selected and preserves evidence for the next session.
  - A successful candidate produces a reviewable proposal with exact revisions, evaluation refs and rollback information before adoption.
  - Iterations obey experiment/resource limits and cannot change user objectives, review requirements or their own acceptance gates.
submission:
review-requirements: [application/code review, independent outcome/authority review]
reviews: []
artifact-refs: []
evidence-refs: [BB-034]
blockers:
  - BB-034 must produce an accepted scope and evidence-backed evaluation contract
  - BB-027 and BB-019 must supply durable research continuation and independent application review
follow-up-refs: []
origin: INTENT-exharness-agentic-system; conditional delivery follow-up to BB-034
```

## Research admission: implementable project value

The user's current constraint applies to all open research on this Board: accept research only when it has a concrete project consumer, a bounded implementable change, a baseline comparison and an observable value gate. A topic, literature survey, architecture diagram or recommendation alone does not satisfy delivery acceptance.

Before claiming research, identify the consumer and implementation surface, the current limitation, the smallest runnable experiment, required inputs and an experiment budget. Missing prerequisites must be explicit blockers. Define the success criterion before measuring the candidate; preserve correctness, authority and evidence freshness as hard constraints.

A useful research result must include runnable prototype evidence and a reviewable implementation handoff: exact integration point, interface/configuration changes, compatibility, verification and adoption/rollback plan. Link that handoff to existing implementation work or create a bounded follow-up after review. Do not mark the upgrade delivered until its implementation is integrated and its value gate passes. An inconclusive experiment remains unresolved within its budget; reject/supersede a disproved proposal with evidence instead of presenting it as delivered project value. Historical DONE records remain historical.

## Research addons: measured value before adoption

These are candidate research addons grounded in existing extension points, subject to the implementable-value gate above. Each must deliver a runnable experiment and implementation handoff for its named consumer. Their absence is not a defect. Existing correctness fixes BB-023/024/025 remain higher urgency than optional addons.

| Research | Candidate addon | First value to measure |
| --- | --- | --- |
| BB-036 | Task-aware context selection | Context coverage versus task success and context cost |
| BB-037 | Grounded experience reuse | Fewer repeated failures without negative transfer |
| BB-038 | Counterfactual workflow replay | Reproducible regressions under controlled failures |
| BB-039 | Artifact manifest/retention | Reliable, verifiable ref-only session continuation |
| BB-040 | Measured model routing | Verified quality versus observed cost and latency |

For comparisons, fix the task set and policy versions, keep held-out scenarios, record failed/inconclusive runs and declare the evidence class. Predeclare experiment budgets and decision criteria before observing candidate results. Improvements on deterministic fixtures do not establish production effectiveness. Start with BB-038 and BB-039 for continuation reliability; BB-036 provides a separate context-efficiency experiment. BB-037 and BB-040 need evidence that their added runtime cost is worthwhile.

```text
BB-036
question/work: Research an optional task-aware context selection addon above Oracle's existing declared-file contract.
kind: RESEARCH
priority: P1
status: DONE
owner:
depends-on: []
research-hypothesis: An application-side selector may reduce irrelevant context and missed dependencies while keeping source access explicit.
target-consumer: Backend work-order construction before resolveBackendContext on a versioned repository task set
implementation-output: A bounded selector that proposes requiredFiles, with application validation and fallback to the explicit declared set
value-gate: On held-out tasks, reduce total context/selection cost or improve required-context coverage versus the declared-file baseline without reducing verified task success; report both selection overhead and downstream costs
scope-boundary: BB-009/010 retain resolver/diagnostic questions. This item studies application context selection, not a generic Oracle provider framework.
remaining-work: []
acceptance-criteria:
  - Report task success, required-context coverage, unnecessary reads, context size and selection cost against the existing baseline.
  - Held-out tasks test whether savings survive without increasing missed-dependency or false-completion outcomes.
  - The result recommends adopt, narrow, or reject; automatic source-scope expansion and correctness claims from retrieval relevance are excluded.
submission:
  - PR #92
review-requirements: [research-method review, application/architecture-boundary review]
reviews:
  - research-method review passed exact head 3ce4f6965f2e6c4cc60493bc7d86b18bb241e858 with synthetic-dataset bias retained as an explicit limitation
  - application/architecture-boundary review passed exact head 3ce4f6965f2e6c4cc60493bc7d86b18bb241e858; selector remains before WorkOrder construction and Oracle authority is unchanged
artifact-refs:
  - docs/living/knowledge/bb036-task-aware-context-selection.md
  - docs/living/knowledge/bb036-task-aware-context-selection-probe.mjs
  - artifacts/bb036-task-aware-context-selection-probe.json
evidence-refs:
  - packages/agentic-system/src/backend-application.js
  - packages/agentic-system/src/contracts.js
  - packages/agentic-system/src/oracle.js
  - packages/agentic-system/src/backend-worker.js
  - packages/core-harness/src/context.js
  - exact-head CI #1421 green on living-doc-impact and Node 20/22/24
  - held-out bounded selector: 2/3 fixture passes, 100% required-context coverage, 0 unnecessary reads; productionEvidence=false
  - research result: NARROW; no runtime adoption/default authorized from fixture evidence
blockers: []
follow-up-refs: [BB-005]
origin: INTENT-exharness-agentic-system; explicit user request for useful research addons based on existing project capabilities
```

```text
BB-037
question/work: Research whether existing semantic memory can reuse verified task experience across runs without transferring stale or unrelated project knowledge.
kind: RESEARCH
priority: P2
status: READY
owner:
depends-on: []
research-hypothesis: Selective recall of grounded prior failures and successful repairs may reduce repeated remediation work.
target-consumer: Backend remediation context for recurring verified failure cases, scoped to a project and revision
implementation-output: An opt-in adapter using the existing memory retrieval port to supply bounded, source-linked repair experience before a remediation run
value-gate: Reduce repeat failures or repair attempts on held-out recurring-failure tasks versus no-memory runs, within a predeclared overhead budget and without worse final correctness or cross-project leakage
scope-boundary: BB-026 owns research continuation and BB-034 owns self-upgrade candidates. This item measures the incremental value and risks of memory reuse.
remaining-work:
  - Compare no memory, lexical recall and existing associative ranking with identical task inputs and a fixed context budget.
  - Partition records by project, repository revision, task family and evaluation policy; distinguish transferable technique from revision-specific facts.
  - Exercise contradictory repairs, archived records, stale evidence and unrelated projects; separate training experience from held-out evaluation tasks.
acceptance-criteria:
  - Measure repeat-failure rate, repair attempts, final correctness, retrieval overhead and inappropriate cross-project recall.
  - A replayable negative-transfer scenario demonstrates that irrelevant/stale memories cannot become acceptance evidence.
  - Recommend an opt-in composition or no addon; preserve RELEVANCE_ONLY semantics and explicit memory visibility.
submission:
review-requirements: [research-method review, application/architecture-boundary review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/core-harness/src/semantic-memory-retrieval.js
  - packages/core-harness/src/semantic-memory-intelligence.js
  - packages/core-harness/src/semantic-memory-evolution.js
  - packages/core-harness/src/grounded-cognition.js
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; explicit user request for useful research addons based on existing project capabilities
```

```text
BB-038
question/work: Research a replay and fault-injection addon for comparing workflow policies against recorded observable events.
kind: RESEARCH
priority: P1
status: PENDING_REVIEW
owner:
depends-on: []
research-hypothesis: Controlled replay may reveal regressions and distinguish which workflow decision caused an outcome before a policy is adopted.
target-consumer: Agentic evaluation and regression verification for BB-023/024 plus the BB-016 recovery investigation
implementation-output: A runnable fault-schedule/replay helper integrated with the existing application evaluation or focused regression tests
value-gate: Reproduce at least one documented current lifecycle/persistence failure and distinguish the faulty implementation from its fix under the same schedule, with no real external mutation
scope-boundary: BB-022 remains the reference evaluation gate; BB-016 and BB-023/024 own recovery/defect fixes. This research evaluates reusable experimental tooling, not their implementation.
remaining-work:
  - Review the fixture-level replay result, runtime cancellation calibration, unsupported schedules and authority boundary.
acceptance-criteria:
  - A reviewer can reproduce a baseline/candidate divergence and identify the changed decision plus downstream outcome refs.
  - Replays isolate external effects and never reissue a historical mutation merely because it appears in a trace.
  - Report replay fidelity, uncovered failures, storage cost and unsupported cases; avoid claiming causal certainty when model/environment inputs differ.
submission:
  - docs/living/knowledge/bb038-workflow-policy-replay.md
  - scripts/workflow-policy-replay-eval.mjs
  - docs/living/knowledge/bb038-runtime-calibration.mjs
review-requirements: [research-method review, application/architecture-boundary review]
reviews: []
artifact-refs:
  - docs/living/knowledge/bb038-workflow-policy-replay.md
  - docs/living/knowledge/bb038-runtime-calibration.mjs
  - artifacts/bb038-workflow-replay-eval.json
evidence-refs:
  - packages/agentic-system/src/durable-backend-qa.js
  - packages/agentic-system/src/blackboard-orchestrator.js
  - packages/core-harness/src/runtime-snapshot.js
  - scripts/agentic-backend-qa-eval.mjs
  - npm run eval:workflow-replay is integrated in the root verification script; direct Node evaluation passes the checked artifact
  - actual JSON-store cancellation calibration: base REOPENED, public SUPERSEDED, normal control REOPENED
  - research result: NARROW to fixture-level policy replay; productionEvidence=false
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; explicit user request for useful research addons based on existing project capabilities
```

```text
BB-039
question/work: Research an artifact-manifest and retention addon that makes ref-only continuation verifiable across project sessions.
kind: RESEARCH
priority: P1
status: PENDING_REVIEW
owner:
depends-on: []
research-hypothesis: A minimal manifest linking immutable content identity and producer evidence may make ref-only handoff more dependable under source changes or loss.
target-consumer: One concrete artifactReader used by durable Backend -> QA continuation
implementation-output: A compatible artifact-manifest adapter validating content identity and producer revision before returning QA context, with explicit unavailable-content behavior
value-gate: Reject changed/mismatched content and diagnose unavailable content in controlled restart scenarios while still accepting unchanged valid artifacts; demonstrate a concrete improvement over that adapter's baseline
scope-boundary: BB-014/015 settled project-state authority, not artifact storage guarantees. This item does not reopen their accepted project boundaries.
remaining-work:
  - Review the bounded adapter experiment, integrity assumptions, retention proposal and implementation handoff.
acceptance-criteria:
  - A fresh session can distinguish missing, changed and verified content before using it as evidence; observed behavior is reported without presuming all adapters are defective.
  - A retention proposal names which pending work/review refs pin artifacts and how historical evidence remains inspectable.
  - The recommendation bounds storage cost and compatibility; it does not copy full payloads into Blackboard or treat availability as correctness.
submission:
  - docs/living/knowledge/bb039-artifact-manifest-research.md
  - docs/living/knowledge/bb039-artifact-manifest-probe.mjs
review-requirements: [research-method review, application/architecture-boundary review]
reviews: []
artifact-refs:
  - docs/living/knowledge/bb039-artifact-manifest-research.md
  - docs/living/knowledge/bb039-artifact-manifest-probe.mjs
evidence-refs:
  - packages/agentic-system/src/artifact-ref.js
  - packages/agentic-system/src/oracle.js
  - packages/agentic-system/src/session-handoff.js
  - packages/agentic-system/src/qa-contracts.js
  - packages/agentic-system/src/durable-backend-qa.js
  - measured fixture: baseline passes 2 identity violations; manifest reader rejects both; valid and missing behavior unchanged
  - research result: NARROW to one opt-in adapter; productionEvidence=false
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; explicit user request for useful research addons based on existing project capabilities
```

```text
BB-040
question/work: Research an optional quality/cost routing policy using existing Core model routing on concrete Backend and QA tasks.
kind: RESEARCH
priority: P2
status: BLOCKED
owner:
depends-on: []
research-hypothesis: Task- and failure-aware route selection may lower cost or latency while preserving independently verified task quality.
target-consumer: Backend/QA execution with a concrete configured model provider and measured usage on representative tasks
implementation-output: An opt-in bounded routing/escalation policy over the existing model routing interface, preserving fixed-route fallback
value-gate: Improve observed total cost or latency at a predeclared verified-quality floor against a fixed-route baseline on held-out tasks; fixture-only route switching cannot establish this value
scope-boundary: BB-030 owns project work prioritization and BB-005 owns production-effectiveness conclusions. This item studies model-route selection within a bounded task.
remaining-work:
  - Compare a fixed model route with a bounded routing/escalation policy using declared provider configurations and identical versioned tasks.
  - Record route provenance, observed usage, latency, verification outcomes and escalation reasons; preserve unavailable metrics as unknown.
  - Predeclare budget and escalation limits; test provider errors, easy/hard task mixes and held-out tasks before recommending a default.
acceptance-criteria:
  - Report quality/cost tradeoffs with repeated trials and uncertainty; no price or model-quality assumptions are fabricated.
  - Configured providers, representative tasks and actual usage measurements are prerequisites for acceptance; protocol-only fixtures cannot close this research.
  - Route changes cannot relax verification, expand authority, or treat model confidence as acceptance; negative results remain valid research outcomes.
submission:
review-requirements: [research-method review, application/architecture-boundary review]
reviews: []
artifact-refs: []
evidence-refs:
  - packages/core-harness/src/model-routing.js
  - packages/agentic-system/src/backend-advisor.js
  - docs/living/knowledge/bb022-agentic-evaluation-protocol.md
blockers:
  - concrete provider configuration, representative task set and a measured fixed-route baseline have not been established for this experiment
follow-up-refs: []
origin: INTENT-exharness-agentic-system; explicit user request for useful research addons based on existing project capabilities
```

## Value-backed continuation fixes

The runnable probes in `knowledge/value-probes-2026-09-16.mjs` and analysis in `knowledge/value-research-2026-09-16.md` establish concrete implementation opportunities. These are fixes with measurable value, not additional open-ended research topics. Existing persistence/cancellation fixes BB-023/024 remain urgent. BB-041 protects generic durable payloads; BB-042 preserves existing Advisor decisions through durable workflow coordination.

```text
BB-041
question/work: Prevent silent loss or conversion of generic checkpoint data across JSON Blackboard persistence.
kind: FIX
priority: P1
status: READY
owner:
depends-on: []
target-consumer: Public checkpoint callers, including the BB-026/027 research-continuation consumer
implementation-output: A persisted-payload validation boundary in Blackboard normalization/save with explicit handling of unsupported values
value-gate: Every acknowledged supported payload is semantically identical after reload; unsupported values fail without changing prior Board state
remaining-work:
  - define the supported persisted value contract and reject lossy values with useful field-path diagnostics
  - validate arbitrary checkpoint/origin and other persisted payload fields consistently before durable transitions
  - preserve compatibility for existing valid JSON snapshots and align returned acknowledgments with actual persisted state
acceptance-criteria:
  - the V1 Map/NaN probe cannot silently lose an experiment or convert a value after a successful acknowledgment
  - test Map/Set/Date, undefined, non-finite numbers, cycles and BigInt as well as valid nested JSON
  - rejection preserves prior ownership, checkpoint and lifecycle status; successful state round-trips across a new store instance
submission:
review-requirements: [persistence/schema review, application/code review]
reviews: []
artifact-refs: []
evidence-refs:
  - docs/living/knowledge/value-research-2026-09-16.md (V1)
  - docs/living/knowledge/value-probes-2026-09-16.mjs
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; user requires implementable research value; reproduced checkpoint acknowledgment/reload mismatch
```

```text
BB-042
question/work: Preserve and resolve Backend Advisor context requests/escalation at the durable workflow boundary before redispatch.
kind: FIX
priority: P1
status: READY
owner:
depends-on: []
target-consumer: createDurableBackendQaWorkflow runBackendStage using runBackendObjective and BackendAdvisor
implementation-output: Explicit application-owned continuation mapping and persisted coordination requirements with a resolution/resume path
value-gate: REQUEST_CONTEXT/ESCALATE retain their coordination need across sessions and do not blindly redispatch the unchanged Backend objective
remaining-work:
  - define handling for each existing BackendRunAction while preserving Advisor proposal and Orchestrator decision authority
  - persist gap IDs, context needs and decision rationale/provenance needed by the next session
  - add explicit requirement resolution/resume and preserve valid retry, failure and QA gating behavior
acceptance-criteria:
  - V2 REQUEST_CONTEXT and ESCALATE survive reconstruction and prevent an unchanged second Backend dispatch while unresolved
  - resolving the actual coordination requirement resumes the intended stage without granting Advisor direct mutation or completion authority
  - tests cover retry, context resolution, escalation, missing Advisor and default grounded completion policy
submission:
review-requirements: [workflow/Advisor authority review, application/code review]
reviews: []
artifact-refs: []
evidence-refs:
  - docs/living/knowledge/value-research-2026-09-16.md (V2; probe uses synthetic Worker and reduced completion policy)
  - docs/living/knowledge/value-probes-2026-09-16.mjs
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; user requires implementable research value; reproduced loss of Advisor continuation requirements
```

## Storage

`docs/living/blackboard.md` remains the canonical coordination state for the ExHarness repository-development project today.

The Agentic Application also has a JSON-backed durable Blackboard primitive for runtime projects. A project-bound `createSessionHandoffSurface({ orchestrator, projectId })` exposes and verifies explicit project identity plus durable intent, work checkpoints, lifecycle buckets and artifact/evidence refs for fresh-session continuation.

D008 makes these project boundaries explicit; it does **not** claim the repository Markdown Board is currently a projection of a runtime JSON Board. If ExHarness later self-hosts this same repository project through `ApplicationOrchestrator`, one canonical writable representation plus conflict-safe projection/migration semantics must be designed before convergence.