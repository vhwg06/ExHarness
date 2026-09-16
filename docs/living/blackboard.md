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
  -> resolve only referenced artifacts/evidence needed for the next context
  -> choose only eligible unresolved work
  -> CLAIM
  -> resolve concrete work context
  -> dispatch/execute bounded Worker work
  -> SUBMIT immutable result/artifact/evidence refs
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
what is the user's objective?
what work exists?
what can run now?
what is already claimed?
what is pending review or reconciliation?
what is blocked or done?
which artifact/evidence refs must be resolved to continue?
```

The Agentic Application session-handoff surface uses one durable user-intent root and rejects work that cannot trace directly or transitively to that root.

Legacy Board construction without a durable intent root may still exist for tests/low-level compatibility, but it is not session-handoff safe and must not infer intent from task descriptions.

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
submission: <immutable submitted result refs, when present>
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers: []
follow-up-refs: []
origin: <root-intent or parent/finding provenance>
```

The Board is operational state, not a diary and not an architecture document.

## Completion invariants

- Worker result/submission is not completion authority.
- `DONE` requires all required reviews/acceptance obligations to be satisfied.
- rejected or inconclusive review reopens/narrows the current work unless the finding is independently scoped work;
- Board completion does not automatically promote a design judgment; evidence/judgment/decision semantics remain distinct;
- role-local completion (for example Backend completion) does not automatically mean the enclosing Blackboard problem is done.

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

## Agentic Application

```text
BB-012
question/work: Make the Blackboard a durable session-handoff surface rooted in user-defined intent so any fresh session can resume from Board state + referenced artifacts without previous conversation context.
status: PENDING_REVIEW
owner:
depends-on: [BB-011]
remaining-work: []
submission:
  - PR #71
review-requirements:
  - application/code review
  - session-handoff boundary review
reviews: []
artifact-refs:
  - packages/agentic-system/src/session-handoff.js
  - packages/agentic-system/test/session-handoff.test.js
  - docs/living/decisions/D004-blackboard-session-handoff.md
evidence-refs:
  - session-handoff contract tests in PR #71
blockers: []
follow-up-refs: []
origin: direct user objective defining Blackboard as the cross-session handoff boundary
```

```text
BB-004
question/work: Integrate the durable Orchestrator-owned application workflow with the concrete Backend accepted -> QA pending/running/completed path, including restart/recovery behavior.
status: READY
owner:
depends-on: [BB-003, BB-011]
remaining-work:
  - bind Backend/QA dispatch to one durable application workflow state instead of a sidecar Board
  - determine which objective/result/artifact/acceptance-decision refs survive restart
  - define retry semantics when QA reports issues after accepted Backend work
  - define block/cancel/resume semantics across Backend -> QA
  - compose application state with ExHarness interrupted-variation/effect recovery without duplicating Core authority
  - define artifact lookup failure/retry behavior at the application boundary
submission:
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers: []
follow-up-refs: []
```

```text
BB-005
question/work: Production-evaluate the concrete Backend -> QA system and generalize only evidence-supported repeated semantics.
status: BLOCKED
owner:
depends-on: [BB-004]
remaining-work:
  - task success across Backend -> QA
  - false-completion rate at role and Board boundaries
  - artifact handoff correctness
  - context precision/cost for repository vs internal artifacts
  - QA issue/remediation rate
  - Advisor invocation/value-add
  - recovery correctness
  - re-test whether generic Worker/WorkOrder/context/review abstractions are justified
submission:
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers:
  - BB-004 must produce real durable/recovery behavior to evaluate
follow-up-refs: []
```

The promoted PM/SA topology in D003 is not yet claimed as a concrete source role implementation. Concrete PM context, SA context and vertical reviewer slices must be added only when their real WorkOrder/context/result pressure is implemented and tested; they must not be fabricated into current-state docs.

## ExHarness Core

```text
BB-006
question/work: Close the built-in external-effect/persistence crash window so candidate/trace/variation state can never be mistaken for proof that an externally visible action completed.
status: READY
owner:
depends-on: []
remaining-work:
  - decide how built-in avo.act crosses the effect-aware action-intent boundary
  - ensure core.act persistence ordering does not infer completion from pre-persistence runtime state
  - preserve separation between effect state, evaluation, semantic memory and application completion
submission:
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers: []
follow-up-refs: []
```

```text
BB-007
question/work: Compose deterministic restore -> pending-effect reconciliation -> evidence restoration -> explicit resume for a concrete recovery consumer.
status: BLOCKED
owner:
depends-on: [BB-004, BB-006]
remaining-work:
  - order interrupted-variation recovery, AgentRuntime snapshot/restore and effect reconciliation
  - keep safe replay/observation machine-first
  - fail closed or escalate NON_RECONCILABLE ambiguity
submission:
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers:
  - requires real application recovery pressure from BB-004
  - external-effect boundary from BB-006 must be trustworthy
follow-up-refs: []
```

```text
BB-008
question/work: Determine whether a higher-level executable Core lifecycle surface is justified after recovery composition is concrete.
status: BLOCKED
owner:
depends-on: [BB-007]
remaining-work:
  - if justified, compose existing deliberation/action/effect/observe/verify/evaluate/cognition/promotion boundaries without absorbing Agentic Application orchestration
submission:
review-requirements: []
reviews: []
artifact-refs: []
evidence-refs: []
blockers:
  - do not invent a lifecycle facade before BB-007 demonstrates required sequencing
follow-up-refs: []
```

## Oracle

Resolved during Waves A/C and therefore **not open work**:

- first concrete Backend context slice exists;
- internal application-artifact context slice exists for QA;
- stable `sourceRef` is carried by resolved Backend/QA context;
- internal artifact provenance carries `APPLICATION_ARTIFACT`, producer work-order id and acceptance-decision provenance;
- failures already identify the concrete repository vs application-artifact source boundary.

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
follow-up-refs: []
```

Caching/freshness, MCP-first integration and semantic retrieval are not Board gaps merely because they are absent. They become Board work only when a concrete source demonstrates latency/cost/freshness or discovery pressure.

## Storage

`docs/living/blackboard.md` remains the canonical repository coordination projection today.

The Agentic Application also has a JSON-backed durable Blackboard state primitive for executable orchestration. `createSessionHandoffSurface(...)` now proves a concrete handoff-safe projection over such Board state when exactly one durable user-intent root exists.

Replacing the Markdown coordination projection entirely is **not** claimed by this slice; any future convergence must preserve the same authority/state/handoff invariants and must not create two competing canonical Boards.
