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
status: READY
owner:
depends-on: [BB-004, BB-012]
remaining-work:
  - model one user objective through bounded work decomposition, dependencies, blockers, reviews and progress
  - define separate PM coordination context and SA architecture context with their allowed proposals
  - identify Orchestrator validation required before proposals change canonical work
  - compare deterministic coordination with bounded judgment and state where a concrete role adds measurable value
  - specify decision/artifact handoff and re-planning behavior without changing user intent implicitly
acceptance-criteria:
  - research includes a concrete project scenario and explicit role input/output/authority contracts
  - accepted recommendation preserves PM/SA separation and Orchestrator lifecycle authority from D003
  - implementation is justified by scenario evidence; generic registries or workflow DSLs require separate repeated-use evidence
submission:
review-requirements: [project-workflow review, architecture-boundary review]
reviews: []
artifact-refs: []
evidence-refs:
  - docs/living/decisions/D003-orchestrator-blackboard-review-authority.md
  - docs/living/decisions/D004-blackboard-session-handoff.md
  - packages/agentic-system/src/session-handoff.js
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
  - BB-020 must justify and specify the concrete role slice
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

Recommended next sequence: BB-023 and BB-024 (persistence and cancellation correctness), BB-025 (graph integrity), then continue BB-016/018 and the research pilot. These fixes can be investigated independently. BB-014/015/022 remain delivered; BB-005 still requires representative production evidence.

```text
BB-023
question/work: Prevent expired-lock takeover from allowing a live stale transaction to overwrite newer committed Blackboard state.
kind: FIX
priority: P1
status: READY
owner:
depends-on: []
remaining-work:
  - define safe lock ownership/takeover and commit validation for the concrete local store
  - prevent an old writer from publishing a stale snapshot or deleting a replacement owner's lock
  - cover concurrent stale-lock contenders and failed-save cleanup
acceptance-criteria:
  - the R1 interleaving cannot lose a committed item; conflicting old writes fail explicitly
  - lock cleanup verifies ownership and cannot remove a newer lock
  - tests cover paused live owners, abandoned locks and competing recovery attempts
submission:
review-requirements: [persistence/concurrency review, application/code review]
reviews: []
artifact-refs: []
evidence-refs: [docs/living/knowledge/project-review-2026-09-16.md (R1)]
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; grounded follow-up from current project review, store exclusion distinct from BB-016 work ownership
```

```text
BB-024
question/work: Preserve SUPERSEDED cancellation when delayed finding reconciliation arrives.
kind: FIX
priority: P1
status: READY
owner:
depends-on: []
remaining-work:
  - define legal reconciliation source states and preserve terminal cancellation
  - reject stale reconciliation before changing findings, status or follow-up items
  - retain canceled submission/evidence history for inspection
acceptance-criteria:
  - cancel followed by NON_ACTIONABLE or CURRENT_WORK reconciliation cannot become DONE or REOPENED
  - late NEW_WORK reconciliation cannot create child work after cancellation
  - normal pending-finding reconciliation still derives completion only after remaining obligations resolve
submission:
review-requirements: [workflow/acceptance review, application/code review]
reviews: []
artifact-refs: []
evidence-refs: [docs/living/knowledge/project-review-2026-09-16.md (R2)]
blockers: []
follow-up-refs: []
origin: INTENT-exharness-agentic-system; reproduced cancellation-to-DONE transition through reconcileFinding
```

```text
BB-025
question/work: Validate Blackboard dependency graph integrity and diagnose stored graphs that cannot progress.
kind: FIX
priority: P1
status: READY
owner:
depends-on: []
remaining-work:
  - reject dangling/self/cyclic dependencies at complete-snapshot admission and transactional writes
  - check follow-up creation against the resulting complete graph rather than only the new item
  - define explicit diagnostics and migration/repair for previously accepted invalid snapshots
acceptance-criteria:
  - R3 dangling and cyclic inputs fail with actionable item/edge diagnostics before persistence
  - valid unordered DAGs and durable intent-root dependencies remain accepted
  - invalid mutations leave the prior snapshot intact and repair never silently drops dependencies
submission:
review-requirements: [state/schema review, application/code review]
reviews: []
artifact-refs: []
evidence-refs: [docs/living/knowledge/project-review-2026-09-16.md (R3)]
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

## Storage

`docs/living/blackboard.md` remains the canonical coordination state for the ExHarness repository-development project today.

The Agentic Application also has a JSON-backed durable Blackboard primitive for runtime projects. A project-bound `createSessionHandoffSurface({ orchestrator, projectId })` exposes and verifies explicit project identity plus durable intent, work checkpoints, lifecycle buckets and artifact/evidence refs for fresh-session continuation.

D008 makes these project boundaries explicit; it does **not** claim the repository Markdown Board is currently a projection of a runtime JSON Board. If ExHarness later self-hosts this same repository project through `ApplicationOrchestrator`, one canonical writable representation plus conflict-safe projection/migration semantics must be designed before convergence.
